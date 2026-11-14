// The Item inspector (II-R1/II-R2, 320 pt): Details by kind and the item's History. Owner and Engineering apply at once;
// text, Due and Linked issue wait for Save. It opens through the shell's inspector override (`register.tsx`).
import { useEffect, useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { EvidenceView, ItemPatch, ItemView } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Badge } from "../../ui/primitives/badge";
import { Checkbox } from "../../ui/primitives/checkbox";
import { Link } from "../../ui/primitives/link";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { SegmentedControl } from "../../ui/primitives/segmented-control";
import { TextField } from "../../ui/primitives/text-field";
import { closeInspector } from "../shell/inspector-override";
import { HistoryTimeline } from "../history/HistoryTimeline";
import { applyPatch, loadDetail, reopen, review, saveFields } from "./actions";
import { ProvenanceChip } from "./ProvenanceChip";
import { draftOf, draftPatch, langOf } from "./review";
import { slots } from "./slots";

const STATUS = { open: "items.status.open", carried: "items.status.carried", handed_off: "items.status.handed_off", done: "items.status.done", closed_by_evidence: "items.status.closed_by_evidence", answered_in_call: "items.status.answered_in_call" } as const;
const KIND = { decision: "items.kind.decision", action_item: "items.kind.action_item", open_question: "items.kind.open_question", risk: "items.kind.risk" } as const;
type Tab = "details" | "history";
type Saved = "idle" | "saving" | "saved" | string;

function EvidenceRow({ bridge, e }: { bridge: Bridge; e: EvidenceView }) {
  return (
    <li className="ii-evidence">
      {e.span && <ProvenanceChip bridge={bridge} span={e.span} variant="chip" />}
      <span>{e.summary}</span>
    </li>
  );
}

// @cpt-component:cpt-noter-component-ui-item-inspector:p1
// @cpt-dod:cpt-noter-dod-ui-items-inspector:p1
export function ItemInspector({ bridge, itemId }: { bridge: Bridge; itemId: string }) {
  const it = useWindow(bridge, (s) => s.entities.item[itemId]);
  const people = useWindow(bridge, (s) => (it ? s.entities.call[it.call.id]?.participants : undefined)) ?? [];
  const [tab, setTab] = useState<Tab>("details");
  const [evidence, setEvidence] = useState<EvidenceView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<{ text: string; due: string; linked_issue: string } | null>(null);
  const [saved, setSaved] = useState<Saved>("idle");
  const draftBase = useRef<ItemView | null>(null);

  const load = async () => {
    setLoadError(false);
    // @cpt-begin:cpt-noter-flow-ui-items-evidence:p1:inst-get
    const found = await loadDetail(bridge, itemId);
    // @cpt-end:cpt-noter-flow-ui-items-evidence:p1:inst-get
    if (found) setEvidence(found);
    else setLoadError(true);
  };
  useEffect(() => void load(), [itemId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (saved !== "saved") return;
    const id = setTimeout(() => setSaved("idle"), 2000);
    return () => clearTimeout(id);
  }, [saved]);

  if (!it) return loadError ? <p role="alert" className="ii-error">{t("items.inspector_error")} <Link label={t("action.try_again")} onAction={() => void load()} /></p> : null;
  const action = it.kind === "action_item";
  const fields = draft ?? { text: it.text, due: it.due ?? "", linked_issue: it.linked_issue ?? "" };
  const dirty = draft !== null;
  const owners = [...(it.owner && !people.some((p) => p.id === it.owner!.id) ? [it.owner] : []), ...people];
  const apply = async (item: ItemView, patch: ItemPatch) => {
    const err = await applyPatch(bridge, item, patch);
    if (err) setSaved(err);
    else if (draftBase.current) draftBase.current = { ...(bridge.store.getState().entities.item[itemId] ?? item) };
  };
  const save = async () => {
    if (saved === "saving") return;
    setSaved("saving");
    const err = await saveFields(bridge, draftBase.current ?? it, fields);
    if (err) {
      // A conflict refreshed the item; retain the text and require an explicit save against that revision.
      draftBase.current = { ...(bridge.store.getState().entities.item[itemId] ?? it) };
      return setSaved(err);
    }
    draftBase.current = null;
    setDraft(null);
    setSaved("saved");
  };
  const set = (p: Partial<NonNullable<typeof draft>>) => {
    draftBase.current ??= { ...it };
    setDraft({ ...fields, ...p });
  };

  // @cpt-begin:cpt-noter-flow-ui-items-evidence:p1:inst-details
  // @cpt-begin:cpt-noter-flow-ui-items-evidence:p1:inst-kind
  const details = (
    <div className="ii-details" onKeyDown={(e) => e.key === "Enter" && e.metaKey && (e.preventDefault(), void save())}>
      <TextField multiline rows={3} value={fields.text} disabled={saved === "saving"} ariaLabel={t("items.field.text")} lang={langOf(it.lang)} onChange={(text) => set({ text })} />
      {action && (
        <>
          <label className="it-field">
            <span>{t("items.field.owner")}</span>
            <PopupButton options={[{ value: "", label: "—" }, ...owners.map((p) => ({ value: p.id, label: p.is_you ? t("cw.speaker.you") : p.short_name }))]} value={it.owner?.id ?? ""} label={t("items.field.owner")} onAction={(owner) => void apply(it, draftPatch({ ...draftOf(it), owner }, it))} />
          </label>
          <label className="it-field">
            <span>{t("items.field.due")}</span>
            <TextField variant="date" value={fields.due} disabled={saved === "saving"} ariaLabel={t("items.field.due")} onChange={(due) => set({ due })} />
          </label>
          <div className="it-field">
            <span>{t("items.field.status")}</span>
            <span>{t(STATUS[it.status])}</span>
          </div>
        </>
      )}
      <label className="it-field">
        <span>{t("items.field.linked")}</span>
        <TextField value={fields.linked_issue} disabled={saved === "saving"} ariaLabel={t("items.field.linked")} onChange={(linked_issue) => set({ linked_issue })} />
      </label>
      {fields.linked_issue && <p className="np-dim ii-helper">{t("items.linked_helper")}</p>}
      {action && (
        <div className="it-field">
          <Checkbox label={t("items.field.engineering")} checked={it.is_engineering} onAction={(is_engineering) => void apply(it, { is_engineering })} />
          {it.is_engineering && it.status !== "done" && slots.openHandoff && <PushButton label={t("items.handoff")} size="small" icon="terminal" onAction={() => slots.openHandoff!(bridge, it.id)} />}
        </div>
      )}
      <div className="ii-actions">
        {it.review === "suggested" && (
          <>
            <PushButton label={t("items.accept")} size="small" onAction={() => void review(bridge, it, "accept")} />
            <PushButton label={t("items.reject")} size="small" variant="quiet" onAction={() => void review(bridge, it, "reject")} />
          </>
        )}
        <span className="np-tb__spacer" />
        {saved === "saved" && <span role="status" className="np-dim">{t("items.outcome.saved")}</span>}
        <PushButton label={t("items.save")} size="small" variant="primary" kbd="⌘↩" disabled={!dirty} loading={saved === "saving"} onAction={() => void save()} />
      </div>
      {saved !== "idle" && saved !== "saving" && saved !== "saved" && <span role="alert" className="it-row__error">{saved}</span>}
      <h3 className="t-headline">{t("items.evidence")}</h3>
      {it.closed_by && <p className="it-row__closed">{t("items.closed", { summary: it.closed_by.summary })} · <Link label={t("items.reopen")} onAction={() => void reopen(bridge, it)} /></p>}
      {evidence?.length === 0 && !it.spans.length && <p className="np-dim">{t("items.no_evidence")}</p>}
      <ul className="ii-evidence-list">
        {(evidence ?? []).map((e) => <EvidenceRow key={e.id} bridge={bridge} e={e} />)}
        {(evidence ?? []).every((e) => !e.span) && it.spans.map((s) => <li key={s.t0_ms} className="ii-evidence"><ProvenanceChip bridge={bridge} span={s} variant="chip" /></li>)}
      </ul>
    </div>
  );

  // @cpt-end:cpt-noter-flow-ui-items-evidence:p1:inst-kind
  // @cpt-end:cpt-noter-flow-ui-items-evidence:p1:inst-details

  // @cpt-begin:cpt-noter-flow-ui-items-evidence:p1:inst-history
  const history = <HistoryTimeline bridge={bridge} target={{ type: "item", item_id: itemId }} variant="item" />;
  // @cpt-end:cpt-noter-flow-ui-items-evidence:p1:inst-history

  return (
    <div data-component="cpt-noter-component-ui-item-inspector" data-kind={it.kind} className="ii" onKeyDown={(e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      e.stopPropagation();
      closeInspector();
    }}>
      <div className="ii-head">
        <Badge kind="kind" text={t(KIND[it.kind])} />
        <SegmentedControl items={[{ value: "details", label: t("items.details") }, { value: "history", label: t("items.history") }]} value={tab} label={t("items.inspector")} onAction={(v) => setTab(v as Tab)} />
      </div>
      {tab === "details" ? details : history}
    </div>
  );
}
