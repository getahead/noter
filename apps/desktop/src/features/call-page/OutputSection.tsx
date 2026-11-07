// One output section of the Summary view (PC-R3): a header with its count and actions, a meta line, and its body: the
// text of a prose section (to read, edit, compare), the rows of an item section, or what it is waiting for.
import { useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { MsgKey } from "../../i18n/en";
import type { CallRow, OutputSection as Section, UiPrefs, VersionMeta } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Badge } from "../../ui/primitives/badge";
import { PushButton } from "../../ui/primitives/push-button";
import { TextField } from "../../ui/primitives/text-field";
import { DiffView } from "../../ui/diff/DiffView";
import { MarkdownBody } from "./markdown";
import { OutputItemRow } from "./OutputItemRow";
import { commitDraft, loadVersions, readVersion } from "./outputs-actions";
import { bodyOf, useVersions } from "./outputs-cache";
import { isProse, versionName, metaLine, SECTION_LABEL, sectionCounts, sectionId } from "./outputs-logic";
import { ShareMenu } from "./ShareMenu";
import { slots } from "./slots";
import { VersionSwitcher } from "./VersionSwitcher";

const EMPTY: Partial<Record<Section["kind"], MsgKey>> = { decisions: "outputs.empty.decisions", action_items: "outputs.empty.action_items", open_questions: "outputs.empty.open_questions" };
type Draft = { summaryId: string; baseRev: number; text: string };

// @cpt-component:cpt-noter-component-ui-output-section:p1
export function OutputSection({ bridge, call, section, prefs, writing, onRegenerate }: { bridge: Bridge; call: CallRow; section: Section; prefs: UiPrefs; writing: boolean; onRegenerate: (local: boolean) => void }) {
  const heading = t(SECTION_LABEL[section.kind]);
  const prose = isProse(section.kind);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<"conflict" | "error" | null>(null);
  const [saved, setSaved] = useState(false);
  const [showing, setShowing] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);
  const versions = useVersions(section.summary_id);
  const state = section.state.type;
  const edits = (versions?.versions ?? []).filter((v) => v.kind === "user_edit").length;
  // the count in "Regenerated · your 2 edits kept" comes from the version list
  useEffect(() => {
    if (section.regenerated_with_edits && section.summary_id && !versions) void loadVersions(bridge, section.summary_id);
  }, [bridge, section.regenerated_with_edits, section.summary_id, versions]);
  const counts = sectionCounts(section);
  const Row = section.kind === "action_items" ? slots.actionItemRow : null;
  const RejectedList = slots.rejectedList;

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(id);
  }, [saved]);

  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-edit
  // @cpt-begin:cpt-noter-state-ui-call-page-outputs-section:p1:inst-edit
  const edit = () => setDraft({ summaryId: section.summary_id!, baseRev: section.rev ?? 0, text: section.body_md ?? "" });
  // @cpt-end:cpt-noter-state-ui-call-page-outputs-section:p1:inst-edit
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-edit
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-cancel
  // @cpt-begin:cpt-noter-state-ui-call-page-outputs-section:p1:inst-cancel
  const cancel = () => (setDraft(null), setError(null));
  // @cpt-end:cpt-noter-state-ui-call-page-outputs-section:p1:inst-cancel
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-cancel
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    const r = await commitDraft(bridge, call.id, draft);
    setSaving(false);
    setError(r === "ok" ? null : r);
    if (r !== "ok") return; // the draft stays; only a new save replaces it
    // @cpt-begin:cpt-noter-state-ui-call-page-outputs-section:p1:inst-saved
    setDraft(null);
    setSaved(true);
    // @cpt-end:cpt-noter-state-ui-call-page-outputs-section:p1:inst-saved
  };

  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-version
  const show = async (id: string | null) => {
    setVersionError(null);
    if (id && section.summary_id && !(await readVersion(bridge, section.summary_id, id))) return setVersionError(id);
    setShowing(id);
  };
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-version
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-diff
  // @cpt-begin:cpt-noter-state-ui-call-page-outputs-section:p1:inst-compare
  // @cpt-begin:cpt-noter-state-ui-call-page-outputs-section:p1:inst-hide
  const compare = async () => {
    if (comparing || !section.summary_id) return setComparing(false);
    // the version before the newest, or the one on show, against the text now
    const list: VersionMeta[] = versions?.versions ?? (await loadVersions(bridge, section.summary_id).then((r) => (r.status === "ok" ? r.data.versions : [])));
    const older = showing ?? [...list].sort((a, b) => b.created_at - a.created_at)[1]?.id ?? null;
    if (!older) return;
    await show(older);
    setComparing(true);
  };
  // @cpt-end:cpt-noter-state-ui-call-page-outputs-section:p1:inst-hide
  // @cpt-end:cpt-noter-state-ui-call-page-outputs-section:p1:inst-compare
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-diff
  const shown = showing && section.summary_id ? bodyOf(section.summary_id, showing) : undefined;

  const body = () => {
    if (state === "pending") return <p className="np-dim">{t("outputs.waiting")}</p>;
    if (state === "writing" && !section.body_md && !section.items.length) return <p className="np-dim">{prose ? t("outputs.writing_summary") : t("outputs.writing_items", { section: heading.toLowerCase() })}</p>;
    // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-notification:p1:inst-failed
    if (state === "failed")
      return (
        <InlineBanner
          banner={{
            id: sectionId("failed", section.kind),
            severity: "error",
            text: t(section.state.type === "failed" && section.state.code === "internal" ? "outputs.failed" : "outputs.failed_timeout", { section: heading.toLowerCase() }),
            actions: [{ label: t("outputs.try_again"), onAction: () => onRegenerate(false) }, ...(section.state.type === "failed" && section.state.local_fallback_available ? [{ label: t("outputs.use_local"), onAction: () => onRegenerate(true) }] : [])],
          }}
        />
      );
    // @cpt-end:cpt-noter-flow-ui-call-page-outputs-notification:p1:inst-failed
    if (state === "empty")
      return (
        <>
          <p className="np-dim">{t(EMPTY[section.kind] ?? "outputs.empty")}</p>
          {section.kind === "action_items" && slots.addItem && <slots.addItem bridge={bridge} callId={call.id} />}
        </>
      );
    if (draft)
      return (
        <div onKeyDown={(e) => (e.key === "Escape" ? (e.stopPropagation(), cancel()) : e.key === "Enter" && e.metaKey && (e.preventDefault(), void save()))}>
          <TextField multiline rows={8} value={draft.text} ariaLabel={t("outputs.edit_field", { section: heading })} onChange={(text) => setDraft({ ...draft, text })} />
          {error && <div role="alert" className="pc-sec__error">{t(error === "conflict" ? "outputs.conflict" : "outputs.save_error")}</div>}
          <div className="pc-sec__edit">
            <span className="np-dim">{t("outputs.edit_hint")}</span>
            <PushButton label={t("outputs.cancel")} onAction={cancel} />
            <PushButton label={t("outputs.save")} variant="primary" loading={saving} onAction={() => void save()} />
          </div>
        </div>
      );
    if (prose) {
      if (comparing && shown) return <DiffView before={shown.body_md} after={section.body_md ?? ""} title={t("outputs.diff_head", { from: versionName(shown.meta), to: section.user_edited ? t("outputs.your_edit_short") : t("outputs.current") })} />;
      return <MarkdownBody md={shown ? shown.body_md : (section.body_md ?? "")} />;
    }
    return <>
      <ul className="pc-items">{section.items.filter((i) => Row || i.review !== "rejected").map((i) => (Row ? <li key={i.id}><Row bridge={bridge} item={i} /></li> : <OutputItemRow key={i.id} bridge={bridge} item={i} />))}</ul>
      {section.kind === "action_items" && slots.addItem && <slots.addItem bridge={bridge} callId={call.id} />}
      {RejectedList && <RejectedList bridge={bridge} items={section.items} />}
    </>;
  };

  return (
    <section className="pc-sec" data-component="cpt-noter-component-ui-output-section" data-kind={section.kind} data-state={state} aria-label={heading}>
      <div className="pc-sec__head">
        <span className="pc-sec__title">
          {heading}
          {!prose && (state === "ready" || state === "empty") && <span className="pc-sec__count"> · {counts.shown}</span>}
          {counts.review > 0 && <Badge kind="count" tone="accent" text={t("outputs.review_count", { n: counts.review })} />}
          {section.user_edited && <Badge kind="status" text={t("outputs.edited")} />}
        </span>
        {!prose && state === "ready" && (
          <span className="pc-sec__actions">
            <ShareMenu bridge={bridge} callId={call.id} origin={{ type: "section", kind: section.kind }} id={`pc-share-${section.kind}`} />
          </span>
        )}
        {prose && state === "ready" && !draft && (
          <span className="pc-sec__actions">
            {saved && <span className="np-dim" role="status">{t("outputs.saved")}</span>}
            <PushButton label={t("outputs.edit")} variant="quiet" onAction={edit} />
            <VersionSwitcher bridge={bridge} section={section} prefs={prefs} showing={showing} onShow={(id) => void show(id)} comparing={comparing} onCompare={() => void compare()} />
            <PushButton label={t("outputs.regenerate")} variant="quiet" disabled={writing} onAction={() => onRegenerate(false)} />
          </span>
        )}
      </div>
      {shown && !comparing && (
        <div className="pc-sec__notice">
          {t("outputs.showing", { n: versions?.versions.find((v) => v.id === showing)?.n ?? 0 })} · <button type="button" className="np-link" onClick={() => setShowing(null)}>{t("outputs.back_to_current")}</button>
        </div>
      )}
      {versionError && (
        <div role="alert" className="pc-sec__error">
          {t("outputs.version_error")} <button type="button" className="np-link" onClick={() => void show(versionError)}>{t("outputs.try_again")}</button>
        </div>
      )}
      {state === "ready" && section.kind === "summary" && section.writer && <div className="pc-sec__meta">{metaLine(section, call, heading)}</div>}
      {section.regenerated_with_edits && state === "ready" && !draft && (
        <div className="pc-sec__notice">
          {t("outputs.regenerated", { n: edits })} · <button type="button" className="np-link" onClick={() => void compare()}>{comparing ? t("outputs.hide_diff") : t("outputs.show_diff")}</button>
        </div>
      )}
      {state === "writing" && (section.body_md || section.items.length > 0) && <div className="pc-sec__meta" role="status">{t("outputs.regenerating")}</div>}
      <div className="pc-sec__body">{body()}</div>
    </section>
  );
}
