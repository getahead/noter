import type { ItemKind } from "../../core/bindings";

/** The label key of each item kind (Decision, Action item, Open question, Risk). */
export const KIND_KEY: Record<ItemKind, "items.kind.decision" | "items.kind.action_item" | "items.kind.open_question" | "items.kind.risk"> = {
  decision: "items.kind.decision",
  action_item: "items.kind.action_item",
  open_question: "items.kind.open_question",
  risk: "items.kind.risk",
};
