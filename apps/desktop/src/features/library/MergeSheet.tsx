import { useEffect, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { TopicRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import type { SheetProps } from "../../ui/dialogs/sheets";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { mergeTopic } from "./topics-actions";
import { itemsOf } from "./topics-model";

type Props = SheetProps & {
  bridge: Bridge;
  source: TopicRow;
  /** The topic to keep, when a suggestion or a name clash named it. */
  target?: string;
  known: TopicRow[];
  onMerged: (kept: TopicRow) => void;
};

/** Merge With… (MERGING): the 520-pt sheet with the target chooser (never this topic), what moves, Cancel and Merge. */
export function MergeSheet({ close, bridge, source, target, known, onMerged }: Props) {
  const choices = known.filter((x) => x.id !== source.id);
  const [keep, setKeep] = useState(choices.find((x) => x.id === target)?.id ?? choices[0]?.id ?? "");
  const [moves, setMoves] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void bridge.act("topic_get", "topic_get", () => bridge.core.topicGet({ topic_id: source.id }), { screen: "library-topics" }).then((r) => live && setMoves(r.status === "ok" ? itemsOf(r.data.groups) : null));
    return () => void (live = false);
  }, [bridge, source.id]);
  async function run() {
    if (!keep || keep === source.id) return;
    setBusy(true);
    const kept = await mergeTopic(bridge, source.id, keep, moves ?? 0, () => {});
    setBusy(false);
    if (!kept) return setFailed(true);
    onMerged(kept);
    close();
  }
  return (
    <Sheet title={t("topics.merge_title")} width={520} busy={busy} onCancel={close} onDefault={() => void run()}>
      <div className="np-sheet__head">
        <div className="np-sheet__title">{t("topics.merge_title")}</div>
      </div>
      <div className="np-sheet__body" data-state="open">
        <label className="pe-form__row">
          <span className="np-field__label">{t("topics.merge_into")}</span>
          <PopupButton id="lb-merge-to" label={t("topics.merge_keep")} options={choices.map((x) => ({ value: x.id, label: x.name }))} value={keep} onAction={setKeep} />
        </label>
        <p className="np-field__label">{t("topics.merge_moves")}</p>
        <p>{moves ? t("topics.merge_moves_count", { count: moves }) : t("topics.merge_nothing")}</p>
        {failed && <InlineBanner banner={{ id: "merge-error", severity: "error", text: t("topics.merge_failed"), actions: [{ label: t("action.try_again"), onAction: () => void run() }] }} />}
      </div>
      <SheetFooter defaultButton={<PushButton label={t("topics.merge_confirm")} variant="primary" submit loading={busy} disabled={!keep} onAction={() => void run()} />}>
        <PushButton label={t("dialogs.cancel")} onAction={close} />
      </SheetFooter>
    </Sheet>
  );
}
