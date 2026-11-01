// M2 items and Today stories against the real core (Backend Teamlead TL-18, HoD D-26): each test
// names its DESIGN.md sequence and asserts the core-visible steps — rows, events, the clipboard
// and the exported files — not only a command result. The calendar, clipboard and folder panel
// are the harness's scripted seams. Every command of 2.18 succeeds at least once here.
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import type { ItemView } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { LIVE_CALL, PAST_CALL } from "../support/world-presets";
import { cancelNextSavePanel, rows } from "./history-support";

let s: Scenario;
afterEach(async () => {
  await s.dispose();
});

type Wire = { invoke(window: string, cmd: string, args: unknown): Promise<unknown> };
const wire = (): Wire => (s as unknown as { process: Wire }).process;
const everyone = { sections: [], item_ids: [], include_unreviewed: true };
const reviewed = { sections: [], item_ids: [], include_unreviewed: false };

describe("cpt-noter-seq-today-review-before-call", () => {
  it("happy path: Today ranks the carried items, counts the suggestions waiting and names the live call", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    const today = ok(await main.todayGet({}));
    expect(today.calendar).toBe("granted");
    expect(today.live_call?.id).toBe(LIVE_CALL);
    // The review line counts the suggested items of every call.
    expect(today.review_waiting).toBe(ok(await main.itemsList({ filter: { reviews: ["suggested"] }, page: {} })).rows.length);
    expect(today.ranking).toBe("owed_to_todays_people");

    // The ranking is a setting: the other order is what the next read says.
    const settings = ok(await s.core("settings").settingsGet({}));
    ok(await s.core("settings").settingsUpdate({ rev: settings.rev, section: { section: "today", value: { ...settings.today, ranking: "due_then_owed_to_you" } } }));
    expect(ok(await main.todayGet({})).ranking).toBe("due_then_owed_to_you");
    if (s.target === "stdio") {
      // Reading Today alone never writes: no item changed.
      const changes = await rows<{ n: number }>(s, "SELECT count(*) AS n FROM changes WHERE entity_type = 'item'");
      expect(changes?.[0].n).toBe(0);
    }
  });

  it("empty path: with the calendar denied Today still lists items, with no protected events", async () => {
    s = openScenario({ alsoRecord: exercised });
    if (s.target === "fake") return; // the fake has no calendar permission to deny
    const world = (await wire().invoke("main", "harness.world_get", {})) as { app: { setup: { permissions: { kind: string; state: unknown }[] } } };
    const calendar = world.app.setup.permissions.find((p) => p.kind === "calendar");
    expect(calendar).toBeDefined();
    calendar!.state = "denied";
    await wire().invoke("main", "harness.world_set", { world });
    const today = ok(await s.core("main").todayGet({}));
    expect(today.calendar).toBe("denied");
    expect(today.today).toEqual([]);
    expect(today.live_call?.id).toBe(LIVE_CALL);
  });
});

describe("cpt-noter-seq-today-tick-item", () => {
  it("happy path: a tick publishes the item, and undo through History puts it back", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    const changed = await s.events("entity:changed");
    const before = ok(await main.itemGet({ item_id: "itm_spec" })).item;
    const done = ok(await main.itemSetDone({ item_id: "itm_spec", rev: before.rev, done: true }));
    expect(done.item.status).toBe("done");
    if (s.target === "stdio") await until(() => changed.all.some((e) => e.type === "item" && e.item.id === "itm_spec" && e.item.status === "done"), "entity:changed with the ticked item");
    if (s.target === "stdio") expect(ok(await main.todayGet({})).done_today.some((i: ItemView) => i.id === "itm_spec")).toBe(true);

    expect(ok(await main.changeUndo({ target: { type: "change", change_id: done.change_id } })).undone).toBe(1);
    if (s.target === "stdio") expect(ok(await main.itemGet({ item_id: "itm_spec" })).item.status).toBe("open"); // the fake's undo leaves items alone
    if (s.target === "stdio") await until(() => changed.all.some((e) => e.type === "item" && e.item.id === "itm_spec" && e.item.status === "open"), "entity:changed with the untouched item");
  });

  it("other path: a tick accepts a suggestion, and the handoff answers close or keep the item", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    const suggested = ok(await main.itemGet({ item_id: "itm_a11y" })).item;
    expect(suggested.review).toBe("suggested");
    const ticked = ok(await main.itemSetDone({ item_id: "itm_a11y", rev: suggested.rev, done: true }));
    expect(ticked.item).toMatchObject({ status: "done", review: "accepted" });

    const handed = ok(await main.itemGet({ item_id: "itm_virt" })).item;
    const kept = ok(await main.itemAnswerHandoffLanded({ item_id: "itm_virt", rev: handed.rev, answer: "keep_open" }));
    expect(kept.item.status).toBe("handed_off");
    const landed = ok(await main.itemAnswerHandoffLanded({ item_id: "itm_virt", rev: kept.item.rev, answer: "landed" }));
    expect(landed.item.status).toBe("done");
    const reopened = ok(await main.itemReopen({ item_id: "itm_virt", rev: landed.item.rev }));
    expect(reopened.item.status).toBe("open");
  });
});

describe("cpt-noter-seq-call-page-review-suggested-items", () => {
  it("happy path: accept, edit then accept, reject, restore, then accept the rest in one batch that undo reverses", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    const get = async (id: string) => ok(await main.itemGet({ item_id: id })).item;

    const replay = await get("itm_replay");
    expect(ok(await main.itemReview({ item_id: "itm_replay", rev: replay.rev, decision: "accept" })).item.review).toBe("accepted");

    const a11y = await get("itm_a11y");
    const edited = ok(await main.itemEdit({ item_id: "itm_a11y", rev: a11y.rev, patch: { text: "Check drawer focus order with VoiceOver on macOS" } }));
    expect(edited.item.edited).toBe(true);
    expect(ok(await main.itemReview({ item_id: "itm_a11y", rev: edited.item.rev, decision: "accept" })).item.review).toBe("accepted");

    const question = await get("itm_reconnect_q");
    const rejected = ok(await main.itemReview({ item_id: "itm_reconnect_q", rev: question.rev, decision: "reject" }));
    expect(rejected.item.review).toBe("rejected");
    const restored = ok(await main.itemReview({ item_id: "itm_reconnect_q", rev: rejected.item.rev, decision: "restore" }));
    expect(restored.item.review).toBe("suggested");

    // Accept all: the batch carries its id, and one undo reverses it.
    const created = ok(await main.itemCreate({ call_id: LIVE_CALL, kind: "risk", text: "Websocket reconnect storms" }));
    expect(created.item.review).toBe("accepted");
    const batch = ok(await main.itemsReviewAll({ call_id: LIVE_CALL, kinds: [] }));
    expect(batch.items.map((i: ItemView) => i.id)).toContain("itm_reconnect_q");
    if (s.target === "stdio" && batch.batch_id) {
      expect(ok(await main.changeUndo({ target: { type: "batch", batch_id: batch.batch_id } })).undone).toBeGreaterThan(0);
      expect((await get("itm_reconnect_q")).review).toBe("suggested");
    }
  });
});

describe("cpt-noter-seq-call-page-share-outputs", () => {
  it("happy path: every format lands on the clipboard in plain, Markdown and HTML, and a section or an item narrows the copy", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    const whole = ok(await main.shareCopy({ call_id: PAST_CALL, scope: everyone, format: "slack" }));
    expect(whole.sections).toBeGreaterThan(0);
    expect(whole.sensitive).toBe(false);
    for (const format of ["markdown", "jira"] as const) expect(ok(await main.shareCopy({ call_id: PAST_CALL, scope: everyone, format })).text.length).toBeGreaterThan(0);

    const one = ok(await main.shareCopy({ call_id: PAST_CALL, scope: { ...everyone, sections: ["summary"] }, format: "markdown" }));
    expect(one.sections).toBe(1);
    const item = ok(await main.itemsList({ filter: { call_id: PAST_CALL }, page: {} })).rows[0];
    const picked = ok(await main.shareCopy({ call_id: PAST_CALL, scope: { ...everyone, item_ids: [item.id] }, format: "markdown" }));
    expect(picked.items).toBe(1);
    expect(picked.text).toContain(item.text.slice(0, 20));

    if (s.target === "stdio") {
      const log = (await wire().invoke("main", "harness.native_log", {})) as { clipboard: { plain: string; markdown: string; html: string }[] };
      expect(log.clipboard.length).toBe(5);
      expect(log.clipboard[0].plain).toBe(whole.text);
      for (const c of log.clipboard) {
        expect(c.markdown.length).toBeGreaterThan(0);
        expect(c.html).toMatch(/<h2>|<ul>/);
        expect(c.html).not.toContain("<script");
      }
    }
  });

  it("error path: a call whose outputs are not written yet has nothing to share, and the clipboard is untouched", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    const res = await main.shareCopy({ call_id: LIVE_CALL, scope: reviewed, format: "markdown" });
    expect(res.status).toBe("error");
    if (res.status === "error") expect(["outputs_not_ready", "unreviewed_in_scope"]).toContain(res.error.code);
    if (s.target === "stdio") {
      expect(res.status === "error" && res.error.code).toBe("outputs_not_ready");
      const log = (await wire().invoke("main", "harness.native_log", {})) as { clipboard: unknown[] };
      expect(log.clipboard).toEqual([]);
    }
  });

  it("other path: Export to a folder writes the requested files, and a cancelled panel writes none", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    const include = { summary_and_items: true, transcript: true, audio: false };
    await cancelNextSavePanel(s, "calls_export");
    expect((await main.callsExport({ call_ids: [PAST_CALL], include })).status).toBe("error");
    const done = ok(await main.callsExport({ call_ids: [PAST_CALL], include }));
    expect(done.files).toBeGreaterThan(0);
    if (s.target === "stdio") {
      expect(existsSync(done.path)).toBe(true);
      const files = readdirSync(done.path);
      expect(files).toHaveLength(done.files);
      expect(files.some((f) => f.endsWith(".md"))).toBe(true);
      expect(readFileSync(`${done.path}/${files.find((f) => f.endsWith(".md"))}`, "utf8").length).toBeGreaterThan(0);
    }
  });
});

describe("cpt-noter-seq-call-page-check-evidence", () => {
  it("happy path: an item's evidence spans resolve to the words said, and the inspector edits stay in History", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    const detail = ok(await main.itemGet({ item_id: "itm_spec" }));
    expect(detail.item.spans.length).toBeGreaterThan(0);
    expect(detail.evidence.length + detail.item.spans.length).toBeGreaterThan(0);
    if (s.target === "stdio") {
      const spans = detail.item.spans[0];
      const words = ok(await main.transcriptSpan({ span: spans }));
      expect(words.segments.length).toBeGreaterThan(0);
      expect(words.segments.map((g) => g.text).join(" ")).toContain("drawer");
    }
    const edited = ok(await main.itemEdit({ item_id: "itm_spec", rev: detail.item.rev, patch: { text: "Drawer redesign spec by Monday" } }));
    const history = ok(await main.historyList({ target: { type: "all" }, actor: "all", job_id: null, from: null, to: null, page: {} }));
    expect(history.rows.some((r) => r.id === edited.change_id)).toBe(true);
    expect(ok(await main.itemGet({ item_id: "itm_spec" })).history.some((r) => r.id === edited.change_id)).toBe(true);
  });
});

describe("tags (2.18, call_tags_set and tags_list)", () => {
  it("one undo reverses the tags of several calls", async () => {
    s = openScenario({ alsoRecord: exercised });
    const main = s.core("main");
    const set = ok(await main.callTagsSet({ call_ids: [LIVE_CALL, PAST_CALL], add: ["Launch"], remove: [] }));
    expect(ok(await main.tagsList({})).tags.map((t) => t.tag.toLowerCase())).toContain("launch");
    if (s.target === "stdio" && set.batch_id) {
      expect(ok(await main.changeUndo({ target: { type: "batch", batch_id: set.batch_id } })).undone).toBe(2);
      expect(ok(await main.tagsList({})).tags.map((t) => t.tag.toLowerCase())).not.toContain("launch");
    }
  });
});
