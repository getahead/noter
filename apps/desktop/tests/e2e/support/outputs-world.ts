// Starting states of the call-page outputs stories (DESIGN.md Screen — Call page PC-R2/PC-R3), as mutations of the
// fixture world: the fixture's past call "Backend sync" with its outputs written the way the stories' preconditions
// say. Tests only; the real core takes the whole world through harness.world_set, the fake through the plan.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, type Page } from "@playwright/test";

import type { ItemView, OutputSection, SectionKind, SectionState } from "../../../src/core/bindings";
import * as W from "../../support/world-presets";
import type { World } from "../../support/scenario";
import { openWindow, type Steer } from "./app";

export const TITLE = "Backend sync";
export const WRITER = { from_pass: "live", generated_at: 1792140600000, model: "claude-sonnet", runtime: "claude_api_key", skill: "planning", skill_version: "1.0.0" } as const;

export const outputsOf = (w: World) => w.outputs.find((o) => o.call_id === W.PAST_CALL)!;
export const sectionOf = (w: World, kind: SectionKind) => outputsOf(w).sections.find((s) => s.kind === kind)!;

function item(w: World, id: string, kind: ItemView["kind"], text: string, review: ItemView["review"]): ItemView {
  const base = w.items.find((i) => i.id === "itm_token")!;
  return { ...structuredClone(base), id, kind, text, review, status: "open", closed_by: null, done_at: null, linked_issue: null } as ItemView;
}

function textSection(kind: SectionKind, id: string, body: string, rev = 2, versions = 2): OutputSection {
  return { kind, state: { type: "ready" }, summary_id: id, rev, body_md: body, items: [], reviews: [], writer: structuredClone(WRITER), user_edited: false, regenerated_with_edits: false, version_count: versions } as OutputSection;
}

function itemSection(kind: SectionKind, items: ItemView[]): OutputSection {
  return { kind, state: { type: items.length ? "ready" : "empty" }, summary_id: null, rev: null, body_md: null, items, reviews: [], writer: structuredClone(WRITER), user_edited: false, regenerated_with_edits: false, version_count: 1 } as OutputSection;
}

/** The call's outputs written and reviewed, as the real core's scripted runtime writes them: Summary, 1 decision, 1 action item. */
export function written(w: World): void {
  W.idle(w);
  const o = outputsOf(w);
  o.status = "ready";
  o.review_waiting = 0;
  o.sections = [
    textSection("summary", "sum_backend", "Backend and QA aligned on the websocket notifications. Drawer events will ship behind a flag."),
    itemSection("decisions", [item(w, "itm_d1", "decision", "Scripted decision", "accepted")]),
    itemSection("action_items", [item(w, "itm_a0", "action_item", "Scripted action item", "accepted")]),
    itemSection("open_questions", []),
    itemSection("per_participant" as SectionKind, []),
  ];
  w.items = [...w.items.filter((i) => !o.sections.some((s) => s.items.some((x) => x.id === i.id))), ...o.sections.flatMap((s) => s.items)];
}

/** A section's state with its body kept (writing, failed, pending). */
export function setState(w: World, kind: SectionKind, state: SectionState): void {
  sectionOf(w, kind).state = state;
}

/** Outputs still being written: Summary writing, the rest waiting. */
export function writing(w: World): void {
  written(w);
  const o = outputsOf(w);
  o.status = "writing";
  for (const s of o.sections) {
    Object.assign(s, { state: { type: s.kind === "summary" ? "writing" : "pending" }, body_md: null, items: [], summary_id: null, rev: null, version_count: 0 });
  }
}

/** Action items failed (Claude Code timed out); the others stay ready. */
export function actionItemsFailed(w: World): void {
  written(w);
  outputsOf(w).status = "partially_failed";
  Object.assign(sectionOf(w, "action_items"), { state: { type: "failed", code: "runtime_unavailable", local_fallback_available: true }, items: [] });
}

/** The decision and the action item not reviewed yet (Share › Includes 2 suggested items not reviewed yet). */
export function suggested(w: World): void {
  written(w);
  const o = outputsOf(w);
  for (const kind of ["decisions", "action_items"] as const) sectionOf(w, kind).items.forEach((i) => ((i.review = "suggested"), (i.created_by = "llm")));
  o.review_waiting = 2;
  w.items = w.items.map((i) => o.sections.flatMap((x) => x.items).find((x) => x.id === i.id) ?? i);
}

/** The call is marked sensitive and written by the local model. */
export function sensitive(w: World): void {
  written(w);
  outputsOf(w).sensitive = true;
  outputsOf(w).written_locally = true;
  const d = w.call_details.find((x) => x.call.id === W.PAST_CALL)!;
  d.call.privacy = "sensitive";
  w.calls.find((c) => c.id === W.PAST_CALL)!.privacy = "sensitive";
}

// ---- The real core (option A): outputs are produced, not set. `harness.world_set` refuses the outputs slice, so the
// call is recorded, stopped and written by the scripted runtime (`--llm-script`), as tests/conformance/m2-stories-postcall
// does. Tests ask for a state by name; the fake takes the preset above, the real core the run below.
export const REAL = process.env.NOTER_CORE === "stdio";
export type Kind = "written" | "writing" | "actionItemsFailed" | "suggested" | "sensitive" | "emptySections" | "actionSuggested";
/** `world` tunes the fake's preset; `edits` is how many times the user edited the Summary (the real core gets them as output_edit). */
export interface Opts {
  world?: (w: World) => void;
  edits?: number;
}
export interface Opened {
  steer: Steer;
  /** The call whose page the test opens: the fixture's past call on the fake, the recorded one on the real core. */
  call: string;
}

const LINES = ["Let's ship the drawer redesign in 8.0.", "Anna takes the virtualised table.", "Who owns the reconnect is still open."];
const segment = (n: number, call: string) => ({
  id: `live_${n}`, call_id: call, channel: "sys", t0_ms: n * 4000, t1_ms: n * 4000 + 3000, state: "confirmed", lang: "en", lang_p: 0.98,
  speaker_label: "spk_1", text: LINES[n], words_path: null, avg_logprob: -0.1, no_speech_p: 0.01, corrections: [], crosstalk_labels: [],
});
// Evidence ids are the core's own (`seg_<ulid>`), unknown when the script is written, so the scripted lines carry no
// items: the runtime's built-in output supplies one decision and one action item citing the call's first segment.
const SUMMARY = "Backend and QA aligned on the websocket notifications. Drawer events will ship behind a flag.";
const NONE = { lang: "en", summary_md: SUMMARY, decisions: [], action_items: [], open_questions: [], risks: [], per_participant: [], extras_md: null };
const line = (extra: object = {}) => ({ on: "post-call", output: NONE, ...extra });

/** The scripted runtime's lines for a state: the first answers the Summary, later ones are the runtime's own. */
function script(kind: Kind): object[] {
  if (kind === "writing") return [line({ after_ms: 4000 })];
  if (kind === "actionItemsFailed") return [line(), line(), { on: "post-call", fail: "timeout" }];
  if (kind === "emptySections") return Array.from({ length: 18 }, () => line());
  return [line()];
}

/** Drives a command of the real core from the open page, as the window does. */
export const invoke = (page: Page, cmd: string, args: unknown) =>
  page.evaluate(([c, a]) => (globalThis as unknown as { __TAURI_INTERNALS__: { invoke(c: string, p: unknown): Promise<unknown> } }).__TAURI_INTERNALS__.invoke(c, { args: a }).catch((e: unknown) => { throw new Error(JSON.stringify(e)); }), [cmd, args] as const);

/** Opens the main window on a call whose outputs are in `kind`'s state. `tweak` changes the fake's world only. */
export async function openOutputs(page: Page, kind: Kind, opts: Opts = {}): Promise<Opened> {
  if (!REAL) {
    const steer = await openWindow(page, "main", { world: (w) => (preset[kind](w), opts.world?.(w)) });
    return { steer, call: W.PAST_CALL };
  }
  const base = process.env.NOTER_CORE_CMD!;
  const file = join(mkdtempSync(join(tmpdir(), "noter-outputs-")), "llm.jsonl");
  writeFileSync(file, script(kind).map((l) => JSON.stringify(l)).join("\n") + "\n");
  process.env.NOTER_CORE_CMD = `${base} --llm-script ${file}`;
  let steer: Steer;
  try {
    steer = await openWindow(page, "main", {
      world: (w) => {
        W.idle(w);
        w.app.setup.self_test = { type: "passed", at: Date.now() };
        w.app.setup.detection_enabled = true;
      },
    });
  } finally {
    process.env.NOTER_CORE_CMD = base;
  }
  await page.waitForFunction(() => "__TAURI_INTERNALS__" in globalThis);
  const started = (await invoke(page, "capture_start", { source: "today", sensitive: kind === "sensitive" })) as { call_id: string };
  const call = started.call_id;
  for (const n of LINES.keys()) {
    await expect.poll(async () => ((await invoke(page, "harness.engine_fact", { event: { type: "segment", segment: segment(n, call) } })) as { delivered: boolean }).delivered).toBe(true);
  }
  await invoke(page, "capture_stop", { call_id: call });
  if (kind === "writing") return { steer, call };
  await expect.poll(async () => ((await invoke(page, "outputs_get", { call_id: call })) as { status: string }).status, { timeout: 30_000 }).not.toMatch(/^(writing|not_started)$/);
  // The scripted items arrive as suggestions; "written" says the user reviewed them, "threeSuggested" leaves three.
  if (kind !== "actionItemsFailed") await review(page, call, kind === "suggested" ? "all" : kind === "actionSuggested" ? "actions" : "none");
  for (let n = 1; n <= (opts.edits ?? 0); n++) {
    const summary = ((await invoke(page, "outputs_get", { call_id: call })) as { sections: Array<{ kind: string; summary_id: string; rev: number }> }).sections.find((x) => x.kind === "summary")!;
    await invoke(page, "output_edit", { call_id: call, summary_id: summary.summary_id, rev: summary.rev, body_md: `${SUMMARY} Edit ${n}.` });
  }
  return { steer, call };
}

/** Accepts the suggested items that `keep` does not leave: all of them, none, or the action item alone. */
async function review(page: Page, call: string, keep: "all" | "actions" | "none"): Promise<void> {
  const out = (await invoke(page, "outputs_get", { call_id: call })) as { sections: Array<{ kind: string; items: Array<{ id: string; rev: number; review: string }> }> };
  for (const x of out.sections) {
    if (keep === "all" || (keep === "actions" && x.kind === "action_items")) continue;
    for (const i of x.items) if (i.review === "suggested") await invoke(page, "item_review", { item_id: i.id, rev: i.rev, decision: "accept" });
  }
}

/** What the core does by itself on the real core (a scripted answer lands, a review is done) the fake takes as a steer; `real` runs on the real core. */
export async function after(page: Page, o: Opened, mutate: (w: World) => void, real?: () => Promise<void>): Promise<void> {
  if (REAL) await real?.();
  else await o.steer.change(mutate);
}

/** The rest of a "writing" state lands: the script's own delay on the real core (the test's expects wait). */
export const finish = (page: Page, o: Opened) => after(page, o, written);

/** The user reviewed every suggested item. */
export const acceptAll = (page: Page, o: Opened) =>
  after(page, o, (w) => {
    sectionOf(w, "action_items").items.forEach((i) => (i.review = "accepted"));
    outputsOf(w).review_waiting = 0;
    w.items.forEach((i) => i.call.id === o.call && (i.review = "accepted"));
  }, () => review(page, o.call, "none"));

function actionSuggested(w: World): void {
  suggested(w);
  sectionOf(w, "decisions").items[0].review = "accepted";
  outputsOf(w).review_waiting = 1;
}
function emptySections(w: World): void {
  written(w);
  for (const kind of ["decisions", "action_items", "open_questions"] as const) Object.assign(sectionOf(w, kind), { state: { type: "empty" }, items: [] });
}
const preset: Record<Kind, (w: World) => void> = { written, writing, actionItemsFailed, suggested, sensitive, emptySections, actionSuggested };
