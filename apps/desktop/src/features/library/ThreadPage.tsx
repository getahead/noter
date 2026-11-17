import { useEffect, useMemo, useRef, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { ThreadRow } from "./ThreadRow";
import { usePublishHead } from "./topics-head";
import { usePublishThreadMenu, type MenuEntry } from "./thread-menu";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import type { TopicRow, TopicThread, UiPrefs } from "../../core/bindings";
import { useSheet } from "../../ui/dialogs/host";
import type { Sheets } from "../../ui/dialogs/sheets";
import { openTopic } from "./topic-nav";
import { MergeSheet } from "./MergeSheet";
import { RenameSheet } from "./RenameSheet";
import { keepSeparate } from "./topics-actions";
import { monthsOf, threadSubtitle, type ThreadMonth } from "./topics-model";
import { useRead } from "./use-read";
import "./library.css";

// @cpt-component:cpt-noter-component-screen-library:p1
/** Library › Topic thread (TH-R1, TH-R3): the topic's counts and its entries by month, newest first. */
export function ThreadPage({ bridge, topicId }: { bridge: Bridge; topicId: string }) {
  // @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-get-topic
  const [read, retry] = useRead(() => bridge.act("topic_get", "topic_get", () => bridge.core.topicGet({ topic_id: topicId }), { screen: "library-topics" }), topicId);
  // @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-get-topic
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const data = read.status === "READY" ? read.data : null;
  const months = useMemo(() => (data ? monthsOf(data.groups, prefs) : []), [data, prefs]);
  const since = data?.groups.length ? Math.min(...data.groups.map((g) => g.call.started_at)) : null;
  usePublishHead(data?.topic.name ?? null, data ? threadSubtitle(data.topic, since, prefs) : null);
  const sheets = useSheet();
  const [all, setAll] = useState<TopicRow[]>([]);
  const [keepFailed, setKeepFailed] = useState(false);
  useEffect(() => {
    void bridge.act("topics_list", "topics_list", () => bridge.core.topicsList({}), { screen: "library-topics" }).then((r) => r.status === "ok" && setAll(r.data.topics));
  }, [bridge, data?.topic.rev]);
  useEffect(() => {
    sheets.register("topic-rename", RenameSheet as never);
    sheets.register("topic-merge", MergeSheet as never);
  }, [sheets]);
  const actions = data && threadActions(sheets, bridge, data.topic, all, retry, setKeepFailed);
  const latest = useRef(actions);
  latest.current = actions;
  const menu = useMemo<MenuEntry[]>(() => [{ label: t("topics.rename"), onAction: () => latest.current?.rename() }, { label: t("topics.merge_with"), onAction: () => latest.current?.merge() }], []);
  usePublishThreadMenu(data ? menu : null);
  return <ThreadView bridge={bridge} status={read.status} retry={retry} data={data} months={months} prefs={prefs} actions={actions ?? undefined} keepFailed={keepFailed} />;
}

/** What the thread's buttons do: the sheets over the page, and Keep Separate at once. */
export function threadActions(sheets: Sheets, bridge: Bridge, topic: TopicRow, all: TopicRow[], retry: () => void, onKeepFailed: (failed: boolean) => void = () => {}): ThreadActions {
  const merge = (target?: string) => sheets.open("topic-merge", { bridge, source: topic, target, known: all, onMerged: (kept: TopicRow) => (openTopic(bridge, kept.id), retry()), refresh: retry });
  return {
    rename: () => sheets.open("topic-rename", { bridge, topic, known: all, onRenamed: retry, onMergeInstead: (other: TopicRow) => merge(other.id) }),
    merge: () => merge(topic.merge_suggestion?.id),
    // @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-if-separate
    keepSeparate: () => topic.merge_suggestion && void keepSeparate(bridge, topic.id, topic.merge_suggestion.id).then((ok) => (onKeepFailed(!ok), ok && retry())),
    // @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-if-separate
  };
}

export interface ThreadActions {
  rename: () => void;
  merge: () => void;
  keepSeparate: () => void;
}

export interface ThreadViewProps {
  bridge: Bridge;
  status: "LOADING" | "READY" | "ERROR";
  retry: () => void;
  data: TopicThread | null;
  months: ThreadMonth[];
  prefs?: UiPrefs;
  actions?: ThreadActions;
  /** Keep Separate was refused: the thread says so. */
  keepFailed?: boolean;
}

export function ThreadView({ bridge, status, retry, data, months, prefs, actions, keepFailed }: ThreadViewProps) {
  if (status === "ERROR")
    return <InlineBanner banner={{ id: "thread-error", severity: "error", text: t("topics.thread_error"), actions: [{ label: t("action.try_again"), onAction: retry }] }} />;
  if (!data) return <div className="lb-loading" data-state="loading" aria-busy="true" aria-label={t("topics.loading")} />;
  // @cpt-begin:cpt-noter-state-ui-library-search-topics-view:p1:inst-thread
  return (
    <>
      {keepFailed && (
        <div className="lb-thmerge">
          <InlineBanner banner={{ id: "thread-keep-error", severity: "error", text: t("topics.keep_failed") }} />
        </div>
      )}
      {actions && data.topic.merge_suggestion && (
        <div data-region="TH-R2" className="lb-thmerge">
          <InlineBanner
            banner={{
              id: "thread-merge-suggestion",
              severity: "info",
              text: t("topics.suggestion", { name: data.topic.merge_suggestion.name }),
              actions: [
                { label: t("topics.merge_confirm"), onAction: actions.merge },
                { label: t("topics.keep_separate"), onAction: actions.keepSeparate },
              ],
            }}
          />
        </div>
      )}
      <div data-region="TH-R3" role="region" aria-label={t("topics.timeline")} className="lb-thread" data-state={months.length ? "thread" : "thread-empty"}>
        {months.length ? (
          // @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-timeline
          months.map((m) => (
            <div key={m.label} className="lb-thmonth">
              <h2 className="lb-thmonth__h">{m.label}</h2>
              <ul className="lb-items">
                {m.entries.map((e) => (
                  <ThreadRow key={e.item.id} bridge={bridge} item={e.item} call={e.call} prefs={prefs} />
                ))}
              </ul>
            </div>
          ))
          // @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-timeline
        ) : (
          // @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-empty-topic
          <EmptyState variant="large" icon="thread" title={t("topics.nothing_title")} body={t("topics.nothing_body")} />
          // @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-empty-topic
        )}
      </div>
    </>
  );
  // @cpt-end:cpt-noter-state-ui-library-search-topics-view:p1:inst-thread
}
