// Starting states of the call-page outputs stories (DESIGN.md Screen — Call page PC-R2/PC-R3), as mutations of the
// fixture world: the fixture's past call "Backend sync" with its outputs written the way the stories' preconditions
// say. Tests only; the real core takes the whole world through harness.world_set, the fake through the plan.
import type { Page } from "@playwright/test";
import { openWindow } from "./app";

import type { ItemView, OutputSection, SectionKind, SectionState } from "../../../src/core/bindings";
import * as W from "../../support/world-presets";
import type { World } from "../../support/scenario";

export const TITLE = "Backend sync";
const WRITER = { from_pass: "live", generated_at: 1792140600000, model: "claude-sonnet", runtime: "claude_api_key", skill: "planning", skill_version: "1.0.0" } as const;

export const outputsOf = (w: World) => w.outputs.find((o) => o.call_id === W.PAST_CALL)!;
export const sectionOf = (w: World, kind: SectionKind) => outputsOf(w).sections.find((s) => s.kind === kind)!;

function item(w: World, id: string, kind: ItemView["kind"], text: string, review: ItemView["review"]): ItemView {
  const base = w.items.find((i) => i.id === "itm_token")!;
  return { ...structuredClone(base), id, kind, text, review, status: "open", closed_by: null, done_at: null, linked_issue: null } as ItemView;
}

function textSection(kind: SectionKind, id: string, body: string, rev = 2, versions = 2): OutputSection {
  return { kind, state: { type: "ready" }, summary_id: id, rev, body_md: body, items: [], reviews: [], writer: structuredClone(WRITER), user_edited: false, regenerated_with_edits: false, names_updated: false, version_count: versions } as OutputSection;
}

function itemSection(kind: SectionKind, items: ItemView[]): OutputSection {
  return { kind, state: { type: items.length ? "ready" : "empty" }, summary_id: null, rev: null, body_md: null, items, reviews: [], writer: structuredClone(WRITER), user_edited: false, regenerated_with_edits: false, names_updated: false, version_count: 1 } as OutputSection;
}

/** The call's outputs written and reviewed: Summary, Decisions 2, Action items 4, Open questions 2, Per participant. */
export function written(w: World): void {
  W.idle(w);
  const o = outputsOf(w);
  o.status = "ready";
  o.review_waiting = 0;
  o.sections = [
    textSection("summary", "sum_backend", "Backend and QA aligned on the websocket notifications. Drawer events will ship behind a flag."),
    itemSection("decisions", [item(w, "itm_d1", "decision", "Ship drawer events behind a flag", "accepted"), item(w, "itm_d2", "decision", "Keep the polling fallback for one release", "accepted")]),
    itemSection("action_items", ["Rotate the staging Jira token", "Write the flag rollout note", "Ask QA for a websocket soak run", "Update the drawer spec"].map((t, i) => item(w, `itm_a${i}`, "action_item", t, "accepted"))),
    itemSection("open_questions", [item(w, "itm_q1", "open_question", "Who owns the soak run?", "accepted"), item(w, "itm_q2", "open_question", "Does Safari need the fallback?", "accepted")]),
    textSection("per_participant", "sum_pp_backend", "Dmitri: flag. Oleg: soak run. You: spec.", 1, 1),
  ];
  w.items = [...w.items.filter((i) => i.call.id !== W.PAST_CALL), ...o.sections.flatMap((s) => s.items)];
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
  w.items = w.items.filter((i) => i.call.id !== W.PAST_CALL);
  for (const s of o.sections) {
    Object.assign(s, { state: { type: s.kind === "summary" ? "writing" : "pending" }, body_md: null, items: [], summary_id: null, rev: null, version_count: 0 });
  }
}

/** Local writing has provenance in a stored empty draft, not only the fake world's aggregate flag. */
export function writingLocally(w: World): void {
  writing(w);
  outputsOf(w).written_locally = true;
  const summary = sectionOf(w, "summary");
  summary.body_md = "";
  summary.writer = { ...WRITER, runtime: "local" };
}

/** Action items failed (Claude Code timed out); the others stay ready. */
export function actionItemsFailed(w: World): void {
  written(w);
  outputsOf(w).status = "partially_failed";
  w.items = w.items.filter((i) => i.call.id !== W.PAST_CALL || i.kind !== "action_item");
  Object.assign(sectionOf(w, "action_items"), { state: { type: "failed", code: "runtime_unavailable", local_fallback_available: true }, items: [] });
}

/** Three suggested items not reviewed yet (Share › Includes 3 suggested items not reviewed yet). */
export function threeSuggested(w: World): void {
  written(w);
  const o = outputsOf(w);
  const a = sectionOf(w, "action_items");
  a.items.slice(0, 3).forEach((i) => ((i.review = "suggested"), (i.created_by = "llm")));
  o.review_waiting = 3;
  w.items = w.items.map((i) => a.items.find((x) => x.id === i.id) ?? i);
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

/** The shared written fixture works on both cores now that #312 imports outputs into the database. */
export async function openOutputs(page: Page, kind: "written") {
  const presets = { written };
  const steer = await openWindow(page, "main", { world: presets[kind] });
  return { steer, call: W.PAST_CALL };
}
