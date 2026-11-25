// Pure rules of the call page outputs: section order, counts, progress events and the word diff. Nothing here reads
// the store or draws.
import type { CallOutputs, CallRow, ItemView, OutputSection, OutputsProgress, RuntimeChoice, SectionKind, UiPrefs, VersionMeta } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { clock, duration, t } from "../../i18n/format";

// @cpt-algo:cpt-noter-algo-ui-call-page-outputs-project:p1
/** PRD order of the sections the Summary view shows; role reviews belong to the M4 view. */
const ORDER: readonly SectionKind[] = ["summary", "decisions", "action_items", "open_questions", "per_participant", "risks", "call_type_extras"];

export const SECTION_LABEL: Record<SectionKind, MsgKey> = {
  summary: "outputs.section.summary",
  decisions: "outputs.section.decisions",
  action_items: "outputs.section.action_items",
  open_questions: "outputs.section.open_questions",
  per_participant: "outputs.section.per_participant",
  risks: "outputs.section.risks",
  call_type_extras: "outputs.section.call_type_extras",
  role_reviews: "outputs.section.role_reviews",
};

/** Sections whose content is a text; the others are rows. */
export const isProse = (kind: SectionKind): boolean => kind === "summary" || kind === "per_participant";

/** An element id for a section (not text a user reads). */
export const sectionId = (prefix: string, kind: SectionKind): string => `${prefix}-${kind}`;

/** The sections in PRD order, without role reviews and without an empty Risks. */
export function orderSections(sections: readonly OutputSection[]): OutputSection[] {
  // @cpt-begin:cpt-noter-algo-ui-call-page-outputs-project:p1:inst-order
  return ORDER.flatMap((kind) => sections.filter((s) => s.kind === kind && !(kind === "risks" && s.items.length === 0)));
  // @cpt-end:cpt-noter-algo-ui-call-page-outputs-project:p1:inst-order
}

/** Visible (non-rejected) rows, those still suggested, and the rejected ones; no review while the section is still writing. */
export function sectionCounts(s: OutputSection): { shown: number; review: number; rejected: number } {
  // @cpt-begin:cpt-noter-algo-ui-call-page-outputs-project:p1:inst-count
  const rejected = s.items.filter((i) => i.review === "rejected").length;
  const writing = s.state.type === "writing" || s.state.type === "pending";
  const review = writing ? 0 : s.items.filter((i) => i.review === "suggested").length;
  return { shown: s.items.length - rejected, review, rejected };
  // @cpt-end:cpt-noter-algo-ui-call-page-outputs-project:p1:inst-count
}

/** Use the item store after a review mutation, while keeping the output snapshot as fallback. */
// @cpt-begin:cpt-noter-algo-ui-call-page-outputs-project:p1:inst-count
export const currentItems = (items: ItemView[], records: Record<string, ItemView>): ItemView[] =>
  items.map((item) => (records[item.id]?.rev >= item.rev ? records[item.id]! : item));
// @cpt-end:cpt-noter-algo-ui-call-page-outputs-project:p1:inst-count

/** The section the page draws: the whole one the core sent last, else the read one, with the state progress reported since. */
export function mergeSection(read: OutputSection | undefined, sent: OutputSection | undefined, progress: OutputsProgress | undefined): OutputSection | undefined {
  // @cpt-begin:cpt-noter-state-ui-call-page-outputs-section:p1:inst-start
  // @cpt-begin:cpt-noter-state-ui-call-page-outputs-section:p1:inst-ready
  // @cpt-begin:cpt-noter-state-ui-call-page-outputs-section:p1:inst-failed
  const base = sent ?? read;
  return base && progress && progress.state.type !== base.state.type ? { ...base, state: progress.state } : base; // the text it had stays
  // @cpt-end:cpt-noter-state-ui-call-page-outputs-section:p1:inst-failed
  // @cpt-end:cpt-noter-state-ui-call-page-outputs-section:p1:inst-ready
  // @cpt-end:cpt-noter-state-ui-call-page-outputs-section:p1:inst-start
}

const RUNTIME: Record<RuntimeChoice, MsgKey> = {
  claude_api_key: "outputs.runtime.claude",
  claude_account: "outputs.runtime.claude",
  codex_api_key: "outputs.runtime.codex",
  chatgpt_account: "outputs.runtime.codex",
  local: "outputs.runtime.local",
};
export const runtimeLabel = (r: RuntimeChoice): string => t(RUNTIME[r]);

/** **Summary · English · Claude Code · 1 min 40 s after the call**: what wrote the text and how long after the call it was ready. */
export function metaLine(s: OutputSection, call: Pick<CallRow, "started_at" | "duration_ms" | "languages">, heading: string): string {
  const w = s.writer;
  if (!w) return heading;
  // shortcut: the contract carries no language for a section, so the line names the interface language; use the writer's output language once it has one
  const language = t("outputs.language");
  return [heading, language, runtimeLabel(w.runtime), afterCall(w.generated_at, call)].filter(Boolean).join(" · ");
}

function afterCall(generatedAt: number, call: Pick<CallRow, "started_at" | "duration_ms">): string {
  const after = Math.round(Math.max(0, generatedAt - call.started_at - call.duration_ms) / 1000);
  const time = after < 60 ? t("outputs.s", { s: String(after) }) : after < 3600 ? t("outputs.min_s", { m: String(Math.floor(after / 60)), s: String(after % 60) }) : duration(after);
  return t("outputs.after_call", { time });
}

export function needsRegenerationSettings(outputs?: CallOutputs): boolean {
  const run = outputs?.processing_run;
  return run?.kind === "regeneration" && run.status === "failed" && run.error === "invalid_input";
}

// @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-processing
export function processingText(call: Pick<CallRow, "status" | "started_at" | "duration_ms">, outputs?: CallOutputs): string {
  if (call.status === "recording" || call.status === "paused") return t(`callpage.info.status.${call.status}`);
  if (!outputs) return "";
  if (outputs.waiting_for_power) return t("outputs.regen.power_title");
  const run = outputs.processing_run;
  if (needsRegenerationSettings(outputs)) return t("outputs.regen.missing_settings");
  if (run && run.status !== "succeeded") {
    return t(`callpage.processing.${run.kind === "regeneration" ? "regeneration" : "outputs"}.${run.status}`);
  }
  const writer = outputs.sections.find((s) => s.kind === "summary")?.writer;
  if (!writer || (!run && outputs.status !== "ready")) return t(`callpage.processing.${outputs.status}`);
  const line = t("callpage.processing.summary", { runtime: runtimeLabel(writer.runtime), after: afterCall(writer.generated_at, call) });
  if (!writer.cost_usd || (writer.runtime !== "claude_api_key" && writer.runtime !== "codex_api_key")) return line;
  return t("callpage.processing.cost", { line, cost: writer.cost_usd.toFixed(2) });
}
// @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-processing

/** A version's short name: **v1**, **Your Edit**. */
export const versionName = (v: VersionMeta): string => (v.kind === "user_edit" ? t("outputs.your_edit_short") : `v${v.n}`);

/** A version's menu label: **v2 · Claude Code** for a generated one, **Your Edit · 10:42** for the user's. */
export function versionLabel(v: VersionMeta, prefs: UiPrefs): string {
  const time = clock(v.created_at, prefs);
  return v.kind === "user_edit" ? t("outputs.your_edit", { time }) : [`v${v.n}`, v.writer && runtimeLabel(v.writer.runtime), time].filter(Boolean).join(" · ");
}

/** Whether the outputs still wait for the model: the banner, and the sections that say so. */
export const isWriting = (o: Pick<CallOutputs, "status"> | undefined): boolean => o?.status === "writing";

/** The displayed call's sections that received a new completion or failure event. */
// @cpt-begin:cpt-noter-flow-ui-call-page-outputs-notification:p1:inst-visible
export function settledSince(outputs: Pick<CallOutputs, "call_id" | "sections">, previous: Record<string, OutputsProgress>, current: Record<string, OutputsProgress>): string {
  return outputs.sections.flatMap(({ kind }) => {
    const key = `${outputs.call_id}/${kind}`;
    const event = current[key];
    if (!event || event === previous[key]) return [];
    const state = event.state.type;
    return state === "pending" || state === "writing" ? [] : [`${kind}:${state}`];
  }).join();
}
// @cpt-end:cpt-noter-flow-ui-call-page-outputs-notification:p1:inst-visible

/** Whether the view's newly settled sections include a ready Summary. */
export const summaryReadyNow = (settled: string): boolean => settled.split(",").includes("summary:ready");
