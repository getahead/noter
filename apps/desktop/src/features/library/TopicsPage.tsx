import { useEffect, useMemo, useRef, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { TopicRow, UiPrefs } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Icon } from "../../ui/icons";
import { IconButton } from "../../ui/primitives/icon-button";
import { Table } from "../../ui/primitives/table";
import { filterTopics, lastSeen, mergeTopics } from "./topics-model";
import { setTopicWords, useTopicWords } from "./topics-query";
import { openTopic } from "./topic-nav";
import { useRead } from "./use-read";
import "./library.css";

// @cpt-state:cpt-noter-state-ui-library-search-topics-view:p1
// @cpt-component:cpt-noter-component-screen-library:p1
/** Library › Topics (LT-R2): the table of topics, or its empty, no-match and error states. */
export function TopicsPage({ bridge }: { bridge: Bridge }) {
  const words = useTopicWords();
  // @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-list-topics
  const [read, retry] = useRead(() => bridge.act("topics_list", "topics_list", () => bridge.core.topicsList({}), { screen: "library-topics" }), "topics");
  // @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-list-topics
  const held = useWindow(bridge, (s) => s.entities.topic);
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const all = read.status === "READY" ? read.data.topics : null;
  // a topic the core removed (a merge) was in the store and no longer is: it leaves the table
  const known = useRef<Set<string>>(new Set());
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const missing = [...known.current].filter((id) => !(id in held));
    known.current = new Set(Object.keys(held));
    if (missing.length) setGone((g) => new Set([...g, ...missing]));
  }, [held]);
  const topics = useMemo(() => (all ? mergeTopics(all, held, gone) : []), [all, held, gone]);
  useEffect(() => () => setTopicWords(""), []);
  const shown = useMemo(() => filterTopics(topics, words), [topics, words]);
  const names = useMemo(() => new Map(topics.map((x) => [x.id, x.name])), [topics]);

  return <TopicsBody bridge={bridge} status={read.status} retry={retry} topics={topics} shown={shown} names={names} words={words} prefs={prefs} />;
}

export interface TopicsBodyProps {
  bridge: Bridge;
  status: "LOADING" | "READY" | "ERROR";
  retry: () => void;
  topics: TopicRow[];
  shown: TopicRow[];
  names: ReadonlyMap<string, string>;
  words: string;
  prefs?: UiPrefs;
}

export function TopicsBody({ bridge, status, retry, topics, shown, names, words, prefs }: TopicsBodyProps) {
  if (status === "ERROR")
    return <InlineBanner banner={{ id: "topics-error", severity: "error", text: t("topics.error"), actions: [{ label: t("action.try_again"), onAction: retry }] }} />;
  if (status === "LOADING") return <div className="lb-loading" data-state="loading" aria-busy="true" aria-label={t("topics.loading")} />;
  // @cpt-begin:cpt-noter-state-ui-library-search-topics-view:p1:inst-topics
  if (!topics.length)
    return (
      <div data-region="LT-R2" role="region" aria-label={t("topics.title")} data-state="no-topics">
        <EmptyState variant="large" icon="thread" heading title={t("topics.empty_title")} body={t("topics.empty_body")} />
      </div>
    );
  if (!shown.length)
    return (
      <div data-region="LT-R2" role="region" aria-label={t("topics.title")} data-state="no-match">
        <EmptyState variant="filtered" title={t("topics.no_match", { query: words.trim() })} actionLabel={t("topics.clear_search")} onAction={() => setTopicWords("")} />
      </div>
    );
  // @cpt-end:cpt-noter-state-ui-library-search-topics-view:p1:inst-topics
  return (
    <div data-region="LT-R2" role="region" aria-label={t("topics.title")} data-state="topics">
      <Table variant="sortable" label={t("topics.title")} cls="lb-table lb-ttable" wrapCls="lb-tablewrap">
        <thead>
          <tr>
            <th scope="col">{t("topics.col.topic")}</th>
            <th scope="col" style={{ width: "80px" }}>{t("topics.col.calls")}</th>
            <th scope="col" style={{ width: "100px" }}>{t("topics.col.decisions")}</th>
            <th scope="col" style={{ width: "130px" }}>{t("topics.col.open")}</th>
            <th scope="col" style={{ width: "130px" }}>{t("topics.col.last")}</th>
            <th scope="col" style={{ width: "36px" }}><span className="np-sr">{t("topics.col.go")}</span></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((x, i) => (
            <TopicLine key={x.id} bridge={bridge} topic={x} stop={i === 0} merge={x.merge_suggestion ? (names.get(x.merge_suggestion.id) ?? x.merge_suggestion.name) : null} last={lastSeen(x.last_seen, prefs)} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

export function TopicLine({ bridge, topic: x, stop, merge, last }: { bridge: Bridge; topic: TopicRow; stop: boolean; merge: string | null; last: string }) {
  const open = () => openTopic(bridge, x.id);
  return (
    <tr
      className="lb-trow"
      data-component="cpt-noter-component-screen-library"
      data-lib-topic={x.id}
      data-state={merge ? "merge-suggested" : "default"}
      aria-label={x.name}
      tabIndex={stop ? 0 : -1}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && !e.metaKey && (e.preventDefault(), open())}
    >
      <td>
        <span className="lb-trow__name" >
          <Icon name="thread" size={12} cls="np-dim" /> {x.name}
        </span>
        {merge && (
          <span className="lb-merge" title={t("topics.merge_hint", { name: merge })}>
            {" "}
            <Icon name="merge" size={12} label={t("topics.merge_glyph")} />
          </span>
        )}
      </td>
      <td className="np-tnum">{x.calls}</td>
      <td className="np-tnum">{x.decisions}</td>
      <td className="np-tnum">{x.open_items}</td>
      <td>{last}</td>
      <td>
        <IconButton icon="chevronRight" label={t("topics.open_topic", { name: x.name })} size="inline" onAction={open} />
      </td>
    </tr>
  );
}
