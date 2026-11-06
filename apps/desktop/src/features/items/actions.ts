// The commands behind an item row. Each sends the item's current `rev` and the wanted state, writes what the core
// returns into the window store, and leaves what the row shows (outcome, error, draft) in `local.ts`.
// A failure shows its named error and no success; the draft stays where the user can fix it.
import type { Bridge } from "../../app/bridge/bridge";
import { applyRecord } from "../../app/store/window-store";
import type { ErrorCode, ItemKind, ItemMutation, ItemView, ReviewDecision, UndoTarget } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { holdUndo } from "../history/undo";
import { patchLocal } from "./local";
import { draftPatch, draftValid, type Draft } from "./review";

const ACCEPTED_MS = 4000;
const OUTCOME_MS = 10_000;
const SAVED_MS = 2000;

const ERRORS: Partial<Record<ErrorCode, MsgKey>> = { conflict: "items.err.conflict", invalid_input: "items.err.invalid", not_found: "items.err.gone" };
const errorText = (code: ErrorCode) => t(ERRORS[code] ?? "items.err.other");

/** The item as the store holds it now (an edit or an event may have moved its `rev` since the row last rendered). */
const current = (bridge: Bridge, item: ItemView): ItemView => bridge.store.getState().entities.item[item.id] ?? item;
const changeOf = (m: ItemMutation): UndoTarget => ({ type: "change", change_id: m.change_id });

/** `item_get`: the core's current item into the store, after a conflict or an undo. */
const refresh = (bridge: Bridge, id: string) => bridge.act(`item:get:${id}`, "item_get", () => bridge.core.itemGet({ item_id: id }), { entity: "item" });

// @cpt-begin:cpt-noter-flow-ui-items-review:p1:inst-error
// @cpt-begin:cpt-noter-flow-ui-items-status:p1:inst-failure
/** A refused command: its named error stays on the row, no success status; a conflict reads the item again. */
async function failed(bridge: Bridge, id: string, code: ErrorCode, local: Parameters<typeof patchLocal>[1] = {}) {
  patchLocal(id, { ...local, error: errorText(code) });
  if (code === "conflict") await refresh(bridge, id);
}
// @cpt-end:cpt-noter-flow-ui-items-status:p1:inst-failure
// @cpt-end:cpt-noter-flow-ui-items-review:p1:inst-error

// @cpt-flow:cpt-noter-flow-ui-items-review:p1
/** `items_list` for the call, page by page, every row into the store by identity. */
export async function loadItems(bridge: Bridge, callId: string): Promise<ItemView[]> {
  const all: ItemView[] = [];
  let cursor: string | undefined;
  do {
    // @cpt-begin:cpt-noter-flow-ui-items-review:p1:inst-list
    const res = await bridge.act(`items:list:${callId}`, "items_list", () => bridge.core.itemsList({ filter: { call_id: callId }, page: cursor ? { cursor } : {} }));
    // @cpt-end:cpt-noter-flow-ui-items-review:p1:inst-list
    if (res.status !== "ok") break;
    all.push(...res.data.rows);
    bridge.store.setState((s) => res.data.rows.reduce((acc, r) => applyRecord(acc, "item", r), s));
    cursor = res.data.next_cursor ?? undefined;
  } while (cursor);
  return all;
}

const OUTCOME: Record<ReviewDecision, MsgKey | null> = { accept: "items.outcome.accepted", reject: "items.outcome.rejected", restore: null };

/** Accept, Reject or Restore one item; `text` replaces the outcome's wording (**Saved and accepted**). */
export async function review(bridge: Bridge, item: ItemView, decision: ReviewDecision, text?: MsgKey) {
  const it = current(bridge, item);
  const res = await bridge.act(`item:review:${it.id}`, "item_review", () => bridge.core.itemReview({ item_id: it.id, rev: it.rev, decision }), { entity: "item" });
  if (res.status !== "ok") {
    await failed(bridge, it.id, res.error.code);
    return res;
  }
  const key = text ?? OUTCOME[decision];
  // @cpt-begin:cpt-noter-flow-ui-items-review:p1:inst-accept
  // @cpt-begin:cpt-noter-flow-ui-items-review:p1:inst-reject
  // @cpt-begin:cpt-noter-flow-ui-items-review:p1:inst-restore
  // @cpt-begin:cpt-noter-state-ui-items-review:p1:inst-accept
  // @cpt-begin:cpt-noter-state-ui-items-review:p1:inst-restore
  patchLocal(it.id, { error: undefined, retryAccept: undefined, outcome: key ? { text: t(key), target: changeOf(res.data), ms: decision === "accept" ? ACCEPTED_MS : OUTCOME_MS } : undefined });
  // @cpt-end:cpt-noter-state-ui-items-review:p1:inst-restore
  // @cpt-end:cpt-noter-state-ui-items-review:p1:inst-accept
  // @cpt-end:cpt-noter-flow-ui-items-review:p1:inst-restore
  // @cpt-end:cpt-noter-flow-ui-items-review:p1:inst-reject
  // @cpt-end:cpt-noter-flow-ui-items-review:p1:inst-accept
  return res;
}

/** ⇧A or Accept All: the suggestions of `kinds` (empty = every kind) as one batch, with one Undo for the returned batch. */
export async function reviewAll(bridge: Bridge, callId: string, kinds: ItemKind[]) {
  // @cpt-begin:cpt-noter-flow-ui-items-review:p1:inst-all
  const res = await bridge.act(`items:review_all:${callId}`, "items_review_all", () => bridge.core.itemsReviewAll({ call_id: callId, kinds }));
  // @cpt-end:cpt-noter-flow-ui-items-review:p1:inst-all
  if (res.status !== "ok") return res;
  bridge.store.setState((s) => res.data.items.reduce((acc, r) => applyRecord(acc, "item", r), s));
  // @cpt-begin:cpt-noter-flow-ui-items-review:p1:inst-batch
  // the count is what the core returned; skipped items were not accepted
  if (res.data.batch_id && res.data.items.length)
    holdUndo({ target: { type: "batch", batch_id: res.data.batch_id }, message: t("items.accepted_n", { count: res.data.items.length }), refresh: () => void loadItems(bridge, callId) });
  // @cpt-end:cpt-noter-flow-ui-items-review:p1:inst-batch
  return res;
}

// @cpt-flow:cpt-noter-flow-ui-items-status:p1
/** The checkbox: the wanted state, never a toggle. Ticking a suggestion accepts it too. */
export async function setDone(bridge: Bridge, item: ItemView, done: boolean) {
  const it = current(bridge, item);
  const suggested = it.review === "suggested"; // read before the command: a fake core mutates the very record
  // @cpt-begin:cpt-noter-flow-ui-items-status:p1:inst-done
  const res = await bridge.act(`item:done:${it.id}`, "item_set_done", () => bridge.core.itemSetDone({ item_id: it.id, rev: it.rev, done }), { entity: "item" });
  // @cpt-end:cpt-noter-flow-ui-items-status:p1:inst-done
  if (res.status !== "ok") return void (await failed(bridge, it.id, res.error.code));
  // @cpt-begin:cpt-noter-flow-ui-items-status:p1:inst-result
  const key: MsgKey = suggested ? "items.outcome.accepted_done" : "items.outcome.done";
  patchLocal(it.id, { error: undefined, outcome: done ? { text: t(key), target: changeOf(res.data), ms: OUTCOME_MS } : undefined });
  // @cpt-end:cpt-noter-flow-ui-items-status:p1:inst-result
}

/** **Yes, Landed**, **Done Another Way** or **Keep Open** (also Esc) on a handed-off item. */
export async function answerHandoff(bridge: Bridge, item: ItemView, answer: "landed" | "done_another_way" | "keep_open") {
  const it = current(bridge, item);
  // @cpt-begin:cpt-noter-flow-ui-items-status:p1:inst-answer
  // @cpt-begin:cpt-noter-state-ui-items-completion:p1:inst-landed
  // @cpt-begin:cpt-noter-state-ui-items-completion:p1:inst-keep
  const res = await bridge.act(`item:handoff:${it.id}`, "item_answer_handoff_landed", () => bridge.core.itemAnswerHandoffLanded({ item_id: it.id, rev: it.rev, answer }), { entity: "item" });
  // @cpt-end:cpt-noter-state-ui-items-completion:p1:inst-keep
  // @cpt-end:cpt-noter-state-ui-items-completion:p1:inst-landed
  // @cpt-end:cpt-noter-flow-ui-items-status:p1:inst-answer
  if (res.status !== "ok") return void (await failed(bridge, it.id, res.error.code));
  patchLocal(it.id, { asking: undefined, error: undefined, outcome: answer === "keep_open" ? undefined : { text: t("items.outcome.done"), target: changeOf(res.data), ms: OUTCOME_MS } });
}

/** **Reopen** on an item closed by evidence or answered in a call. */
export async function reopen(bridge: Bridge, item: ItemView) {
  const it = current(bridge, item);
  // @cpt-begin:cpt-noter-flow-ui-items-status:p1:inst-reopen
  // @cpt-begin:cpt-noter-state-ui-items-completion:p1:inst-reopen
  const res = await bridge.act(`item:reopen:${it.id}`, "item_reopen", () => bridge.core.itemReopen({ item_id: it.id, rev: it.rev }), { entity: "item" });
  // @cpt-end:cpt-noter-state-ui-items-completion:p1:inst-reopen
  if (res.status !== "ok") return void (await failed(bridge, it.id, res.error.code));
  patchLocal(it.id, { error: undefined, outcome: { text: t("items.outcome.reopened"), target: changeOf(res.data), ms: OUTCOME_MS } });
  // @cpt-end:cpt-noter-flow-ui-items-status:p1:inst-reopen
}

/** **Add Action Item**: trimmed non-empty text, no owner (the core has none to default to yet; contract gap). Null when nothing was sent. */
export async function create(bridge: Bridge, callId: string, text: string) {
  // @cpt-begin:cpt-noter-flow-ui-items-status:p1:inst-create
  if (!text.trim()) return null;
  return bridge.act(`item:create:${callId}`, "item_create", () => bridge.core.itemCreate({ call_id: callId, kind: "action_item", text: text.trim() }), { entity: "item" });
  // @cpt-end:cpt-noter-flow-ui-items-status:p1:inst-create
}

export type SaveResult = "ok" | "invalid" | "conflict" | "failed" | "partial";

// @cpt-algo:cpt-noter-algo-ui-items-save:p1
/** Save an edit draft: `item_edit` with the changed fields, then (inline review) `item_review accept` with the new rev. */
export async function saveDraft(bridge: Bridge, item: ItemView, draft: Draft, thenAccept: boolean): Promise<SaveResult> {
  const it = current(bridge, item);
  if (!draftValid(draft)) return patchLocal(it.id, { error: errorText("invalid_input") }), "invalid";
  // @cpt-begin:cpt-noter-state-ui-items-review:p1:inst-save
  patchLocal(it.id, { phase: "saving", error: undefined });
  // @cpt-end:cpt-noter-state-ui-items-review:p1:inst-save
  const patch = draftPatch(draft, it);
  if (Object.keys(patch).length) {
    // @cpt-begin:cpt-noter-algo-ui-items-save:p1:inst-edit
    const res = await bridge.act(`item:edit:${it.id}`, "item_edit", () => bridge.core.itemEdit({ item_id: it.id, rev: it.rev, patch }), { entity: "item" });
    // @cpt-end:cpt-noter-algo-ui-items-save:p1:inst-edit
    if (res.status !== "ok") {
      // @cpt-begin:cpt-noter-algo-ui-items-save:p1:inst-conflict
      // @cpt-begin:cpt-noter-algo-ui-items-save:p1:inst-error
      // @cpt-begin:cpt-noter-state-ui-items-review:p1:inst-failed
      await failed(bridge, it.id, res.error.code, { phase: "editing", draft });
      // @cpt-end:cpt-noter-state-ui-items-review:p1:inst-failed
      // @cpt-end:cpt-noter-algo-ui-items-save:p1:inst-error
      return res.error.code === "conflict" ? "conflict" : "failed";
      // @cpt-end:cpt-noter-algo-ui-items-save:p1:inst-conflict
    }
  }
  // @cpt-begin:cpt-noter-algo-ui-items-save:p1:inst-return
  // @cpt-begin:cpt-noter-state-ui-items-review:p1:inst-separate
  if (!thenAccept) return patchLocal(it.id, { phase: undefined, draft: undefined, outcome: { text: t("items.outcome.saved"), target: null, ms: SAVED_MS } }), "ok";
  // @cpt-end:cpt-noter-state-ui-items-review:p1:inst-separate
  // @cpt-end:cpt-noter-algo-ui-items-save:p1:inst-return
  return acceptSaved(bridge, it);
}

/** The second half of an inline save, and the retry after its acceptance failed: `item_review accept` on the saved item. */
export async function acceptSaved(bridge: Bridge, item: ItemView): Promise<SaveResult> {
  const id = item.id;
  // @cpt-begin:cpt-noter-algo-ui-items-save:p1:inst-accept
  // @cpt-begin:cpt-noter-state-ui-items-review:p1:inst-saved
  const res = await review(bridge, item, "accept", "items.outcome.saved_accepted");
  // @cpt-end:cpt-noter-state-ui-items-review:p1:inst-saved
  // @cpt-end:cpt-noter-algo-ui-items-save:p1:inst-accept
  if (res.status === "ok") return patchLocal(id, { phase: undefined, draft: undefined }), "ok";
  // @cpt-begin:cpt-noter-algo-ui-items-save:p1:inst-partial
  patchLocal(id, { phase: undefined, draft: undefined, retryAccept: true, error: t("items.err.partial") });
  // @cpt-end:cpt-noter-algo-ui-items-save:p1:inst-partial
  return "partial";
}

/** **Undo** on a row's outcome: `change_undo` of the change the command returned, then the core's item again; nothing is rebuilt locally. */
export async function undoRow(bridge: Bridge, id: string, target: UndoTarget) {
  const res = await bridge.act(`item:undo:${id}`, "change_undo", () => bridge.core.changeUndo({ target }));
  if (res.status !== "ok") return patchLocal(id, { error: errorText(res.error.code === "conflict" ? "conflict" : "internal") });
  patchLocal(id, { outcome: undefined, error: undefined });
  await refresh(bridge, id);
}
