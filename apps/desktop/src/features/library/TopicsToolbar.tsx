import { t } from "../../i18n/format";
import { SearchField } from "../../ui/primitives/search-field";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";
import { setTopicWords, useTopicWords } from "./topics-query";

/** Topics' toolbar: the title and the name search (live, not the global one that opens Search results). */
export function TopicsToolbar({ base }: PageToolbarProps) {
  const words = useTopicWords();
  return (
    <MainToolbar
      {...base}
      region="LT-R1"
      title={t("topics.title")}
      hasSearch={false}
      trailing={<SearchField id="lt-search" cls="lb-tsearch" placeholder={t("topics.search")} ariaLabel={t("topics.search")} value={words} onChange={setTopicWords} />}
    />
  );
}
