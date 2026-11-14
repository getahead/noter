// The prompt of a handoff, read and edited in place: the file caption, **Edited**, the versions and **Diff** above a
// monospace area (DESIGN › Prompt editor). The editor saves nothing; the drawer's actions do.
import { useState } from "react";

import { elementId } from "../../app/element-id";
import type { UiPrefs, VersionMeta } from "../../core/bindings";
import { clock, t } from "../../i18n/format";
import { Badge } from "../../ui/primitives/badge";
import { PushButton } from "../../ui/primitives/push-button";
import { TextField } from "../../ui/primitives/text-field";
import { DiffView } from "../../ui/diff/DiffView";
import { VersionMenu } from "../call-page/VersionSwitcher";
import "./handoff.css";

export interface PromptEditorProps {
  itemId: string;
  value: string;
  /** The user's edit is held (saved or not). */
  edited: boolean;
  generating?: boolean;
  /** The generated prompt to compare with; the Diff toggle shows only with it. */
  generated: string | null;
  versions: VersionMeta[];
  prefs: UiPrefs;
  showDiff: boolean;
  onDiff: () => void;
  onChange: (value: string) => void;
}


/** The versions the core lists, then **Your Edit** while one is held and the core has not listed it. */
export function versionEntries(versions: VersionMeta[], edited: boolean, prefs: UiPrefs): Array<{ label: string; checked: boolean }> {
  const listed = versions.map((v) => ({ v, label: v.kind === "user_edit" ? t("outputs.your_edit", { time: clock(v.created_at, prefs) }) : t("handoff.generated", { n: v.n, time: clock(v.created_at, prefs) }) }));
  const held = listed.at(-1)?.v.kind === "user_edit";
  const last = listed.length - 1;
  return [...listed.map((e, i) => ({ label: e.label, checked: i === last && (!edited || held) })), ...(edited && !held ? [{ label: t("outputs.your_edit_short"), checked: true }] : [])];
}

// @cpt-component:cpt-noter-component-ui-prompt-editor:p1
export function PromptEditor({ itemId, value, edited, generating, generated, versions, prefs, showDiff, onDiff, onChange }: PromptEditorProps) {
  const [open, setOpen] = useState(false);
  const entries = versionEntries(versions, edited, prefs);
  const versionLabel = edited ? t("outputs.your_edit_short") : `v${versions.at(-1)?.n ?? 1}`;
  const id = elementId("hv", itemId);
  const diffOn = showDiff && generated !== null && !generating;
  return (
    <div className="pc-prompt" data-component="cpt-noter-component-ui-prompt-editor" data-variant="editable" data-state={generating ? "generating" : diffOn ? "diff-mode" : edited ? "edited" : "editing"}>
      <div className="pc-prompt__head">
        <span className="np-mono pc-prompt__cap">{t("handoff.file", { item: itemId })}</span>
        {edited && <Badge kind="status" text={t("handoff.edited")} />}
        {(entries.length > 1 || edited) && (
          <VersionMenu caption id={id} label={versionLabel} ariaLabel={`${t("outputs.version")}: ${versionLabel}`} open={open} onToggle={() => setOpen(!open)} onClose={() => setOpen(false)} items={[
            ...entries.map((entry) => ({ label: entry.label, checked: entry.checked, disabled: !entry.checked })),
            ...(versions.length > 1 ? [{ header: t("handoff.version_unavailable") }] : []),
            ...(generated !== null ? [{ divider: true as const }, { label: t(diffOn ? "outputs.hide_diff" : "outputs.compare"), onSelect: onDiff }] : []),
          ]} />
        )}
        <span className="np-tb__spacer" />
        {generated !== null && !generating && <PushButton label={t(diffOn ? "handoff.hide_diff" : "handoff.diff")} size="small" variant="quiet" attrs={{ "aria-pressed": String(diffOn) }} onAction={onDiff} />}
      </div>
      {generating ? (
        <div className="pc-prompt__area pc-prompt__skel" aria-hidden="true">
          <span style={{ width: "70%" }} />
          <span style={{ width: "88%" }} />
          <span style={{ width: "52%" }} />
        </div>
      ) : diffOn ? (
        // @cpt-begin:cpt-noter-flow-ui-handoff-prepare:p1:inst-diff
        <div className="pc-prompt__area is-diff">
          <div className="pc-prompt__diffnote">{t("handoff.showing_changes")}</div>
          <DiffView before={generated!} after={value} />
          {/* @cpt-end:cpt-noter-flow-ui-handoff-prepare:p1:inst-diff */}
        </div>
      ) : (
        <div className="pc-prompt__area">
          <TextField multiline mono variant="multi" rows={12} ariaLabel={t("handoff.prompt")} value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}
