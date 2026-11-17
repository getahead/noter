import { useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { TopicRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import type { SheetProps } from "../../ui/dialogs/sheets";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { TextField } from "../../ui/primitives/text-field";
import { renameTopic } from "./topics-actions";

type Props = SheetProps & {
  bridge: Bridge;
  topic: TopicRow;
  /** Every topic, for the name-taken check. */
  known: TopicRow[];
  onRenamed: () => void;
  onMergeInstead: (other: TopicRow) => void;
};

// @cpt-state:cpt-noter-state-ui-library-search-topics-view:p1
/** Rename… (RENAMING): the current name, a nonblank name, Merge Instead for a taken one; failure keeps the draft. */
export function RenameSheet({ close, bridge, topic, known, onRenamed, onMergeInstead }: Props) {
  const [name, setName] = useState(topic.name);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; clash?: TopicRow } | null>(null);
  async function run() {
    setBusy(true);
    const out = await renameTopic(bridge, topic, name, known, onRenamed);
    setBusy(false);
    // @cpt-begin:cpt-noter-state-ui-library-search-topics-view:p1:inst-renamed
    if (out.type === "renamed") return close();
    // @cpt-end:cpt-noter-state-ui-library-search-topics-view:p1:inst-renamed
    if (out.type === "clash") return setProblem({ text: t("topics.rename_clash", { name: out.other.name }), clash: out.other });
    setProblem({ text: t(out.type === "blank" ? "topics.rename_blank" : out.type === "stale" ? "topics.rename_stale" : "topics.rename_failed") });
    if (out.type === "stale") onRenamed();
  }
  // @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-rename-form
  return (
    <Sheet title={t("topics.rename_title")} width={480} busy={busy} onCancel={close} onDefault={() => void run()}>
      <div className="np-sheet__head">
        <div className="np-sheet__title">{t("topics.rename_title")}</div>
      </div>
      <div className="np-sheet__body" data-state={problem?.clash ? "clash" : "open"}>
        <TextField id="topic-rename-field" ariaLabel={t("topics.rename_field")} value={name} onChange={(v) => (setName(v), setProblem(null))} onEnter={() => void run()} invalid={!!problem} message={problem?.text} />
      </div>
      <SheetFooter defaultButton={<PushButton label={t("topics.rename_confirm")} variant="primary" submit loading={busy} onAction={() => void run()} />}>
        <PushButton label={t("dialogs.cancel")} onAction={close} />
        {problem?.clash && <PushButton label={t("topics.merge_instead")} onAction={() => (close(), onMergeInstead(problem.clash!))} />}
      </SheetFooter>
    </Sheet>
  );
  // @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-rename-form
}
