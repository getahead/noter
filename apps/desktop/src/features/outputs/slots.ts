// Seam between an output section and the rows that fill it: Items registers its `ActionItemRow` here when it loads
// (`features/items/register.tsx`); until then the section draws its plain row. The section passes every item of the
// kind, rejected ones too: a row folds itself away after its **Rejected · Undo** outcome (`RejectedList` lists them).
import type { ComponentType } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { ItemView } from "../../core/bindings";

export interface ActionItemRowProps {
  bridge: Bridge;
  item: ItemView;
  variant?: "full" | "compact" | "done" | "read-only";
}

export const slots: { actionItemRow: ComponentType<ActionItemRowProps> | null } = { actionItemRow: null };
