// Fills the Handoff seam of the action item row (`items/slots.ts`): the drawer opens in the inspector slot (400) and
// focus returns to the row's **Handoff** button when it closes.
import { handoffButtonId, slots } from "../items/slots";
import { openInspector } from "../shell/inspector-override";
import { HandoffDrawer } from "./HandoffDrawer";

slots.openHandoff = (bridge, itemId) =>
  openInspector({
    width: 400,
    label: "handoff.title",
    render: (b) => <HandoffDrawer key={itemId} bridge={b} itemId={itemId} />,
    onClose: () => document.getElementById(handoffButtonId(itemId))?.focus(),
  });
