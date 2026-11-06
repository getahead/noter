// Pure rules of Share, Export and tags on the call page: the scope a control stands for, whether copying can start,
// the label that confirms it and tag validation. Nothing here reads the store or draws.
import type { CallRow, CallOutputs, SectionKind, ShareFormat, ShareScope } from "../../core/bindings";
import { t } from "../../i18n/format";
import { SECTION_LABEL } from "./outputs-logic";

/** Where Share was invoked: the toolbar (whole call) or a section's own button. */
export type ShareOrigin = { type: "toolbar" } | { type: "section"; kind: SectionKind } | { type: "row"; kind: SectionKind; id: string };

// @cpt-algo:cpt-noter-algo-ui-call-page-outputs-project:p1
/** The core's scope for the invoking control; `include_unreviewed` only when the notice made it explicit. */
export function scopeOf(origin: ShareOrigin, includeUnreviewed: boolean): ShareScope {
  // @cpt-begin:cpt-noter-algo-ui-call-page-outputs-project:p1:inst-scope
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-scope
  return { sections: origin.type === "toolbar" ? [] : [origin.kind], item_ids: origin.type === "row" ? [origin.id] : [], include_unreviewed: includeUnreviewed };
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-share:p1:inst-scope
  // @cpt-end:cpt-noter-algo-ui-call-page-outputs-project:p1:inst-scope
}

/** The menu's first line. */
export const scopeLine = (origin: ShareOrigin): string => (origin.type === "row" ? t("share.this_item") : origin.type === "section" ? t(SECTION_LABEL[origin.kind]) : t("share.whole_call"));

/** Copying needs ready outputs (before they are read the core decides: `outputs_not_ready`); a sensitive call says so and confirms with a plain **Copied**. */
export const shareState = (o: Pick<CallOutputs, "status" | "sensitive"> | undefined, privacy?: CallRow["privacy"]) => ({ ready: !o || (o.status !== "writing" && o.status !== "not_started"), sensitive: privacy ? privacy === "sensitive" : !!o?.sensitive });

const FORMAT_LABEL = { slack: "share.copied.slack", jira: "share.copied.jira", markdown: "share.copied.markdown" } as const;
export const copiedLabel = (f: ShareFormat, sensitive: boolean): string => t(sensitive ? "share.copied" : FORMAT_LABEL[f]);

const CHORDS: Record<string, ShareFormat | "export"> = { "Shift+Meta+KeyC": "slack", "Alt+Meta+KeyC": "jira", "Alt+Shift+Meta+KeyC": "markdown", "Meta+KeyE": "export" };
/** What a shortcut chord asks for; ⌘C is the standard copy and stays out. */
export const shareKey = (chord: string): ShareFormat | "export" | null => CHORDS[chord] ?? null;

/** A tag to add: trimmed, 1–32 characters, not one the call has ignoring case. */
export function validateTag(raw: string, have: readonly string[]): { ok: true; tag: string } | { ok: false; error: string } {
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-tags
  const tag = raw.trim();
  if (!tag) return { ok: false, error: t("tags.empty") };
  if ([...tag].length > 32) return { ok: false, error: t("tags.long") };
  if (have.some((x) => x.toLowerCase() === tag.toLowerCase())) return { ok: false, error: t("tags.duplicate") };
  return { ok: true, tag };
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-tags
}
