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
import { TopicChip } from "../../ui/primitives/topic-chip";
import { CallLink } from "../items/CallLink";
import { KIND_ICON, KIND_KEY } from "../items/kind";
import { slots } from "./slots";

// @cpt-component:cpt-noter-component-ui-output-item-row:p1
/** `compact` is the one-line row (Library search, a Today card): kind glyph · text · call (with `showCall`) · time · topic · actions, no owner. */
export function OutputItemRow({ bridge, item: listed, compact = false, showCall = false }: { bridge: Bridge; item: ItemView; compact?: boolean; showCall?: boolean }) {
  // a review or edit since the section was read: the store holds the newer record
  const held = useWindow(bridge, (s) => s.entities.item[listed.id]);
  const item = held && held.rev >= listed.rev ? held : listed;
  useEffect(() => rememberItem(bridge, item), [bridge, item]);
  const Tail = slots.itemTail;
  const span = item.spans[0];
  const lang = typeof item.lang === "string" ? item.lang : item.lang.code;
  const topic = item.topic && <Badge kind="kind" text={item.topic.name} />;
  const suggested = item.review === "suggested" && <Badge kind="status" tone="neutral" text={t("outputs.suggested")} />;
  const evidence = span && <Link label={t("outputs.evidence")} onAction={() => void openSpan(bridge, span, "main-window-shell")} />;
  if (compact)
    return (
      <li className="pc-item pc-item--compact" data-component="cpt-noter-component-ui-output-item-row" data-variant="compact" data-call-id={item.call.id} data-review={item.review} data-item-id={item.id} aria-label={item.text} title={item.text} tabIndex={-1} onKeyDown={(e) => slots.itemKeys?.(bridge, item, e)}>
        <span className="it-row__glyph">
          <Icon name={KIND_ICON[item.kind]} size={13} label={t(KIND_KEY[item.kind])} />
        </span>
        <span className="pc-item__text" lang={lang}>{item.text}</span>
        {showCall && <CallLink bridge={bridge} call={item.call} />}
        {Tail ? <Tail bridge={bridge} item={item} afterTime={<>{topic}{suggested}</>} /> : <>{evidence}{topic}{suggested}</>}
      </li>
    );
  // the prototype's full row (.it-row--full): glyph · text over a wrapping meta line · the controls, which never clip (issue 1271)
  return (
    <li className="it-row it-row--full" data-component="cpt-noter-component-ui-output-item-row" data-call-id={item.call?.id} data-review={item.review} data-item-id={item.id} id={`row-${item.id}`} aria-label={item.text} tabIndex={-1} onKeyDown={(e) => slots.itemKeys?.(bridge, item, e)}>
      <span className="it-row__check it-row__glyph">
        <Icon name={KIND_ICON[item.kind]} size={14} label={t(KIND_KEY[item.kind])} />
      </span>
      <div className="it-row__main">
        <span className="it-row__text" lang={lang}>{item.text}</span>
        <div className="it-row__line2">
          {item.owner && <span className="np-dim">{item.owner.short_name}</span>}
          {/* the evidence opens the transcript at the span (`window_navigate`, as a notification does) */}
          {Tail ? <Tail bridge={bridge} item={item} part="meta" /> : evidence}
          {suggested}
          {item.topic && <TopicChip name={item.topic.name} />}
        </div>
      </div>
      {Tail && (
        <div className="it-row__actions">
          <Tail bridge={bridge} item={item} part="actions" />
        </div>
      )}
    </li>
  );
}
