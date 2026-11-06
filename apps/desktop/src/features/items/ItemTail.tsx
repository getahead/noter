// What follows a decision, question or risk in the Summary view: its provenance time, the review buttons while it is
// suggested (Edit opens the Item inspector) and the (i) button. Registered in the section's seam (`register.tsx`).
import type { Bridge } from "../../app/bridge/bridge";
import type { ItemView } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineStatus } from "../../ui/feedback/inline-status";
import { IconButton } from "../../ui/primitives/icon-button";
import { undoRow } from "./actions";
import { ReviewButtons, useItem } from "./ActionItemRow";
import { patchLocal, useLocal } from "./local";
import { ProvenanceChip } from "./ProvenanceChip";
import { slots } from "./slots";

export function ItemTail({ bridge, item }: { bridge: Bridge; item: ItemView }) {
  const it = useItem(bridge, item);
  const local = useLocal(it.id);
  const inspect = slots.inspect ? () => slots.inspect!(bridge, it.id) : null;
  return (
    <>
      {it.spans[0] && <ProvenanceChip bridge={bridge} span={it.spans[0]} />}
      {local.outcome && (
        <InlineStatus variant="row-outcome" text={local.outcome.text} ms={local.outcome.ms} actionLabel={local.outcome.target ? t("items.undo") : undefined} onAction={() => void undoRow(bridge, it.id, local.outcome!.target!)} onExpire={() => patchLocal(it.id, { outcome: undefined })} />
      )}
      {it.review === "suggested" && !local.outcome && <ReviewButtons it={it} bridge={bridge} retryOnly={!!local.retryAccept} edit={inspect} />}
      {local.error && <span className="it-row__error" role="alert">{local.error}</span>}
      {inspect && <IconButton icon="info" label={t("items.inspect")} size="inline" onAction={inspect} />}
    </>
  );
}
