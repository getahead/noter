import type { CallRef, ItemView, TopicRow, TopicThreadGroup, UiPrefs } from "../../core/bindings";
import { locale, shortDay, t, zoned } from "../../i18n/format";

/** The route key of a topic's thread, `topic:<id>` (see `navRoute`). */
export const topicKey = (id: string) => `topic:${id}`;
export const parseTopicKey = (key: string): string | null => (key.startsWith("topic:") ? key.slice(6) || null : null);

/** Topics whose name (or an alias the core merged in) contains the words, case-insensitively; no words keeps all. */
export function filterTopics(topics: TopicRow[], words: string): TopicRow[] {
  const q = words.trim().toLowerCase();
  return q ? topics.filter((x) => [x.name, ...x.aliases].some((n) => n.toLowerCase().includes(q))) : topics;
}

/** The list's rows with the records the core changed since the read (higher `rev` wins) and without the ones it removed. */
export function mergeTopics(read: TopicRow[], held: Record<string, TopicRow>, gone: ReadonlySet<string>): TopicRow[] {
  return read.filter((x) => !gone.has(x.id)).map((x) => (held[x.id] && held[x.id]!.rev > x.rev ? held[x.id]! : x));
}

export interface ThreadMonth {
  label: string;
  entries: Array<{ call: CallRef; item: ItemView }>;
}

/** The thread's entries in date order, newest call first, under their month. */
export function monthsOf(groups: TopicThreadGroup[], prefs?: UiPrefs): ThreadMonth[] {
  const months: ThreadMonth[] = [];
  for (const g of [...groups].sort((a, b) => b.call.started_at - a.call.started_at)) {
    const label = zoned(g.call.started_at, { month: "long", year: "numeric" }, prefs, locale());
    if (months.at(-1)?.label !== label) months.push({ label, entries: [] });
    months.at(-1)!.entries.push(...[...g.items].sort((a, b) => (a.spans[0]?.t0_ms ?? 0) - (b.spans[0]?.t0_ms ?? 0)).map((item) => ({ call: g.call, item })));
  }
  return months;
}

/** "3 calls · 2 decisions · 1 open question · since 2 Sep" */
export function threadSubtitle(topic: TopicRow, since: number | null, prefs?: UiPrefs): string {
  const parts = [
    t("topics.calls", { count: topic.calls }),
    t("topics.decisions", { count: topic.decisions }),
    t("topics.open", { count: topic.open_questions }),
  ];
  if (since !== null) parts.push(t("topics.since", { date: shortDay(since, prefs) }));
  return parts.join(" · ");
}

/** A topic's counts for its chip: "6 calls · 3 decisions · 1 open question". */
export const topicCounts = (x: TopicRow): string => [t("topics.calls", { count: x.calls }), t("topics.decisions", { count: x.decisions }), t("topics.open", { count: x.open_questions })].join(" · ");

/** The Last discussed cell: a short day, or a dash for a topic never seen. */
export const lastSeen = (ms: number, prefs?: UiPrefs): string => (ms > 0 ? shortDay(ms, prefs) : "—");

/** The topic (other than `self`) that already has this name, ignoring case and surrounding blanks: the NAME_CLASH pre-check. */
export const clashOf = (topics: TopicRow[], self: string, name: string): TopicRow | null =>
  topics.find((x) => x.id !== self && x.name.trim().toLowerCase() === name.trim().toLowerCase()) ?? null;

/** What a merge moves, entry by entry in thread order, and from how many calls. */
export const movesOf = (groups: TopicThreadGroup[]) => ({
  rows: groups.flatMap((g) => g.items),
  calls: groups.filter((g) => g.items.length).length,
});

