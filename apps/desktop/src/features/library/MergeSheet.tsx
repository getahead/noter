import { useEffect, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { TopicRow, TopicThreadGroup } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import type { SheetProps } from "../../ui/dialogs/sheets";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { KIND_KEY } from "../items/kind";
import { confirmMerge } from "./topics-actions";
import { movesOf } from "./topics-model";

type Props = SheetProps & {
  bridge: Bridge;
  source: TopicRow;
  /** The topic to keep, when a suggestion or a name clash named it. */
  target?: string;
  known: TopicRow[];
  onMerged: (kept: TopicRow) => void;
  /** Re-reads the page once an Undo of this merge settled. */
  refresh?: () => void;
};


/** Merge With… (MERGING): the 520-pt sheet with the target chooser (never this topic), what moves, Cancel and Merge. */
export function MergeSheet({ close, bridge, source, target, known, onMerged, refresh }: Props) {
  const choices = known.filter((x) => x.id !== source.id);
  const [keep, setKeep] = useState(choices.find((x) => x.id === target)?.id ?? choices[0]?.id ?? "");
  // undefined while reading, null when the read failed: the count is never guessed.
  const [groups, setGroups] = useState<TopicThreadGroup[] | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void bridge.act("topic_get", "topic_get", () => bridge.core.topicGet({ topic_id: source.id }), { screen: "library-topics" }).then((r) => live && setGroups(r.status === "ok" ? r.data.groups : null));
    return () => void (live = false);
  }, [bridge, source.id]);
  async function run() {
    setBusy(true);
    const kept = await confirmMerge(bridge, source.id, keep, groups, refresh ?? (() => {}));
    setBusy(false);
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-return-topic
    if (kept === undefined) return;
    if (!kept) return setFailed(true);
    onMerged(kept);
    close();
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-return-topic
  }
  const into = choices.find((x) => x.id === keep)?.name ?? "";
  // @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-merge-preview
  const title = t("topics.merge_title", { from: source.name, to: into });
  return (
    <Sheet title={title} width={520} busy={busy} onCancel={close} onDefault={() => void run()}>
      <div className="np-sheet__head">
        <div className="np-sheet__title">{title}</div>
      </div>
      <div className="np-sheet__body" data-state="open">
        <p>{t("topics.merge_explain", { from: source.name, to: into })}</p>
        <label className="pe-form__row lb-mergeinto">
          <span className="np-field__label">{t("topics.merge_into")}</span>
          <PopupButton id="lb-merge-to" label={t("topics.merge_keep")} options={choices.map((x) => ({ value: x.id, label: x.name }))} value={keep} onAction={setKeep} />
        </label>
        {groups === undefined && <p className="np-dim">{t("topics.merge_reading")}</p>}
        {groups === null && <InlineBanner banner={{ id: "merge-read-error", severity: "error", text: t("topics.merge_unknown") }} />}
        {groups && <Moves groups={groups} />}
        {failed && <InlineBanner banner={{ id: "merge-error", severity: "error", text: t("topics.merge_failed"), actions: [{ label: t("action.try_again"), onAction: () => void run() }] }} />}
      </div>
      <SheetFooter defaultButton={<PushButton label={t("topics.merge_confirm")} variant="primary" submit loading={busy} disabled={!keep || !groups} onAction={() => void run()} />}>
        <PushButton label={t("dialogs.cancel")} onAction={close} />
      </SheetFooter>
    </Sheet>
  );
  // @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-merge-preview
}

/** "What moves · N items from M calls" and each item's kind and text; an empty topic says only an alias moves. */
export function Moves({ groups }: { groups: TopicThreadGroup[] }) {
  const moves = movesOf(groups);
  return (
    <>
      <p className="np-field__label">{t("topics.merge_moves", { items: t("topics.merge_items", { count: moves.rows.length }), calls: t("topics.calls", { count: moves.calls }) })}</p>
      {moves.rows.length ? (
        <ul className="lb-mergelist">
          {moves.rows.map((item) => (
            <li key={item.id}>
              <span className="np-dim">{t(KIND_KEY[item.kind])}</span> {item.text}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("topics.merge_nothing")}</p>
      )}
    </>
  );
}
