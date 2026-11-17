import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { TopicRow, UiPrefs } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Icon } from "../../ui/icons";
import { IconButton } from "../../ui/primitives/icon-button";
import { Menu } from "../../ui/primitives/menu";
import { Table } from "../../ui/primitives/table";
import { useSheetIfAny } from "../../ui/dialogs/host";
import { threadActions, useRegisterTopicSheets } from "./ThreadPage";
import { filterTopics, lastSeen, mergeTopics } from "./topics-model";
import { setTopicWords, useTopicWords } from "./topics-query";
import { openTopic } from "./topic-nav";
import { usePublishHead } from "./topics-head";
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
  usePublishHead(null, all ? t("topics.count", { count: topics.length }) : null);
  const shown = useMemo(() => filterTopics(topics, words), [topics, words]);
  const names = useMemo(() => new Map(topics.map((x) => [x.id, x.name])), [topics]);

  const sheets = useSheetIfAny();
  useRegisterTopicSheets(sheets);
  const [menu, setMenu] = useState<{ x: number; y: number; topic: TopicRow } | null>(null);
  useEffect(() => (menu ? closeOnPointer(() => setMenu(null)) : undefined), [menu]);
  const rowMenu = menu && sheets && (
    <div className="lb-ctx" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
      <Menu variant="context-menu" onClose={() => setMenu(null)} items={topicMenu(() => openTopic(bridge, menu.topic.id), threadActions(sheets, bridge, menu.topic, topics, retry), () => setMenu(null))} />
    </div>
  );
  return <TopicsBody bridge={bridge} status={read.status} retry={retry} topics={topics} shown={shown} names={names} words={words} prefs={prefs} onContext={(topic, e) => setMenu({ x: e.clientX, y: e.clientY, topic })} menu={rowMenu} />;
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
  /** A right-click on a row, and the menu the page draws for it. */
  onContext?: (topic: TopicRow, e: MouseEvent) => void;
  menu?: ReactNode;
}

export function TopicsBody({ bridge, status, retry, topics, shown, names, words, prefs, onContext, menu }: TopicsBodyProps) {
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
            <TopicLine key={x.id} bridge={bridge} topic={x} stop={i === 0} merge={x.merge_suggestion ? (names.get(x.merge_suggestion.id) ?? x.merge_suggestion.name) : null} last={lastSeen(x.last_seen, prefs)} onContext={onContext && ((e) => (e.preventDefault(), onContext(x, e)))} />
          ))}
        </tbody>
      </Table>
      {menu}
    </div>
  );
}

/** `close` runs on the next pointer press anywhere; returns the way to stop listening. */
export function closeOnPointer(close: () => void): () => void {
  document.addEventListener("pointerdown", close);
  return () => document.removeEventListener("pointerdown", close);
}

/** The row's context menu: Open, Rename… and Merge With… (each closes the menu first). */
export function topicMenu(open: () => void, actions: { rename: () => void; merge: () => void }, close: () => void) {
  const run = (f: () => void) => () => (close(), f());
  return [
    { label: t("library.menu.open"), onSelect: run(open) },
    { label: t("topics.rename"), onSelect: run(actions.rename) },
    { label: t("topics.merge_with"), onSelect: run(actions.merge) },
  ];
}

export function TopicLine({ bridge, topic: x, stop, merge, last, onContext }: { bridge: Bridge; topic: TopicRow; stop: boolean; merge: string | null; last: string; onContext?: (e: MouseEvent) => void }) {
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
      onContextMenu={onContext}
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
