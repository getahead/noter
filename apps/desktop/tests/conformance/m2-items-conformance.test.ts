// M2 items and Today conformance (2.18): the fourteen commands answer the same on the fake and
// the real core — shapes, revisions (`conflict`), `invalid_input`, `not_found` and `cancelled`.
// @cpt-dod:cpt-noter-dod-core-items-today-tests:p1
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Core, ItemView } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, refused } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { LIVE_CALL, PAST_CALL } from "../support/world-presets";
import { cancelNextSavePanel } from "./history-support";

let s: Scenario;
let main: Core;
beforeEach(() => {
  s = openScenario({ alsoRecord: exercised });
  main = s.core("main");
});
afterEach(async () => {
  await s.dispose();
});

const get = async (item_id: string) => ok(await main.itemGet({ item_id })).item;
const everyone = { sections: [], item_ids: [], include_unreviewed: true };

describe("items_list and item_get", () => {
  it("lists a call's items as a page and filters by kind and status", async () => {
    const page = ok(await main.itemsList({ filter: { call_id: LIVE_CALL }, page: {} }));
    expect(page).toHaveProperty("rows");
    expect(page).toHaveProperty("next_cursor");
    expect(page.rows.map((i: ItemView) => i.id)).toContain("itm_spec");
    expect(page.rows.every((i: ItemView) => i.call.id === LIVE_CALL)).toBe(true);
    const decisions = ok(await main.itemsList({ filter: { kinds: ["decision"] }, page: {} }));
    expect(decisions.rows.every((i: ItemView) => i.kind === "decision")).toBe(true);
    const handed = ok(await main.itemsList({ filter: { statuses: ["handed_off"] }, page: {} }));
    expect(handed.rows.map((i: ItemView) => i.id)).toEqual(["itm_virt"]);
  });

  it("item_get answers the item with its evidence and history, and not_found for a stranger", async () => {
    const detail = ok(await main.itemGet({ item_id: "itm_spec" }));
    expect(detail.item).toMatchObject({ id: "itm_spec", kind: "action_item", review: "accepted" });
    expect(Array.isArray(detail.evidence)).toBe(true);
    expect(Array.isArray(detail.history)).toBe(true);
    expect(refused(await main.itemGet({ item_id: "itm_nobody" })).code).toBe("not_found");
  });
});

describe("item mutations", () => {
  it("item_set_done ticks with a new rev and a change, and a stale rev is a conflict", async () => {
    const before = await get("itm_spec");
    const done = ok(await main.itemSetDone({ item_id: "itm_spec", rev: before.rev, done: true }));
    expect(done.item).toMatchObject({ id: "itm_spec", status: "done" });
    expect(done.item.rev).toBeGreaterThan(before.rev);
    expect(done.change_id).toBeTruthy();
    expect(refused(await main.itemSetDone({ item_id: "itm_spec", rev: before.rev, done: false })).code).toBe("conflict");
    expect(refused(await main.itemSetDone({ item_id: "itm_nobody", rev: 1, done: true })).code).toBe("not_found");
  });

  it("item_review accepts, rejects and restores a suggestion", async () => {
    const start = await get("itm_replay");
    expect(start.review).toBe("suggested");
    const accepted = ok(await main.itemReview({ item_id: "itm_replay", rev: start.rev, decision: "accept" }));
    expect(accepted.item.review).toBe("accepted");
    const second = await get("itm_a11y");
    const rejected = ok(await main.itemReview({ item_id: "itm_a11y", rev: second.rev, decision: "reject" }));
    expect(rejected.item.review).toBe("rejected");
    const restored = ok(await main.itemReview({ item_id: "itm_a11y", rev: rejected.item.rev, decision: "restore" }));
    expect(restored.item.review).toBe("suggested");
    expect(refused(await main.itemReview({ item_id: "itm_a11y", rev: second.rev, decision: "accept" })).code).toBe("conflict");
  });

  it("items_review_all accepts a call's suggestions in one batch", async () => {
    const result = ok(await main.itemsReviewAll({ call_id: LIVE_CALL, kinds: [] }));
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((i: ItemView) => i.review === "accepted")).toBe(true);
    expect(result).toHaveProperty("skipped");
    expect(ok(await main.itemsReviewAll({ call_id: LIVE_CALL, kinds: [] })).items).toEqual([]);
  });

  it("item_edit changes the text and refuses an empty one", async () => {
    const before = await get("itm_spec");
    const edited = ok(await main.itemEdit({ item_id: "itm_spec", rev: before.rev, patch: { text: "Drawer spec by Monday" } }));
    expect(edited.item).toMatchObject({ text: "Drawer spec by Monday", edited: true });
    const bad = refused(await main.itemEdit({ item_id: "itm_spec", rev: edited.item.rev, patch: { text: "   " } }));
    expect(bad.code).toBe("invalid_input");
  });

  it("item_reopen returns a closed item to open", async () => {
    const before = await get("itm_spec");
    const done = ok(await main.itemSetDone({ item_id: "itm_spec", rev: before.rev, done: true }));
    const reopened = ok(await main.itemReopen({ item_id: "itm_spec", rev: done.item.rev }));
    expect(reopened.item.status).toBe("open");
  });

  it("item_create adds an accepted item the user wrote, and refuses empty text", async () => {
    const made = ok(await main.itemCreate({ call_id: PAST_CALL, kind: "action_item", text: "Send the notes" }));
    expect(made.item).toMatchObject({ kind: "action_item", text: "Send the notes", review: "accepted", status: "open" });
    expect(made.item.call.id).toBe(PAST_CALL);
    expect(refused(await main.itemCreate({ call_id: PAST_CALL, kind: "decision", text: "" })).code).toBe("invalid_input");
    expect(refused(await main.itemCreate({ call_id: "call_nobody", kind: "decision", text: "x" })).code).toBe("not_found");
  });

  it("item_answer_handoff_landed closes a handed-off item, or keeps it open", async () => {
    const start = await get("itm_virt");
    expect(start.status).toBe("handed_off");
    const kept = ok(await main.itemAnswerHandoffLanded({ item_id: "itm_virt", rev: start.rev, answer: "keep_open" }));
    expect(kept.item.status).toBe("handed_off");
    const landed = ok(await main.itemAnswerHandoffLanded({ item_id: "itm_virt", rev: kept.item.rev, answer: "landed" }));
    expect(landed.item.status).toBe("done");
  });
});

describe("today_get", () => {
  it("answers the whole Today view", async () => {
    const today = ok(await main.todayGet({}));
    for (const key of ["banners", "calendar", "date", "done_today", "due_without_call", "first_use"]) expect(today).toHaveProperty(key);
    expect(Array.isArray(today.banners)).toBe(true);
  });
});

describe("call_tags_set and tags_list", () => {
  it("sets tags across calls under one batch id and lists their use", async () => {
    const set = ok(await main.callTagsSet({ call_ids: [LIVE_CALL, PAST_CALL], add: ["Launch"], remove: [] }));
    expect(set.calls.map((c) => c.id).sort()).toEqual([LIVE_CALL, PAST_CALL].sort());
    expect(set.calls.every((c) => c.tags.some((t) => t.toLowerCase() === "launch"))).toBe(true);
    expect(set.batch_id).toBeTruthy();
    expect(ok(await main.tagsList({})).tags.some((t) => t.tag.toLowerCase() === "launch" && t.calls >= 2)).toBe(true);
    const one = ok(await main.callTagsSet({ call_ids: [PAST_CALL], add: ["solo"], remove: [] }));
    expect(one.batch_id ?? null).toBeNull();
  });

  it("refuses a tag that is empty or too long, and a call that is gone", async () => {
    expect(refused(await main.callTagsSet({ call_ids: [LIVE_CALL], add: [""], remove: [] })).code).toBe("invalid_input");
    expect(refused(await main.callTagsSet({ call_ids: [LIVE_CALL], add: ["x".repeat(33)], remove: [] })).code).toBe("invalid_input");
    expect(refused(await main.callTagsSet({ call_ids: ["call_nobody"], add: ["ok"], remove: [] })).code).toBe("not_found");
  });
});

describe("share_copy and calls_export", () => {
  it("share_copy answers the copy and its counts, and refuses a call that is gone", async () => {
    const done = ok(await main.shareCopy({ call_id: PAST_CALL, scope: everyone, format: "slack" }));
    expect(done.text.length).toBeGreaterThan(0);
    expect(done.sections).toBeGreaterThan(0);
    expect(done).toMatchObject({ sensitive: false });
    expect(refused(await main.shareCopy({ call_id: "call_nobody", scope: everyone, format: "markdown" })).code).toBe("not_found");
  });

  it("calls_export validates its arguments, and a cancelled panel is cancelled", async () => {
    const include = { summary_and_items: true, transcript: false, audio: false };
    expect(refused(await main.callsExport({ call_ids: [], include })).code).toBe("invalid_input");
    expect(refused(await main.callsExport({ call_ids: ["call_nobody"], include })).code).toBe("not_found");
    await cancelNextSavePanel(s, "calls_export");
    expect(refused(await main.callsExport({ call_ids: [PAST_CALL], include })).code).toBe("cancelled");
    expect(ok(await main.callsExport({ call_ids: [PAST_CALL], include })).files).toBeGreaterThan(0);
  });
});
