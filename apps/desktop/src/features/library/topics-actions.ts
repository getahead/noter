import type { Bridge } from "../../app/bridge/bridge";
import type { TopicRow, TopicThreadGroup } from "../../core/bindings";
import { t } from "../../i18n/format";
import { holdUndo } from "../history/undo";
import { clashOf, movesOf } from "./topics-model";

export type RenameOutcome =
  | { type: "renamed"; topic: TopicRow }
  | { type: "blank" }
  | { type: "clash"; other: TopicRow }
  | { type: "stale" }
  | { type: "failed" };

// @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-rename
/** Renames `topic`; a taken name is refused here (the pre-check that offers Merge Instead) and by the core alike. A stale revision re-reads the topic and retries once with its fresh revision (the draft is the user's name only); a second conflict is stale. Undo is offered with the returned change. */
export async function renameTopic(bridge: Bridge, topic: TopicRow, name: string, known: TopicRow[], refresh: () => void, retried = false): Promise<RenameOutcome> {
  const clean = name.trim();
  if (!clean) return { type: "blank" };
  const other = clashOf(known, topic.id, clean);
  if (other) return { type: "clash", other };
  const res = await bridge.act("topic_rename", "topic_rename", () => bridge.core.topicRename({ topic_id: topic.id, rev: topic.rev, name: clean }), { screen: "library-topics", entity: "topic" });
  if (res.status === "ok") {
    holdUndo({ target: { type: "change", change_id: res.data.change_id }, message: t("topics.renamed", { from: topic.name, to: res.data.topic.name }), refresh });
    refresh(); // the page that asked shows the new name at once (issue 1047)
    return { type: "renamed", topic: res.data.topic };
  }
  const d = res.error.detail;
  if (res.error.code === "conflict") {
    if (retried) return { type: "stale" };
    const fresh = await bridge.act("topic_get", "topic_get", () => bridge.core.topicGet({ topic_id: topic.id }), { screen: "library-topics" });
    return fresh.status === "ok" ? renameTopic(bridge, fresh.data.topic, name, known, refresh, true) : { type: "stale" };
  }
  if (res.error.code === "invalid_input" && d?.type === "validation" && d.field === "name") {
    if (d.rule !== "duplicate") return { type: "blank" };
    // The page's list can be older than the core's: re-read it, and never name this topic itself.
    const all = await bridge.act("topics_list", "topics_list", () => bridge.core.topicsList({}), { screen: "library-topics" });
    const other = all.status === "ok" ? clashOf(all.data.topics, topic.id, clean) : undefined;
    return other ? { type: "clash", other } : { type: "failed" };
  }
  return { type: "failed" };
}
// @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-rename

// @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-merge
/** Merges `source` into `target` (only on the user's confirmation); the strip offers Undo. Returns the kept topic, or null when the core refused. */
export async function mergeTopic(bridge: Bridge, source: string, target: string, moved: number, refresh: () => void): Promise<TopicRow | null> {
  const res = await bridge.act("topics_merge", "topics_merge", () => bridge.core.topicsMerge({ source, target }), { screen: "library-topics" });
  if (res.status !== "ok") return null;
  holdUndo({ target: { type: "change", change_id: res.data.change_id }, message: t("topics.merged", { count: moved, name: res.data.topic.name }), refresh });
  return res.data.topic;
}

/** What the Merge button does: nothing (`undefined`) until a different kept topic is chosen and the read of what moves landed; then the merge, counting what moved. */
export async function confirmMerge(bridge: Bridge, source: string, keep: string, groups: TopicThreadGroup[] | null | undefined, refresh: () => void): Promise<TopicRow | null | undefined> {
  // @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-if-confirm
  if (!keep || keep === source || !groups) return undefined;
  // @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-if-confirm
  return mergeTopic(bridge, source, keep, movesOf(groups).rows.length, refresh);
}
// @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-merge

// @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-separate
/** Marks two topics as different subjects for good; true once the core accepted it. */
export async function keepSeparate(bridge: Bridge, a: string, b: string): Promise<boolean> {
  const res = await bridge.act("topics_keep_separate", "topics_keep_separate", () => bridge.core.topicsKeepSeparate({ a, b }), { screen: "library-topics" });
  return res.status === "ok";
}
// @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-separate
