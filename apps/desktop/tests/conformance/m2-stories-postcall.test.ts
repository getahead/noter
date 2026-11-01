// M2 post-call stories against the real core (Backend Teamlead TL-18, HoD D-26): each test names
// its story and asserts the core-visible steps — a live call stopped, its PostCall run writing the
// sections in order through `outputs:progress` on the scripted runtime, the user's edit and its
// version chain and undo, the notification the scripted Surfaces recorded with its call id, and
// the archive pass through the scripted engine (`--engine-script` playing `offline_done` with a
// recorded result) followed by a regeneration that keeps the edit. Those steps exist only in the
// real core, so the fake skips this file; m2-outputs.test.ts runs the five commands on both.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import type { CallId, CallOutputs, OutputsProgress, OutputSection, SectionKind } from "../../src/core/bindings";
import { exercised, isFake } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import * as W from "../support/world-presets";

let s: Scenario;
let dir: string;
afterEach(async () => {
  await s.dispose();
  rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const harness = () => (s as unknown as { process: { invoke(window: string, cmd: string, args: unknown): Promise<unknown> } }).process;

/** Rows of the real core's database, read-only. */
async function rows<T>(sql: string, ...params: string[]): Promise<T[]> {
  const { path } = (await harness().invoke("main", "harness.data_dir", {})) as { path: string };
  const db = new DatabaseSync(join(path, "noter.db"), { readOnly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

/** What the core asked the scripted Mac to post, as `post_notification <kind> <call id>`. */
const notifications = async () => ((await s.surfaces()) ?? []).filter((c) => c.startsWith("post_notification"));

/** A segment the recorded archive heard, as the engine writes it. */
const heard = (n: number, text: string) => ({
  id: `arc_${n}`,
  call_id: "call_recorded",
  channel: "sys",
  t0_ms: n * 4000,
  t1_ms: n * 4000 + 3000,
  state: "confirmed",
  lang: "en",
  lang_p: 0.98,
  speaker_label: "spk_1",
  text,
  words_path: null,
  avg_logprob: -0.1,
  no_speech_p: 0.01,
  corrections: [],
  crosstalk_labels: [],
});
const LINES = ["Let's ship the drawer redesign in 8.0.", "Anna takes the virtualised table.", "Who owns the reconnect is still open."];

/**
 * A real core seeded with the fixture world, detection on and the self-test passed, whose
 * scripted engine plays `engine` lines and scripted runtime `llm` lines (none: built-in outputs).
 * By default the archive pass answers, `archiveAfterMs` after the core asks, with a result
 * recorded for the call's three lines.
 */
function open(opts: { llm?: object[]; engine?: object[]; archiveAfterMs?: number } = {}): void {
  dir = mkdtempSync(join(tmpdir(), "noter-postcall-"));
  const archive = join(dir, "archive.json");
  writeFileSync(archive, JSON.stringify({ call_id: "call_recorded", backend: "whisper_large_v3", segments: LINES.map((t, i) => heard(i, t)) }));
  const engine = opts.engine ?? [{ on: "offline_pass", after_ms: opts.archiveAfterMs ?? 0, event: { type: "offline_done", call_id: "call_recorded", result_path: archive } }];
  const flags = [`--engine-script ${write("engine.jsonl", engine)}`];
  if (opts.llm) flags.push(`--llm-script ${write("llm.jsonl", opts.llm)}`);
  const base = process.env.NOTER_CORE_CMD;
  process.env.NOTER_CORE_CMD = `${base} ${flags.join(" ")}`;
  try {
    s = openScenario({
      alsoRecord: exercised,
      world: (w) => {
        W.idle(w);
        w.app.setup.self_test = { type: "passed", at: Date.now() };
        w.app.setup.detection_enabled = true;
      },
    });
  } finally {
    process.env.NOTER_CORE_CMD = base;
  }
}
function write(name: string, lines: object[]): string {
  const file = join(dir, name);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

/** Starts recording from Today and says `lines` on the system channel; the call's id. */
async function record(lines = LINES): Promise<CallId> {
  const started = ok(await s.core("main").captureStart({ source: "today", sensitive: false }));
  const call = started.call_id!;
  await until(async () => ok(await s.core("main").appSnapshot({})).capture.phase === "recording", "recording");
  for (const [n, text] of lines.entries()) {
    const segment = { ...heard(n, text), id: `live_${n}`, call_id: call };
    await until(() => s.engineFact({ type: "segment", segment }), "the engine to hear the line");
  }
  await until(async () => (await rows("SELECT id FROM segments WHERE call_id = ?", call)).length === lines.length, "the live lines persisted");
  return call;
}

async function stop(call: CallId): Promise<void> {
  expect(ok(await s.core("main").captureStop({ call_id: call })).phase).toBe("stopped");
}

const outputs = async (call: CallId): Promise<CallOutputs> => ok(await s.core("main").outputsGet({ call_id: call }));
const sectionOf = (out: CallOutputs, kind: SectionKind): OutputSection => out.sections.find((x) => x.kind === kind)!;
const settled = (p: OutputsProgress) => p.state.type !== "writing" && p.state.type !== "pending";

/** A scripted post-call answer with this summary and no items. */
const postCall = (summary: string) => ({ on: "post-call", output: { lang: "en", summary_md: summary, decisions: [], action_items: [], open_questions: [], risks: [], per_participant: [], extras_md: null } });

/** The call's suggested items as stored, with how many evidence spans each has. */
const suggested = (call: CallId) =>
  rows<{ kind: string; text: string; review_state: string; spans: number }>(
    "SELECT kind, text, review_state, (SELECT count(*) FROM item_spans s WHERE s.item_id = i.id) AS spans FROM items i WHERE call_id = ? ORDER BY rowid",
    call,
  );

async function written(call: CallId): Promise<CallOutputs> {
  return until(async () => {
    const out = await outputs(call);
    return out.status !== "writing" && out.status !== "not_started" && out;
  }, "the outputs written");
}

describe.skipIf(isFake)("post-call stories on the real core (2.17)", { timeout: 60_000 }, () => {
  it("cpt-noter-seq-core-call-end-outputs: stop queues PostCall, the sections are written in order from the live transcript, Summary ready is posted, the archive pass replaces the transcript and the regeneration keeps the user's edit", async () => {
    // The live pass writes the summary as four lines; the archive's regeneration changes the last.
    const live = postCall("A.\nB.\nC.\nD.");
    const archived = postCall("A.\nB.\nC.\nD2.");
    open({ llm: [...Array(6).fill(live), ...Array(6).fill(archived)], archiveAfterMs: 3000 });
    const progress = await s.events("outputs:progress");
    const call = await record();
    await stop(call);
    const out = await written(call);
    expect(out.status).toBe("ready");
    // One section after the other, each written before the next starts, in the call type's order.
    const mine = progress.all.filter((p) => p.call_id === call);
    expect(mine[0]).toMatchObject({ section: out.sections[0].kind, state: { type: "writing" } });
    const order = mine.filter(settled).map((p) => p.section);
    expect(order.slice(0, out.sections.length)).toEqual(out.sections.map((x) => x.kind));
    const summary = sectionOf(out, "summary");
    expect(summary).toMatchObject({ state: { type: "ready" }, body_md: "A.\nB.\nC.\nD.", writer: { from_pass: "live" } });
    // No call is live: Summary ready is posted at once, for this call.
    await until(async () => (await notifications()).includes(`post_notification summary_ready ${call}`), "Summary ready for the call");
    // The user corrects the first line while the archive pass is still running.
    expect(out.archive).not.toBe("done");
    ok(await s.core("main").outputEdit({ call_id: call, summary_id: summary.summary_id!, rev: summary.rev!, body_md: "A!\nB.\nC.\nD." }));
    // The archive result replaces the live lines; the regeneration after it merges into the edit.
    await until(async () => (await outputs(call)).archive === "done", "the archive pass done");
    const passes = await rows<{ pass: string; n: number }>("SELECT pass, count(*) AS n FROM segments WHERE call_id = ? GROUP BY pass ORDER BY pass", call);
    expect(passes).toContainEqual({ pass: "archive", n: LINES.length });
    const merged = await until(async () => {
      const x = sectionOf(await outputs(call), "summary");
      return x.regenerated_with_edits && x;
    }, "the summary regenerated with the edit kept");
    expect(merged).toMatchObject({ body_md: "A!\nB.\nC.\nD2.", user_edited: true });
    const versions = ok(await s.core("main").outputVersions({ summary_id: summary.summary_id! })).versions;
    expect(versions.map((v) => v.kind)).toEqual(["generated", "user_edit", "generated", "user_edit"]);
    expect(versions[2].writer).toMatchObject({ from_pass: "archive" });
  });

  it("cpt-noter-seq-call-page-review-outputs: the sections fill in order, the user edits the summary, the version menu ends with Your Edit and Undo restores the written text", async () => {
    // The first run writes the summary as four lines; a regeneration changes the last one.
    open({ llm: [...Array(6).fill(postCall("A.\nB.\nC.\nD.")), postCall("A.\nB.\nC.\nD2.")], engine: [] });
    const progress = await s.events("outputs:progress");
    const call = await record();
    await stop(call);
    // Empty path: Writing summary… first, the transcript readable meanwhile, then each section.
    await until(() => progress.all.find((p) => p.call_id === call && p.section === "summary" && p.state.type === "writing"), "Writing summary…");
    expect(ok(await s.core("main").callGet({ call_id: call })).call.id).toBe(call);
    const out = await written(call);
    const summary = sectionOf(out, "summary");
    const id = summary.summary_id!;
    expect(summary).toMatchObject({ state: { type: "ready" }, body_md: "A.\nB.\nC.\nD.", user_edited: false, writer: { from_pass: "live" } });
    // Edit → ⌘Return: the corrected summary, Edited, Your Edit last in the version menu.
    const edit = ok(await s.core("main").outputEdit({ call_id: call, summary_id: id, rev: summary.rev!, body_md: "A?\nB.\nC.\nD." }));
    expect(edit.section).toMatchObject({ body_md: "A?\nB.\nC.\nD.", user_edited: true });
    expect(ok(await s.core("main").outputVersions({ summary_id: id })).versions.map((v) => v.kind)).toEqual(["generated", "user_edit"]);
    // Undo in History puts the written summary back.
    expect(ok(await s.core("main").changeUndo({ target: { type: "change", change_id: edit.change_id } })).undone).toBe(1);
    const undone = sectionOf(await outputs(call), "summary");
    expect(undone).toMatchObject({ body_md: "A.\nB.\nC.\nD.", user_edited: false });
    // The user edits the first line; Regenerate keeps it and takes the new last line: Regenerated · your edits kept.
    ok(await s.core("main").outputEdit({ call_id: call, summary_id: id, rev: undone.rev!, body_md: "A!\nB.\nC.\nD." }));
    ok(await s.core("main").outputsRegenerate({ call_id: call, sections: ["summary"], local: false }));
    const merged = await until(async () => {
      const x = sectionOf(await outputs(call), "summary");
      return x.regenerated_with_edits && x;
    }, "Regenerated · your edits kept");
    expect(merged).toMatchObject({ body_md: "A!\nB.\nC.\nD2.", user_edited: true });
    // Compare…: every version stays readable, the regenerated candidate beside the user's.
    const versions = ok(await s.core("main").outputVersions({ summary_id: id })).versions;
    const kinds = versions.map((v) => v.kind);
    expect(kinds.at(-2)).toBe("generated");
    expect(kinds.at(-1)).toBe("user_edit");
    const body = async (n: number) => ok(await s.core("main").outputVersionGet({ summary_id: id, version_id: versions[n].id })).body_md;
    expect(await body(0)).toBe("A.\nB.\nC.\nD.");
    expect(await body(versions.length - 2)).toBe("A.\nB.\nC.\nD2.");
    expect(await body(versions.length - 1)).toBe("A!\nB.\nC.\nD2.");
  });

  it("cpt-noter-seq-call-page-review-outputs (error, a section failed): the action items fail typed, the others stay ready; Use Local Model writes them and names its writer; regeneration waits while a call records", async () => {
    open({ llm: [postCall("Planning summary."), postCall(""), { on: "post-call", fail: "timeout" }], engine: [] });
    const call = await record();
    await stop(call);
    const out = await written(call);
    expect(out.status).toBe("partially_failed");
    const failed = sectionOf(out, "action_items");
    expect(failed.state.type).toBe("failed");
    expect(sectionOf(out, "summary")).toMatchObject({ state: { type: "ready" }, body_md: "Planning summary." });
    expect(out.sections.filter((x) => x.kind !== "action_items").every((x) => x.state.type !== "failed")).toBe(true);
    // Use Local Model: the action items alone, rewritten by the local runtime.
    const progress = await s.events("outputs:progress");
    ok(await s.core("main").outputsRegenerate({ call_id: call, sections: ["action_items"], local: true }));
    await until(() => progress.all.find((p) => p.call_id === call && p.section === "action_items" && p.state.type === "ready"), "the action items written");
    const again = await outputs(call);
    expect(sectionOf(again, "action_items")).toMatchObject({ state: { type: "ready" }, writer: { runtime: "local" } });
    expect(sectionOf(again, "action_items").body_md).toContain("Scripted action item");
    expect((await suggested(call)).map((i) => i.text)).toEqual(["Scripted action item"]);
    expect(again.status).toBe("ready");
    // While the next call records, a manual regeneration is refused.
    await record(LINES.slice(0, 1));
    expect(refused(await s.core("main").outputsRegenerate({ call_id: call, sections: ["summary"], local: false })).code).toBe("job_blocked");
  });

  it("cpt-noter-seq-notifications-open-outputs: Summary ready names the call; held while the next call records and released at its stop; none while the main window shows the call", async () => {
    open({ engine: [] });
    // Next call already recording: the planning call's Summary ready waits for the 1:1's stop.
    const planning = await record();
    await stop(planning);
    const oneOnOne = await record(LINES.slice(0, 1));
    await written(planning);
    // Its items are suggestions with their evidence (the notification counts them).
    expect(await suggested(planning)).toEqual([
      { kind: "decision", text: "Scripted decision", review_state: "suggested", spans: 1 },
      { kind: "action_item", text: "Scripted action item", review_state: "suggested", spans: 1 },
    ]);
    await sleep(300);
    expect(await notifications()).toEqual([]);
    await stop(oneOnOne);
    await written(oneOnOne);
    await until(async () => (await notifications()).length === 2, "both notifications");
    expect(await notifications()).toEqual([`post_notification summary_ready ${planning}`, `post_notification summary_ready ${oneOnOne}`]);
    // Main window already shows the call: its page fills in, no notification arrives.
    ok(await s.core("main").windowReportView({ call_id: null }));
    const shown = await record(LINES.slice(0, 1));
    ok(await s.core("main").windowReportView({ call_id: shown }));
    await stop(shown);
    await written(shown);
    await sleep(300);
    expect(await notifications()).toHaveLength(2);
  });

  it("cpt-noter-seq-notifications-open-outputs (error, outputs failed): Couldn't write the summary names the call; Try Again writes the outputs", async () => {
    // Every section of the first run fails; the runtime answers again afterwards.
    open({ llm: Array.from({ length: 6 }, () => ({ on: "post-call", fail: "timeout" })), engine: [] });
    const call = await record();
    await stop(call);
    const out = await written(call);
    expect(out.status).toBe("failed");
    await until(async () => (await notifications()).includes(`post_notification summary_failed ${call}`), "Couldn't write the summary");
    expect((await notifications()).some((n) => n.startsWith("post_notification summary_ready"))).toBe(false);
    // The call's page shows the failed sections; Try Again writes them all.
    expect(out.sections.every((x) => x.state.type === "failed")).toBe(true);
    const progress = await s.events("outputs:progress");
    ok(await s.core("main").outputsRegenerate({ call_id: call, sections: [], local: false }));
    await until(() => progress.all.find((p) => p.call_id === call && p.section === "summary" && p.state.type === "writing"), "Writing summary…");
    await until(async () => (await outputs(call)).status === "ready", "the outputs written");
    expect(sectionOf(await outputs(call), "summary").body_md).toBe("Scripted summary.");
  });
});
