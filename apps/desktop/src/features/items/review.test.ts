import { describe, expect, it } from "vitest";

import type { ItemView } from "../../core/bindings";
import { completion, draftOf, draftPatch, draftValid, isDone, isOverdue, keyOf, langOf, nextSuggested, rowState } from "./review";

const item = (o: Partial<ItemView> = {}) =>
  ({ id: "i1", rev: 3, kind: "action_item", text: "Send the spec", lang: "en", owner: { id: "per_anna", display_name: "Anna K", short_name: "Anna K.", initials: "AK", is_you: false }, due: "2026-10-17", status: "open", review: "suggested", is_engineering: false, linked_issue: null, handoff: null, ...o }) as ItemView;
const key = (code: string, o: Record<string, unknown> = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, target: null, preventDefault() {}, stopPropagation() {}, ...o });

describe("keyOf (A, E, R, ⇧A on the physical key)", () => {
  it("maps the four review keys", () => {
    expect(keyOf(key("KeyA"))).toBe("accept");
    expect(keyOf(key("KeyE"))).toBe("edit");
    expect(keyOf(key("KeyR"))).toBe("reject");
    expect(keyOf(key("KeyA", { shiftKey: true }))).toBe("accept_all");
  });
  it("ignores other keys, other modifiers, text inputs and composition", () => {
    expect(keyOf(key("KeyB"))).toBeNull();
    expect(keyOf(key("KeyA", { metaKey: true }))).toBeNull();
    expect(keyOf(key("KeyA", { target: { tagName: "TEXTAREA" } }))).toBeNull();
    expect(keyOf(key("KeyA", { target: { tagName: "INPUT", type: "text" } }))).toBeNull();
    expect(keyOf(key("KeyA", { isComposing: true }))).toBeNull();
  });
});

describe("nextSuggested", () => {
  const rows = [
    { id: "a", review: "accepted" },
    { id: "b", review: "suggested" },
    { id: "c", review: "suggested" },
    { id: "d", review: "suggested" },
  ];
  it("is the next suggested row after the current one, in order", () => {
    expect(nextSuggested(rows, "b")).toBe("c");
    expect(nextSuggested(rows, "a")).toBe("b");
  });
  it("wraps to an earlier suggestion and is null when none remain", () => {
    expect(nextSuggested(rows, "d")).toBe("b");
    expect(nextSuggested([{ id: "a", review: "accepted" }, { id: "b", review: "suggested" }], "b")).toBeNull();
    expect(nextSuggested([], "x")).toBeNull();
    expect(nextSuggested(rows, null)).toBe("b");
  });
});

describe("rowState (review) and completion", () => {
  it("follows the core's review state and the local phase", () => {
    expect(rowState(item(), {})).toBe("SUGGESTED");
    expect(rowState(item(), { phase: "editing" })).toBe("EDITING");
    expect(rowState(item(), { phase: "saving" })).toBe("SAVING");
    expect(rowState(item({ review: "accepted" }), {})).toBe("ACCEPTED");
    expect(rowState(item({ review: "rejected" }), { outcome: true })).toBe("REJECTED_OUTCOME");
    expect(rowState(item({ review: "rejected" }), {})).toBe("REJECTED");
  });
  it("completion is the core's status, with the handoff question on a handed-off item", () => {
    expect(completion(item(), false)).toBe("OPEN");
    expect(completion(item({ status: "carried" }), false)).toBe("CARRIED");
    expect(completion(item({ status: "done" }), false)).toBe("DONE");
    expect(completion(item({ status: "handed_off" }), false)).toBe("HANDED_OFF");
    expect(completion(item({ status: "handed_off" }), true)).toBe("HANDOFF_QUESTION");
    expect(completion(item({ status: "closed_by_evidence" }), false)).toBe("CLOSED_BY_EVIDENCE");
    expect(completion(item({ status: "answered_in_call" }), false)).toBe("ANSWERED_IN_CALL");
  });
});

describe("draftPatch (algo save: only changed fields, typed clears)", () => {
  it("is empty for an untouched draft", () => {
    expect(draftPatch(draftOf(item()), item())).toEqual({});
  });
  it("sends the trimmed text, the new owner and due, and the Engineering flag", () => {
    const d = { ...draftOf(item()), text: "  New text ", owner: "per_you", due: "2026-10-20", engineering: true };
    expect(draftPatch(d, item())).toEqual({ text: "New text", owner: { type: "set", person: { type: "existing", person_id: "per_you" } }, due: { type: "set", date: "2026-10-20" }, is_engineering: true });
  });
  it("maps cleared Owner, Due and Linked issue to the clear variants, never null", () => {
    const d = { ...draftOf(item({ linked_issue: "VSTOR-1" })), owner: "", due: "", linked_issue: "" };
    expect(draftPatch(d, item({ linked_issue: "VSTOR-1" }))).toEqual({ owner: { type: "clear" }, due: { type: "clear" }, linked_issue: { type: "clear" } });
  });
  it("sets a changed linked issue", () => {
    expect(draftPatch({ ...draftOf(item()), linked_issue: "VSTOR-2" }, item())).toEqual({ linked_issue: { type: "set", text: "VSTOR-2" } });
  });
  it("draftValid needs non-empty trimmed text", () => {
    expect(draftValid(draftOf(item()))).toBe(true);
    expect(draftValid({ ...draftOf(item()), text: "  " })).toBe(false);
  });
});

describe("langOf", () => {
  it("is the code of a language set by hand", () => {
    expect(langOf("ru")).toBe("ru");
    expect(langOf({ code: "fr" } as never)).toBe("fr");
  });
});

describe("isOverdue and isDone", () => {
  it("a due date before today on an open item is overdue; done items never are", () => {
    expect(isOverdue("2026-10-14", false, "2026-10-15")).toBe(true);
    expect(isOverdue("2026-10-15", false, "2026-10-15")).toBe(false);
    expect(isOverdue("2026-10-14", true, "2026-10-15")).toBe(false);
    expect(isOverdue(null, false, "2026-10-15")).toBe(false);
  });
  it("done, closed by evidence and answered in a call show ticked", () => {
    expect(["open", "carried", "handed_off"].some((s) => isDone(s as never))).toBe(false);
    expect(["done", "closed_by_evidence", "answered_in_call"].every((s) => isDone(s as never))).toBe(true);
  });
});
