import type { Bridge } from "../../app/bridge/bridge";
import type { CallRef } from "../../core/bindings";
import { Link } from "../../ui/primitives/link";

/** The item's call at the end of a compact row (Library search, Person page): the first part to give way when the row runs out of room. */
export function CallLink({ bridge, call }: { bridge: Bridge; call: CallRef }) {
  const open = () => void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "call_page", call_id: call.id, tab: "summary" } }), { screen: "main-window-shell" });
  return (
    <span className="it-row__call">
      <Link label={call.title} onAction={open} />
    </span>
  );
}
