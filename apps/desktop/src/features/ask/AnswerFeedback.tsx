import { useRef, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { AskAnswer, AskRating } from "../../core/bindings";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";

// @cpt-dod:cpt-noter-dod-ui-ask-citations:p1
/** Measured answer work and acknowledged, persisted feedback. Keyed by turn and stored rating. */
export function AnswerFeedback({ bridge, answer }: { bridge: Bridge; answer: AskAnswer }) {
  const [rating, setRating] = useState(answer.rating ?? null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const rate = async (choice: AskRating) => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setFailed(false);
    const next = rating === choice ? null : choice;
    try {
      const result = await bridge.act(answer.turn_id, "ask_rate", () => bridge.core.askRate({ turn_id: answer.turn_id, rating: next }));
      if (result.status === "ok") setRating(next);
      else setFailed(true);
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  const m = answer.meta;
  return <div>
    {m && <div className="ak-status">{t("ask.meta", {
      calls: t("ask.meta_calls", { count: m.call_hits }), items: t("ask.meta_items", { count: m.item_hits }),
      documents: t("ask.meta_documents", { count: m.document_hits }), elapsed: m.elapsed_ms,
    })}</div>}
    {!answer.stopped && <div className="ak-actions">
      <PushButton label={t("ask.helpful")} size="small" variant="quiet" disabled={saving} attrs={{ "aria-pressed": String(rating === "helpful") }} onAction={() => void rate("helpful")} />
      <PushButton label={t("ask.not_helpful")} size="small" variant="quiet" disabled={saving} attrs={{ "aria-pressed": String(rating === "not_helpful") }} onAction={() => void rate("not_helpful")} />
    </div>}
    {failed && <div role="alert" className="ak-status">{t("ask.rating_failed")}</div>}
  </div>;
}
