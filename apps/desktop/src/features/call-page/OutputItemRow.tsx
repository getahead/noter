// One decision, open question, risk or extra of an item section: its text, who owns it, its status and the evidence
// one click away. Action items use the same row until the Items review rows replace it.
import { useWindow } from "../../app/use-window";
import type { Bridge } from "../../app/bridge/bridge";
import type { ItemView } from "../../core/bindings";
import { openSpan } from "../items/evidence";
import { t } from "../../i18n/format";
import { Badge } from "../../ui/primitives/badge";
import { Link } from "../../ui/primitives/link";
import { slots } from "./slots";

// @cpt-component:cpt-noter-component-ui-output-item-row:p1
export function OutputItemRow({ bridge, item: listed }: { bridge: Bridge; item: ItemView }) {
  // a review or edit since the section was read: the store holds the newer record
  const held = useWindow(bridge, (s) => s.entities.item[listed.id]);
  const item = held && held.rev > listed.rev ? held : listed;
  const Tail = slots.itemTail;
  const span = item.spans[0];
  return (
    <li className="pc-item" data-component="cpt-noter-component-ui-output-item-row" data-review={item.review} data-item-id={item.id} id={`row-${item.id}`} tabIndex={-1} onKeyDown={(e) => slots.itemKeys?.(bridge, item, e)}>
      <span className="pc-item__text" lang={typeof item.lang === "string" ? item.lang : item.lang.code}>{item.text}</span>
      {item.owner && <span className="np-dim">{item.owner.short_name}</span>}
      {item.topic && <Badge kind="kind" text={item.topic.name} />}
      {item.review === "suggested" && <Badge kind="status" tone="accent" text={t("outputs.suggested")} />}
      {/* the evidence opens the transcript at the span (`window_navigate`, as a notification does) */}
      {Tail ? <Tail bridge={bridge} item={item} /> : span && <Link label={t("outputs.evidence")} onAction={() => void openSpan(bridge, span, "main-window-shell")} />}
    </li>
  );
}
