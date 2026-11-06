// Fills the call page's output-section seam (`call-page/slots.ts`) with the action item row, the Rejected list, the
// tail of the other item rows and Add Action Item, and the row's own seam (`slots.ts`) with the Item inspector.
import { slots } from "../call-page/slots";
import { openInspector } from "../shell/inspector-override";
import { ActionItemRow, rowKey } from "./ActionItemRow";
import { AddItem } from "./AddItem";
import { ItemInspector } from "./ItemInspector";
import { ItemTail } from "./ItemTail";
import { localOf } from "./local";
import { RejectedList } from "./RejectedList";
import { slots as rowSlots } from "./slots";

slots.actionItemRow = ActionItemRow;
slots.rejectedList = RejectedList;
slots.itemTail = ItemTail;
slots.addItem = AddItem;
slots.itemKeys = (bridge, item, e) => rowKey(bridge, item, localOf(item.id), e, "compact");
rowSlots.inspect = (_bridge, itemId) =>
  openInspector({
    width: 320,
    label: "items.inspector",
    render: (b) => <ItemInspector bridge={b} itemId={itemId} />,
    // focus goes back to the row that opened it
    onClose: () => globalThis.document?.getElementById(`row-${itemId}`)?.focus(),
  });
