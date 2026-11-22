import { useRef, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { AskAnswer, AskRating } from "../../core/bindings";
import { t } from "../../i18n/format";
import { IconButton } from "../../ui/primitives/icon-button";

// @cpt-dod:cpt-noter-dod-ui-ask-citations:p1
/** Measured answer work and acknowledged, persisted feedback. Keyed by turn and stored rating. `part` draws the meta line
 * or the thumbs alone: the thumbs sit on the **Copy with Citations** row, as in the prototype. */
export function AnswerFeedback({ bridge, answer, part }: { bridge: Bridge; answer: AskAnswer; part?: "meta" | "rate" }) {
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
  const thumbs = !answer.stopped && (
    <>
      <IconButton icon="thumbUp" label={t("ask.helpful")} disabled={saving} pressed={rating === "helpful"} onAction={() => void rate("helpful")} />
      <IconButton icon="thumbDown" label={t("ask.not_helpful")} disabled={saving} pressed={rating === "not_helpful"} onAction={() => void rate("not_helpful")} />
      {failed && <span role="alert" className="ak-status">{t("ask.rating_failed")}</span>}
    </>
  );
  if (part === "rate") return thumbs || null;
  return <div>
    {m && <div className="ak-status">{t("ask.meta", {
      calls: t("ask.meta_calls", { count: m.call_hits }), items: t("ask.meta_items", { count: m.item_hits }),
      documents: t("ask.meta_documents", { count: m.document_hits }), elapsed: m.elapsed_ms,
    })}</div>}
    {part !== "meta" && thumbs && <div className="ak-actions">{thumbs}</div>}
  </div>;
}
