// One action item, wherever it is listed: the Call page's output section (full), compact lists, Today's Done list
// and read-only views. Review, tick, edit and handoff answer all go through `actions.ts`; the row only draws what the
// core and `local.ts` say. Registers itself in the outputs section's seam (`register.tsx`).
import { useState, type KeyboardEvent } from "react";

import { useWindow } from "../../app/use-window";
import type { Bridge } from "../../app/bridge/bridge";
import type { ItemView, PersonChip } from "../../core/bindings";
import { quote, t } from "../../i18n/format";
import { Icon } from "../../ui/icons";
import { InlineStatus } from "../../ui/feedback/inline-status";
import { Badge } from "../../ui/primitives/badge";
import { Checkbox } from "../../ui/primitives/checkbox";
import { IconButton } from "../../ui/primitives/icon-button";
import { Link } from "../../ui/primitives/link";
import { Menu, type MenuItem } from "../../ui/primitives/menu";
import { Popover } from "../../ui/primitives/popover";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PullDownButton } from "../../ui/primitives/pull-down-button";
import { PushButton } from "../../ui/primitives/push-button";
import { TextField } from "../../ui/primitives/text-field";
import type { ActionItemRowProps } from "../call-page/slots";
import { acceptSaved, answerHandoff, review, reopen, saveDraft, setDone, undoRow } from "./actions";
import { patchLocal, useLocal, type Local } from "./local";
import { completion, draftOf, isDone, isOverdue, keyOf, langOf, nextSuggested, rowState, type Draft } from "./review";
import { slots } from "./slots";
import "./items.css";

const elementId = (kind: string, id: string) => [kind, id].join("-");
const today = () => new Date().toLocaleDateString("sv"); // YYYY-MM-DD in the local zone
const dueText = (due: string) => new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${due}T00:00`));

/** The live item: the store's record unless the section handed over a newer one. */
function useItem(bridge: Bridge, item: ItemView): ItemView {
  const held = useWindow(bridge, (s) => s.entities.item[item.id]);
  return held && held.rev >= item.rev ? held : item;
}

/** Focus the next suggested row after `id`, in the order the rows are on the page; false when none remain. */
export function focusNext(id: string): boolean {
  const rows = Array.from(globalThis.document?.querySelectorAll<HTMLElement>("[data-item-id]") ?? []);
  const next = nextSuggested(rows.map((r) => ({ id: r.dataset.itemId!, review: r.dataset.review! })), id);
  rows.find((r) => r.dataset.itemId === next)?.focus();
  return next !== null;
}

function Owner({ person }: { person: PersonChip }) {
  const variant = person.is_you ? "you" : "link";
  return (
    <span data-component="cpt-noter-component-ui-person-chip" data-variant={variant} className="np-person" title={person.display_name}>
      <span className="np-person__ini" aria-hidden="true">{person.initials}</span> <span className="np-person__name">{person.is_you ? t("cw.speaker.you") : person.short_name}</span>
    </span>
  );
}

/** The Review menu of a compact row: Accept, Edit… (the inspector, once it exists) and Reject. */
export function reviewMenu(act: { accept: () => void; edit: (() => void) | null; reject: () => void }): MenuItem[] {
  return [{ label: t("items.accept"), onSelect: act.accept }, ...(act.edit ? [{ label: t("items.edit_menu"), onSelect: act.edit }] : []), { label: t("items.reject"), onSelect: act.reject }];
}

export function ReviewButtons({ it, bridge, retryOnly, edit }: { it: ItemView; bridge: Bridge; retryOnly: boolean; edit: (() => void) | null }) {
  const accept = async () => {
    const ok = retryOnly ? (await acceptSaved(bridge, it)) === "ok" : (await review(bridge, it, "accept")).status === "ok";
    if (ok) focusNext(it.id);
  };
  return (
    <div className="it-row__review">
      <PushButton label={t("items.accept")} size="small" kbd="A" onAction={() => void accept()} />
      {!retryOnly && edit && <PushButton label={t("items.edit")} size="small" variant="quiet" kbd="E" onAction={edit} />}
      {!retryOnly && <PushButton label={t("items.reject")} size="small" variant="quiet" kbd="R" onAction={() => void review(bridge, it, "reject").then((r) => r.status === "ok" && focusNext(it.id))} />}
    </div>
  );
}

function CompactReview({ it, bridge }: { it: ItemView; bridge: Bridge }) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const id = elementId("rv", it.id);
  const close = () => setMenu(null);
  const edit = slots.inspect ? () => slots.inspect!(bridge, it.id) : null;
  return (
    <>
      <PullDownButton id={id} iconOnly icon="ellipsis" label={t("items.review_menu")} ariaLabel={t("items.review_menu")} variant="context-menu" open={menu !== null} onAction={() => setMenu(menu ? null : (globalThis.document?.getElementById(id) ?? null))} />
      {menu && (
        <Popover variant="context-menu" anchor={menu} align="end" label={t("items.review_menu")} onClose={close}>
          <Menu variant="context-menu" items={reviewMenu({ accept: () => void review(bridge, it, "accept"), edit, reject: () => void review(bridge, it, "reject") })} onClose={close} />
        </Popover>
      )}
    </>
  );
}

/** Edit fields of a full row: text, Owner, Due, Engineering; Cancel or Esc discards, Save or ⌘Return saves. */
export function EditFields({ it, bridge, draft, saving, error }: { it: ItemView; bridge: Bridge; draft: Draft; saving: boolean; error?: string }) {
  const people = useWindow(bridge, (s) => s.entities.call[it.call.id]?.participants) ?? [];
  const owners = [...(it.owner && !people.some((p) => p.id === it.owner!.id) ? [it.owner] : []), ...people];
  const set = (patch: Partial<Draft>) => patchLocal(it.id, { draft: { ...draft, ...patch } });
  return (
    <div className="it-row__edit">
      <TextField id={`edit-text-${it.id}`} value={draft.text} ariaLabel={t("items.field.text")} cls="it-row__edit-text" lang={langOf(it.lang)} invalid={!!error} message={error} disabled={saving} onChange={(text) => set({ text })} />
      <div className="it-row__edit-fields">
        <label className="it-field">
          <span>{t("items.field.owner")}</span>
          <PopupButton options={[{ value: "", label: "—" }, ...owners.map((p) => ({ value: p.id, label: p.is_you ? t("cw.speaker.you") : p.short_name }))]} value={draft.owner} label={t("items.field.owner")} disabled={saving} onAction={(owner) => set({ owner })} />
        </label>
        <label className="it-field">
          <span>{t("items.field.due")}</span>
          <TextField variant="date" value={draft.due} ariaLabel={t("items.field.due")} cls="it-field__due" disabled={saving} onChange={(due) => set({ due })} />
        </label>
        <Checkbox label={t("items.field.engineering")} checked={draft.engineering} disabled={saving} onAction={(engineering) => set({ engineering })} />
        <span className="np-tb__spacer" />
        <PushButton label={t("items.cancel")} size="small" variant="quiet" disabled={saving} onAction={() => cancelEdit(it.id)} />
        <PushButton label={t("items.save")} size="small" variant="primary" kbd="⌘↩" loading={saving} onAction={() => void saveDraft(bridge, it, draft, true)} />
      </div>
    </div>
  );
}
const cancelEdit = (id: string) => patchLocal(id, { phase: undefined, draft: undefined, draftBase: undefined, error: undefined });

/** What a key does on a row: the review keys on a suggested row, Esc and ⌘Return while editing, Esc on the handoff question. */
export function rowKey(bridge: Bridge, it: ItemView, local: Local, e: KeyboardEvent, variant: ActionItemRowProps["variant"] = "full"): void {
  if (variant === "read-only" || e.nativeEvent?.isComposing || (e as KeyboardEvent & { isComposing?: boolean }).isComposing || local.phase === "saving") return;
  const stop = () => (e.preventDefault(), e.stopPropagation());
  if (local.phase) {
    if (e.key === "Escape") (stop(), cancelEdit(it.id));
    else if (e.key === "Enter" && e.metaKey && local.draft && local.phase === "editing") (stop(), void saveDraft(bridge, it, local.draft, true));
    return;
  }
  if (local.asking && e.key === "Escape") return stop(), void answerHandoff(bridge, it, "keep_open");
  if (e.metaKey && e.code === "KeyI" && slots.inspect) return stop(), slots.inspect(bridge, it.id);
  const key = keyOf(e);
  if (it.review !== "suggested" || !key || key === "accept_all") return;
  stop();
  if (key === "edit") {
    if (variant === "full") startEdit(it);
    else slots.inspect?.(bridge, it.id);
  }
  else void review(bridge, it, key === "accept" ? "accept" : "reject").then((r) => r.status === "ok" && focusNext(it.id));
}
const startEdit = (it: ItemView) => patchLocal(it.id, { phase: "editing", draft: draftOf(it), draftBase: { ...it }, error: undefined });

// @cpt-component:cpt-noter-component-ui-action-item-row:p1
// @cpt-dod:cpt-noter-dod-ui-items-actions:p1
export function ActionItemRow({ bridge, item, variant = "full" }: ActionItemRowProps) {
  const it = useItem(bridge, item);
  const heldLocal = useLocal(it.id);
  const local: Local = variant === "read-only" ? {} : heldLocal;
  const state = rowState(it, { phase: local.phase, outcome: !!local.outcome });
  const full = variant === "full";
  const done = isDone(it.status);
  const asking = completion(it, !!local.asking) === "HANDOFF_QUESTION";

  const outcome = local.outcome && (
    <InlineStatus variant="row-outcome" text={local.outcome.text} ms={local.outcome.ms} actionLabel={local.outcome.target ? t("items.undo") : undefined} onAction={() => void undoRow(bridge, it.id, local.outcome!.target!)} onExpire={() => patchLocal(it.id, { outcome: undefined })} />
  );
  // a rejected row shows its outcome as a ghost line, then folds into the section's **Rejected (n)** list
  if (state === "REJECTED") return null;
  if (local.outcome && (state === "REJECTED_OUTCOME" || !full))
    return (
      <div data-component="cpt-noter-component-ui-action-item-row" data-variant={variant} data-state="outcome" data-item-id={it.id} data-review={it.review} className={`it-row it-row--${variant} is-outcome`} lang={langOf(it.lang)} id={elementId("row", it.id)}>
        {outcome}
        <span className={`it-row__ghost${it.review === "rejected" ? " is-rej" : ""}`}>{it.text}</span>
        {local.error && <span className="it-row__error" role="alert">{local.error}</span>}
      </div>
    );

  const edit = it.review === "suggested" && full ? () => startEdit(it) : slots.inspect ? () => slots.inspect!(bridge, it.id) : null;
  const overdue = isOverdue(it.due, done, today());
  const tick1 = (checked: boolean) => (it.status === "handed_off" ? patchLocal(it.id, { asking: true }) : void setDone(bridge, it, checked));
  const attrs = {
    "data-component": "cpt-noter-component-ui-action-item-row",
    "data-variant": variant,
    "data-state": state === "SUGGESTED" ? "suggested" : (local.outcome ? "outcome" : state.toLowerCase()),
    "data-item-id": it.id,
    "data-review": it.review,
    lang: langOf(it.lang),
    id: elementId("row", it.id),
    onKeyDown: (e: KeyboardEvent) => rowKey(bridge, it, local, e, variant),
  };
  if (state === "EDITING" || state === "SAVING")
    return (
      <div {...attrs} data-state={state.toLowerCase()} className="it-row it-row--full it-row--editing" tabIndex={-1}>
        <EditFields it={it} bridge={bridge} draft={local.draft ?? draftOf(it)} saving={state === "SAVING"} error={local.error} />
      </div>
    );

  const tags = (
    <>
      {it.linked_issue && <Badge kind="kind" icon="ticket" text={it.linked_issue} />}
      {it.is_engineering && full && <Badge kind="kind" text={t("items.engineering")} />}
      {it.status === "handed_off" && <Badge kind="status" tone="info" text={t("items.handed_off")} />}
      {(it.status === "closed_by_evidence" || it.status === "answered_in_call") && (
        <span className="it-row__closed">{t("items.closed", { summary: it.closed_by?.summary ?? it.status.replace(/_/g, " ") })}{variant !== "read-only" && <> · <Link label={t("items.reopen")} onAction={() => void reopen(bridge, it)} /></>}</span>
      )}
      {it.carried_from && <Badge kind="status" text={t("items.carried", { call: it.carried_from.title })} />}
      {it.review === "suggested" && <Badge kind="status" text={t("items.suggested")} />}
    </>
  );
  const due = it.due && (
    <span className={`it-row__due${overdue ? " is-overdue" : ""}`}>
      {overdue && <Icon name="warning" size={11} />}
      {dueText(it.due)}
    </span>
  );
  const check =
    variant === "read-only" ? <Icon name="check" size={12} /> : <Checkbox ariaLabel={t("items.done_aria", { text: quote(it.text, langOf(it.lang)) })} checked={done} onAction={tick1} />;
  const question = asking && (
    <div className="it-row__landed" role="group" aria-label={t("items.landed.ask")}>
      <span className="t-headline">{t("items.landed.ask")}</span>
      <PushButton label={t("items.landed.yes")} size="small" variant="primary" onAction={() => void answerHandoff(bridge, it, "landed")} />
      <PushButton label={t("items.landed.other")} size="small" onAction={() => void answerHandoff(bridge, it, "done_another_way")} />
      <PushButton label={t("items.landed.keep")} size="small" variant="quiet" onAction={() => void answerHandoff(bridge, it, "keep_open")} />
    </div>
  );
  const error = local.error && <span className="it-row__error" role="alert">{local.error}</span>;
  const handoff = it.is_engineering && !done && variant !== "read-only" && slots.openHandoff && <PushButton label={t("items.handoff")} size="small" icon="terminal" onAction={() => slots.openHandoff!(bridge, it.id)} />;
  const info = variant !== "read-only" && slots.inspect && <IconButton icon="info" label={t("items.inspect")} size="inline" onAction={() => slots.inspect!(bridge, it.id)} />;
  const suggested = it.review === "suggested" && !local.outcome;
  const owner = it.owner && <Owner person={it.owner} />;
  const text = <span className="it-row__text">{it.text}</span>;

  if (!full)
    return (
      <div {...attrs} data-state={variant === "done" ? "done" : attrs["data-state"]} className={`it-row it-row--compact${done ? " is-done" : ""}`} title={it.text}>
        <div className="it-row__line">
          {check}
          {owner}
          {text}
          {due}
          {tags}
          <span className="np-tb__spacer" />
          {variant === "done" && <PushButton label={t("items.undo")} size="small" variant="quiet" onAction={() => void setDone(bridge, it, false)} />}
          {handoff}
          {suggested && variant === "compact" && <CompactReview it={it} bridge={bridge} />}
          {info}
        </div>
        {question}
        {error}
      </div>
    );
  return (
    <div {...attrs} className={`it-row it-row--full${done ? " is-done" : ""}`} tabIndex={-1}>
      <div className="it-row__check">{check}</div>
      <div className="it-row__main">
        <div className="it-row__line1">
          {owner}
          {text}
        </div>
        <div className="it-row__line2">
          {due}
          {tags}
        </div>
        {question}
        {error}
      </div>
      <div className="it-row__actions">
        {outcome || (suggested && <ReviewButtons it={it} bridge={bridge} retryOnly={!!local.retryAccept} edit={edit} />)}
        {handoff}
        {info}
      </div>
    </div>
  );
}
