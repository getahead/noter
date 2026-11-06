// The pure part of reviewing items: which key means what, which row comes next, what state a row is in and
// what an edit draft sends. The core owns review and status; nothing here is written back without a command.
import { chord, isTyping, type ShortcutEvent } from "../../app/a11y/keys";
import type { ItemPatch, ItemView, Lang } from "../../core/bindings";

export type ReviewKey = "accept" | "edit" | "reject" | "accept_all";
export type ReviewState = "SUGGESTED" | "EDITING" | "SAVING" | "ACCEPTED" | "REJECTED_OUTCOME" | "REJECTED";
export type Completion = "OPEN" | "CARRIED" | "HANDOFF_QUESTION" | "HANDED_OFF" | "DONE" | "CLOSED_BY_EVIDENCE" | "ANSWERED_IN_CALL";

const KEYS: Record<string, ReviewKey> = { KeyA: "accept", KeyE: "edit", KeyR: "reject", "Shift+KeyA": "accept_all" };

// @cpt-flow:cpt-noter-flow-ui-items-review:p1
/** A, E, R and ⇧A on the physical key, only outside text inputs and input-method composition. */
export function keyOf(e: ShortcutEvent): ReviewKey | null {
  // @cpt-begin:cpt-noter-flow-ui-items-review:p1:inst-action
  return e.isComposing || isTyping(e.target) ? null : (KEYS[chord(e)] ?? null);
  // @cpt-end:cpt-noter-flow-ui-items-review:p1:inst-action
}

/** The id of the next suggested row after `from` in section order, wrapping to an earlier one; null when none remain. */
export function nextSuggested(rows: Array<{ id: string; review: string }>, from: string | null): string | null {
  const at = rows.findIndex((r) => r.id === from);
  const order = [...rows.slice(at + 1), ...rows.slice(0, Math.max(at, 0))];
  return order.find((r) => r.id !== from && r.review === "suggested")?.id ?? null;
}

export interface RowLocal {
  phase?: "editing" | "saving";
  /** A **Rejected · Undo** outcome is showing. */
  outcome?: boolean;
}

// @cpt-state:cpt-noter-state-ui-items-review:p1
/** The review state of a row: the core's review state, the local edit phase and the rejection outcome. */
export function rowState(item: Pick<ItemView, "review">, local: RowLocal): ReviewState {
  // @cpt-begin:cpt-noter-state-ui-items-review:p1:inst-edit
  // @cpt-begin:cpt-noter-state-ui-items-review:p1:inst-save
  if (local.phase) return local.phase === "editing" ? "EDITING" : "SAVING";
  // @cpt-end:cpt-noter-state-ui-items-review:p1:inst-save
  // @cpt-end:cpt-noter-state-ui-items-review:p1:inst-edit
  // @cpt-begin:cpt-noter-state-ui-items-review:p1:inst-reject
  // @cpt-begin:cpt-noter-state-ui-items-review:p1:inst-fold
  if (item.review === "rejected") return local.outcome ? "REJECTED_OUTCOME" : "REJECTED";
  // @cpt-end:cpt-noter-state-ui-items-review:p1:inst-fold
  // @cpt-end:cpt-noter-state-ui-items-review:p1:inst-reject
  return item.review === "suggested" ? "SUGGESTED" : "ACCEPTED";
}

// @cpt-state:cpt-noter-state-ui-items-completion:p1
/** The completion state: the core's `status`; a handed-off item whose checkbox was invoked asks first. */
export function completion(item: Pick<ItemView, "status">, asking: boolean): Completion {
  // @cpt-begin:cpt-noter-state-ui-items-completion:p1:inst-ask
  if (item.status === "handed_off" && asking) return "HANDOFF_QUESTION";
  // @cpt-end:cpt-noter-state-ui-items-completion:p1:inst-ask
  // @cpt-begin:cpt-noter-state-ui-items-completion:p1:inst-done
  // @cpt-begin:cpt-noter-state-ui-items-completion:p1:inst-handoff
  // @cpt-begin:cpt-noter-state-ui-items-completion:p1:inst-evidence
  // @cpt-begin:cpt-noter-state-ui-items-completion:p1:inst-answered
  // @cpt-begin:cpt-noter-state-ui-items-completion:p1:inst-returned
  return item.status.toUpperCase() as Completion; // the core reports each of these statuses; the UI never infers them
  // @cpt-end:cpt-noter-state-ui-items-completion:p1:inst-returned
  // @cpt-end:cpt-noter-state-ui-items-completion:p1:inst-answered
  // @cpt-end:cpt-noter-state-ui-items-completion:p1:inst-evidence
  // @cpt-end:cpt-noter-state-ui-items-completion:p1:inst-handoff
  // @cpt-end:cpt-noter-state-ui-items-completion:p1:inst-done
}

/** The field values of an inline edit (`owner` is a person id, `""` for none). */
export interface Draft {
  text: string;
  owner: string;
  due: string;
  engineering: boolean;
  linked_issue: string;
}

export const draftOf = (i: ItemView): Draft => ({ text: i.text, owner: i.owner?.id ?? "", due: i.due ?? "", engineering: i.is_engineering, linked_issue: i.linked_issue ?? "" });
export const draftValid = (d: Draft) => d.text.trim().length > 0;

// @cpt-algo:cpt-noter-algo-ui-items-save:p1
/** Only the changed fields; a cleared Owner, Due or Linked issue is the typed clear, because null leaves a field unchanged. */
export function draftPatch(d: Draft, item: ItemView): ItemPatch {
  const was = draftOf(item);
  const patch: ItemPatch = {};
  // @cpt-begin:cpt-noter-algo-ui-items-save:p1:inst-normalize
  if (d.text.trim() !== was.text) patch.text = d.text.trim();
  if (d.owner !== was.owner) patch.owner = d.owner ? { type: "set", person: { type: "existing", person_id: d.owner } } : { type: "clear" };
  if (d.due !== was.due) patch.due = d.due ? { type: "set", date: d.due } : { type: "clear" };
  if (d.linked_issue !== was.linked_issue) patch.linked_issue = d.linked_issue.trim() ? { type: "set", text: d.linked_issue.trim() } : { type: "clear" };
  if (d.engineering !== was.engineering) patch.is_engineering = d.engineering;
  // @cpt-end:cpt-noter-algo-ui-items-save:p1:inst-normalize
  return patch;
}

/** The `lang` attribute of an item's text. */
export const langOf = (l: Lang): string => (typeof l === "string" ? l : l.code);

/** A due date before today on an item that is not done (`today` is a local `YYYY-MM-DD`). */
export const isOverdue = (due: string | null, done: boolean, today: string): boolean => !!due && !done && due < today;

/** Items the checkbox shows as ticked: done, or closed by the core's evidence or an answer in a call. */
export const isDone = (status: ItemView["status"]): boolean => status === "done" || status === "closed_by_evidence" || status === "answered_in_call";
