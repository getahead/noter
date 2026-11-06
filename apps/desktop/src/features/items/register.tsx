// Fills the call page's output-section seam (`call-page/slots.ts`) with the action item row and the Rejected list.
import { slots } from "../call-page/slots";
import { ActionItemRow } from "./ActionItemRow";
import { RejectedList } from "./RejectedList";

slots.actionItemRow = ActionItemRow;
slots.rejectedList = RejectedList;
