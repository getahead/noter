import { useMemo } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { OutputItemRow } from "../call-page/OutputItemRow";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import type { TopicThread, UiPrefs } from "../../core/bindings";
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
  return <ThreadView bridge={bridge} status={read.status} retry={retry} data={data} months={months} prefs={prefs} />;
}

export interface ThreadViewProps {
  bridge: Bridge;
  status: "LOADING" | "READY" | "ERROR";
  retry: () => void;
  data: TopicThread | null;
  months: ThreadMonth[];
  prefs?: UiPrefs;
}

export function ThreadView({ bridge, status, retry, data, months, prefs }: ThreadViewProps) {
  if (status === "ERROR")
    return <InlineBanner banner={{ id: "thread-error", severity: "error", text: t("topics.thread_error"), actions: [{ label: t("action.try_again"), onAction: retry }] }} />;
  if (!data) return <div className="lb-loading" data-state="loading" aria-busy="true" aria-label={t("topics.loading")} />;
  const since = Math.min(...data.groups.map((g) => g.call.started_at));
  // @cpt-begin:cpt-noter-state-ui-library-search-topics-view:p1:inst-thread
  return (
    <>
      <div data-region="TH-R1" className="lb-head">
        <h2 className="lb-title" tabIndex={-1}>
          {data.topic.name}
        </h2>{" "}
        {threadSubtitle(data.topic, Number.isFinite(since) ? since : null, prefs)}
      </div>
      <div data-region="TH-R3" role="region" aria-label={t("topics.timeline")} className="lb-thread" data-state={months.length ? "thread" : "thread-empty"}>
        {months.length ? (
          months.map((m) => (
            <div key={m.label} className="lb-thmonth">
              <h2 className="lb-thmonth__h">{m.label}</h2>
              <ul className="lb-items">
                {m.entries.map((e) => (
                  <OutputItemRow key={e.item.id} bridge={bridge} item={e.item} />
                ))}
              </ul>
            </div>
          ))
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
