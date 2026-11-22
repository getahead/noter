import { useEffect } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { CallRef, ItemView, UiPrefs } from "../../core/bindings";
import { t, shortDay } from "../../i18n/format";
import { KIND_KEY } from "../items/kind";
import { Badge } from "../../ui/primitives/badge";
import { Link } from "../../ui/primitives/link";
import { slots } from "../call-page/slots";
import { rememberItem } from "../items/actions";
import { openSpan } from "../items/evidence";


// @cpt-component:cpt-noter-component-ui-output-item-row:p1
/** One entry of a topic thread: its kind, the text, the owner, the call it came from with its date, and the evidence one click away. */
export function ThreadRow({ bridge, item: listed, call, prefs }: { bridge: Bridge; item: ItemView; call: CallRef; prefs?: UiPrefs }) {
  const held = useWindow(bridge, (s) => s.entities.item[listed.id]);
  const item = held && held.rev >= listed.rev ? held : listed;
  useEffect(() => rememberItem(bridge, item), [bridge, item]);
  const Tail = slots.itemTail;
  const span = item.spans[0];
  const open = () => void bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "call_page", call_id: call.id, tab: "summary" } }), { screen: "library-topics" });
  return (
    <li className="pc-item lb-throw" data-component="cpt-noter-component-ui-output-item-row" data-variant="thread" data-call-id={call.id} data-review={item.review} data-item-id={item.id} id={`row-${item.id}`} aria-label={item.text} tabIndex={0} onKeyDown={(e) => slots.itemKeys?.(bridge, item, e)}>
      <Badge kind="kind" text={t(KIND_KEY[item.kind])} />
      <span className="pc-item__text" lang={typeof item.lang === "string" ? item.lang : item.lang.code}>
        {item.text}
      </span>
      {item.owner && <span className="np-dim">{item.owner.short_name}</span>}
      <Link label={t("topics.from_call", { title: call.title, date: shortDay(call.started_at, prefs) })} onAction={open} />
      {Tail ? <Tail bridge={bridge} item={item} /> : span && <Link label={t("outputs.evidence")} onAction={() => void openSpan(bridge, span, "library-topics")} />}
    </li>
  );
}
