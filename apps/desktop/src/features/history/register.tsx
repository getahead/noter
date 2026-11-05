// Registers History as a view of the call page (PC-R8).
import { views } from "../call-page/views";
import { HistoryTimeline } from "./HistoryTimeline";

views.history = ({ bridge, callId, callTitle }) => <HistoryTimeline bridge={bridge} target={{ type: "call", call_id: callId }} variant="call" callId={callId} callTitle={callTitle} />;
