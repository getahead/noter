import type { ItemKind } from "../../core/bindings";
import type { IconName } from "../../ui/icons";

/** The label key of each item kind (Decision, Action item, Open question, Risk). */
export const KIND_KEY: Record<ItemKind, "items.kind.decision" | "items.kind.action_item" | "items.kind.open_question" | "items.kind.risk"> = {
  decision: "items.kind.decision",
  action_item: "items.kind.action_item",
  open_question: "items.kind.open_question",
  risk: "items.kind.risk",
};

/** The glyph a compact row starts with (◇ for a decision), as in the prototype's KIND_ICON. */
export const KIND_ICON: Record<ItemKind, IconName> = { decision: "decision", action_item: "check", open_question: "question", risk: "risk" };
