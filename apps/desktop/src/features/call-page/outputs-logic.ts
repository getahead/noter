// Pure rules of the call page outputs: section order, counts, progress events and the word diff. Nothing here reads
// the store or draws.
import type { CallOutputs, CallRow, OutputSection, OutputsProgress, RuntimeChoice, SectionKind, UiPrefs, VersionMeta } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { clock } from "./logic";

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

/** `outputs:progress` for this call and section: its state changes and the text it already had stays. Another call's event returns the same array. */
export function applyProgress(sections: OutputSection[], callId: string, e: OutputsProgress): OutputSection[] {
  // @cpt-begin:cpt-noter-algo-ui-call-page-outputs-project:p1:inst-progress
  if (e.call_id !== callId || !sections.some((s) => s.kind === e.section)) return sections;
  return sections.map((s) => (s.kind === e.section ? { ...s, state: e.state } : s));
  // @cpt-end:cpt-noter-algo-ui-call-page-outputs-project:p1:inst-progress
}

/** The section the page draws: the whole one the core sent last, else the read one, with the state progress reported since. */
export function mergeSection(read: OutputSection | undefined, sent: OutputSection | undefined, progress: OutputsProgress | undefined): OutputSection | undefined {
  const base = sent ?? read;
  return base && progress && progress.state.type !== base.state.type ? { ...base, state: progress.state } : base;
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
  const after = Math.round(Math.max(0, w.generated_at - call.started_at - call.duration_ms) / 1000);
  const time = after < 60 ? t("outputs.s", { s: String(after) }) : t("outputs.min_s", { m: String(Math.floor(after / 60)), s: String(after % 60) });
  return [heading, language, runtimeLabel(w.runtime), t("outputs.after_call", { time })].filter(Boolean).join(" · ");
}

/** A version's short name: **v1**, **Your Edit**. */
export const versionName = (v: VersionMeta): string => (v.kind === "user_edit" ? t("outputs.your_edit_short") : `v${v.n}`);

/** A version's menu label: **v2 · Claude Code** for a generated one, **Your Edit · 10:42** for the user's. */
export function versionLabel(v: VersionMeta, prefs: UiPrefs): string {
  const time = clock(v.created_at, prefs);
  return v.kind === "user_edit" ? t("outputs.your_edit", { time }) : [`v${v.n}`, v.writer && runtimeLabel(v.writer.runtime), time].filter(Boolean).join(" · ");
}

/** Whether the outputs still wait for the model: the banner, and the sections that say so. */
export const isWriting = (o: Pick<CallOutputs, "status"> | undefined): boolean => o?.status === "writing";
