import { useState } from "react";
import { t } from "../../i18n/format";
import { IconButton } from "../../ui/primitives/icon-button";
import { PushButton } from "../../ui/primitives/push-button";
import { SearchField } from "../../ui/primitives/search-field";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar, OverflowMenu } from "../shell/toolbar";
import { useThreadMenu } from "./thread-menu";
import { askAboutTopic } from "./topic-nav";
import { parseTopicKey } from "./topics-model";
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

/** The thread's toolbar (TH-R1): Back, the topic name with its counts, Ask About This Thread (waits for Ask) and the ⋯ menu with Rename… and Merge With…. */
export function ThreadToolbar({ base, route }: PageToolbarProps) {
  const topicId = parseTopicKey(route.key);
  const head = useHead();
  const menu = useThreadMenu();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <MainToolbar
      {...base}
      region="TH-R1"
      title={head.title ?? t("topics.title")}
      subtitle={head.subtitle ?? undefined}
      hasSearch={false}
      trailing={
        <>
          <PushButton label={t("topics.ask_thread")} disabled={!topicId} onAction={() => topicId && askAboutTopic(topicId)} />
          {menu.length > 0 && (
            <>
              <IconButton id="th-more" icon="ellipsis" label={t("shell.more")} attrs={{ "aria-haspopup": "menu", "aria-expanded": String(anchor !== null) }} onAction={() => setAnchor(anchor ? null : globalThis.document?.getElementById("th-more") ?? null)} />
              {anchor && <OverflowMenu actions={menu} anchor={anchor} onClose={() => setAnchor(null)} />}
            </>
          )}
        </>
      }
    />
  );
}
