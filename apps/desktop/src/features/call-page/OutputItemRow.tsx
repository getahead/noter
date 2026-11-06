// One decision, open question, risk or extra of an item section: its text, who owns it, its status and the evidence
// one click away. Action items use the same row until the Items review rows replace it.
import type { Bridge } from "../../app/bridge/bridge";
import type { ItemView } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Badge } from "../../ui/primitives/badge";
import { Link } from "../../ui/primitives/link";

// @cpt-component:cpt-noter-component-ui-output-item-row:p1
export function OutputItemRow({ bridge, item }: { bridge: Bridge; item: ItemView }) {
  const span = item.spans[0];
  return (
    <li className="pc-item" data-component="cpt-noter-component-ui-output-item-row" data-review={item.review}>
      <span className="pc-item__text" lang={typeof item.lang === "string" ? item.lang : item.lang.code}>{item.text}</span>
      {item.owner && <span className="np-dim">{item.owner.short_name}</span>}
      {item.topic && <Badge kind="kind" text={item.topic.name} />}
      {item.review === "suggested" && <Badge kind="status" tone="accent" text={t("outputs.suggested")} />}
      {/* the evidence opens the transcript at the span (`window_navigate`, as a notification does) */}
      {span && <Link label={t("outputs.evidence")} onAction={() => void bridge.core.windowNavigate({ target: { type: "call_page", call_id: span.call_id, tab: "transcript", span } })} />}
    </li>
  );
}
