import type { Bridge } from "../../app/bridge/bridge";
import type { TopicRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { holdUndo } from "../history/undo";
import { clashOf } from "./topics-model";

export type RenameOutcome =
  | { type: "renamed"; topic: TopicRow }
  | { type: "blank" }
  | { type: "clash"; other: TopicRow }
  | { type: "stale" }
  | { type: "failed" };

// @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-rename
/** Renames `topic`; a taken name is refused here (the pre-check that offers Merge Instead) and by the core alike, a stale revision keeps the draft. Undo is offered with the returned change. */
export async function renameTopic(bridge: Bridge, topic: TopicRow, name: string, known: TopicRow[], refresh: () => void): Promise<RenameOutcome> {
  const clean = name.trim();
  if (!clean) return { type: "blank" };
  const other = clashOf(known, topic.id, clean);
  if (other) return { type: "clash", other };
  const res = await bridge.act("topic_rename", "topic_rename", () => bridge.core.topicRename({ topic_id: topic.id, rev: topic.rev, name: clean }), { screen: "library-topics", entity: "topic" });
  if (res.status === "ok") {
    holdUndo({ target: { type: "change", change_id: res.data.change_id }, message: t("topics.renamed", { name: res.data.topic.name }), refresh });
    return { type: "renamed", topic: res.data.topic };
  }
  const d = res.error.detail;
  if (res.error.code === "conflict") return { type: "stale" };
  if (res.error.code === "invalid_input" && d?.type === "validation" && d.field === "name")
    return d.rule === "duplicate" ? { type: "clash", other: known.find((x) => x.id !== topic.id && x.name.toLowerCase() === clean.toLowerCase()) ?? topic } : { type: "blank" };
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
// @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-merge

// @cpt-begin:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-separate
/** Marks two topics as different subjects for good; true once the core accepted it. */
export async function keepSeparate(bridge: Bridge, a: string, b: string): Promise<boolean> {
  const res = await bridge.act("topics_keep_separate", "topics_keep_separate", () => bridge.core.topicsKeepSeparate({ a, b }), { screen: "library-topics" });
  return res.status === "ok";
}
// @cpt-end:cpt-noter-flow-ui-library-search-topics-topic:p1:inst-separate
