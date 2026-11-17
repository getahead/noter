import { describe, expect, it } from "vitest";
import type { TopicRow, TopicThreadGroup } from "../../core/bindings";
import { filterTopics, lastSeen, mergeTopics, monthsOf, parseTopicKey, threadSubtitle, topicKey } from "./topics-model";

const topic = (id: string, name: string, o: Partial<TopicRow> = {}): TopicRow => ({ id, rev: 1, name, aliases: [], calls: 2, decisions: 1, open_items: 0, last_seen: 0, merge_suggestion: null, ...o });
const group = (id: string, at: number): TopicThreadGroup => ({ call: { id, title: id, started_at: at, call_type: "planning" }, items: [{ id: `i-${id}` } as never] });

describe("topics model (cpt-noter-state-ui-library-search-topics-view)", () => {
  it("the route key round-trips and rejects other keys", () => {
    expect(parseTopicKey(topicKey("top_1"))).toBe("top_1");
    expect(parseTopicKey("root")).toBeNull();
    expect(parseTopicKey("topic:")).toBeNull();
  });
  it("filters by name or alias, ignoring case and blanks", () => {
    const all = [topic("a", "Websocket notifications"), topic("b", "Billing", { aliases: ["Invoices"] })];
    expect(filterTopics(all, "  ")).toBe(all);
    expect(filterTopics(all, "WEBSOCKET").map((x) => x.id)).toEqual(["a"]);
    expect(filterTopics(all, "invoice").map((x) => x.id)).toEqual(["b"]);
    expect(filterTopics(all, "zzz")).toEqual([]);
  });
  it("merges the store's newer records and drops removed topics", () => {
    const read = [topic("a", "A"), topic("b", "B"), topic("c", "C")];
    const out = mergeTopics(read, { a: topic("a", "A2", { rev: 2 }), b: topic("b", "stale", { rev: 1 }) }, new Set(["c"]));
    expect(out.map((x) => x.name)).toEqual(["A2", "B"]);
  });
  it("groups entries by month, newest call first", () => {
    const m = monthsOf([group("old", Date.UTC(2026, 8, 3, 12)), group("new", Date.UTC(2026, 9, 20, 12)), group("mid", Date.UTC(2026, 9, 5, 12))], { time_zone: "UTC" } as never);
    expect(m.map((x) => x.entries.map((e) => e.call.id))).toEqual([["new", "mid"], ["old"]]);
  });
  it("words the subtitle with the counts and the first call's day", () => {
    const s = threadSubtitle(topic("a", "A", { calls: 3, decisions: 1, open_items: 2 }), Date.UTC(2026, 8, 2, 12), { time_zone: "UTC" } as never);
    expect(s).toBe("3 calls · 1 decision · 2 open questions · since Sep 2");
    expect(threadSubtitle(topic("a", "A", { calls: 1 }), null)).not.toContain("since");
  });
  it("shows a dash for a topic never seen", () => {
    expect(lastSeen(0)).toBe("—");
    expect(lastSeen(Date.UTC(2026, 8, 2, 12), { time_zone: "UTC" } as never)).toBe("Sep 2");
  });
});
