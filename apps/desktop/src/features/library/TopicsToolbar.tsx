import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import { SearchField } from "../../ui/primitives/search-field";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";
import { useHead } from "./topics-head";
import { setTopicWords, useTopicWords } from "./topics-query";

/** Topics' toolbar (LT-R1): the title with the topic count, and the name search (live, not the global one that opens Search results). */
export function TopicsToolbar({ base }: PageToolbarProps) {
  const words = useTopicWords();
  const head = useHead();
  return (
    <MainToolbar
      {...base}
      region="LT-R1"
      title={t("topics.title")}
      subtitle={head.subtitle ?? undefined}
      hasSearch={false}
      trailing={<SearchField id="lt-search" cls="lb-tsearch" placeholder={t("topics.search")} ariaLabel={t("topics.search")} value={words} onChange={setTopicWords} />}
    />
  );
}

/** The thread's toolbar (TH-R1): Back, the topic name with its counts, and Ask About This Thread (waits for Ask). */
export function ThreadToolbar({ base }: PageToolbarProps) {
  const head = useHead();
  return (
    <MainToolbar
      {...base}
      region="TH-R1"
      title={head.title ?? t("topics.title")}
      subtitle={head.subtitle ?? undefined}
      hasSearch={false}
      trailing={<PushButton label={t("topics.ask_thread")} disabled help={t("topics.ask_pending")} />}
    />
  );
}
