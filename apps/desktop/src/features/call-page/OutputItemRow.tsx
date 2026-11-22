// One decision, open question, risk or extra of an item section: its text, who owns it, its status and the evidence
// one click away. Action items use the same row until the Items review rows replace it.
import { useEffect } from "react";
import { useWindow } from "../../app/use-window";
import type { Bridge } from "../../app/bridge/bridge";
import type { ItemView } from "../../core/bindings";
import { rememberItem } from "../items/actions";
import { openSpan } from "../items/evidence";
import { t } from "../../i18n/format";
import { Badge } from "../../ui/primitives/badge";
import { Link } from "../../ui/primitives/link";
import { Icon } from "../../ui/icons";
import { CallLink } from "../items/CallLink";
import { KIND_ICON, KIND_KEY } from "../items/kind";
import { slots } from "./slots";

// @cpt-component:cpt-noter-component-ui-output-item-row:p1
/** `compact` is the one-line row of a list across calls (Library search): kind glyph · text · call · time · topic · actions, no owner. */
export function OutputItemRow({ bridge, item: listed, compact = false }: { bridge: Bridge; item: ItemView; compact?: boolean }) {
  // a review or edit since the section was read: the store holds the newer record
  const held = useWindow(bridge, (s) => s.entities.item[listed.id]);
  const item = held && held.rev >= listed.rev ? held : listed;
  useEffect(() => rememberItem(bridge, item), [bridge, item]);
  const Tail = slots.itemTail;
  const span = item.spans[0];
  const lang = typeof item.lang === "string" ? item.lang : item.lang.code;
  const topic = item.topic && <Badge kind="kind" text={item.topic.name} />;
  const suggested = item.review === "suggested" && <Badge kind="status" tone="accent" text={t("outputs.suggested")} />;
  const evidence = span && <Link label={t("outputs.evidence")} onAction={() => void openSpan(bridge, span, "main-window-shell")} />;
  if (compact)
    return (
      <li className="pc-item pc-item--compact" data-component="cpt-noter-component-ui-output-item-row" data-variant="compact" data-call-id={item.call.id} data-review={item.review} data-item-id={item.id} aria-label={item.text} title={item.text} tabIndex={-1} onKeyDown={(e) => slots.itemKeys?.(bridge, item, e)}>
        <span className="it-row__glyph">
          <Icon name={KIND_ICON[item.kind]} size={13} label={t(KIND_KEY[item.kind])} />
        </span>
        <span className="pc-item__text" lang={lang}>{item.text}</span>
        <CallLink bridge={bridge} call={item.call} />
        {Tail ? <Tail bridge={bridge} item={item} afterTime={<>{topic}{suggested}</>} /> : <>{evidence}{topic}{suggested}</>}
      </li>
    );
  return (
    <li className="pc-item" data-component="cpt-noter-component-ui-output-item-row" data-call-id={item.call?.id} data-review={item.review} data-item-id={item.id} id={`row-${item.id}`} aria-label={item.text} tabIndex={-1} onKeyDown={(e) => slots.itemKeys?.(bridge, item, e)}>
      <span className="pc-item__text" title={item.text} lang={typeof item.lang === "string" ? item.lang : item.lang.code}>{item.text}</span>
      {item.owner && <span className="np-dim">{item.owner.short_name}</span>}
      {item.topic && <Badge kind="kind" text={item.topic.name} />}
      {item.review === "suggested" && <Badge kind="status" tone="accent" text={t("outputs.suggested")} />}
      {/* the evidence opens the transcript at the span (`window_navigate`, as a notification does) */}
      {Tail ? <Tail bridge={bridge} item={item} /> : span && <Link label={t("outputs.evidence")} onAction={() => void openSpan(bridge, span, "main-window-shell")} />}
    </li>
  );
}
