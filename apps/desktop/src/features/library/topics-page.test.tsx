import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import type { TopicRow } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { DialogsProvider } from "../../ui/dialogs/host";
import { ThreadView, ThreadPage } from "./ThreadPage";
import { TopicLine, TopicsBody, TopicsPage } from "./TopicsPage";
import { ThreadToolbar, TopicsToolbar } from "./TopicsToolbar";
import { slots } from "../call-page/slots";
import { closeOnPointer, topicMenu } from "./TopicsPage";
import { navigateEffect } from "../shell/navigate";
import { askTopicRoute } from "./topic-nav";
import { ThreadRow } from "./ThreadRow";
import { setHead } from "./topics-head";
import { monthsOf } from "./topics-model";
import { setTopicWords, topicWords } from "./topics-query";
import { openTopic } from "./topic-nav";
import { claim, useRead } from "./use-read";
import { registerTopicSheets } from "./ThreadPage";
import "./register-topics";
import { pageFor } from "../shell/pages";

let bridge: Bridge;
afterEach(() => (setTopicWords(""), bridge?.close()));
async function ready() {
  const fake = new FakeCore({ window: "main" });
  bridge = createBridge("main", fake);
  await bridge.open();
  return fake;
}
const row = (o: Partial<TopicRow> = {}): TopicRow => ({ id: "t1", rev: 1, name: "Websocket notifications", aliases: [], calls: 3, decisions: 2, open_items: 1, open_questions: 1, last_seen: Date.UTC(2026, 9, 5, 12), merge_suggestion: null, ...o });
const body = (o: Partial<Parameters<typeof TopicsBody>[0]> = {}) => {
  const topics = [row(), row({ id: "t2", name: "Notification service", merge_suggestion: { id: "t1", name: "Websocket notifications" } })];
  return renderToString(<TopicsBody bridge={bridge} status="READY" retry={() => {}} topics={topics} shown={topics} names={new Map(topics.map((x) => [x.id, x.name]))} words="" {...o} />);
};

describe("Topics page (cpt-noter-flow-ui-library-search-topics-topic)", () => {
  it("lists the topics with counts, a merge glyph for a suggestion, and one Tab stop", async () => {
    await ready();
    const h = body();
    expect(h).toContain("Websocket notifications");
    expect(h).toContain('data-state="merge-suggested"');
    expect(h).toContain("Merge suggested");
    expect(h.match(/tabindex="0"/g)).toHaveLength(1);
  });
  it("names the three empty states and the failure", async () => {
    await ready();
    expect(body({ topics: [], shown: [] })).toContain("No topics yet");
    expect(body({ shown: [], words: "zzz" })).toContain("No topics match “zzz”");
    expect(body({ status: "ERROR" })).toContain("Couldn’t read your topics");
    expect(body({ status: "LOADING" })).toContain('aria-busy="true"');
  });
  it("Return and › open the thread, Clear Search restores the list", async () => {
    await ready();
    const act = vi.spyOn(bridge, "act");
    const tr = rendered(TopicLine, { bridge, topic: row(), stop: true, merge: null, last: "Oct 5" });
    const prevent = vi.fn();
    (tr.props.onKeyDown as (e: unknown) => void)({ key: "Enter", metaKey: false, preventDefault: prevent });
    (tr.props.onKeyDown as (e: unknown) => void)({ key: "a", metaKey: false, preventDefault: prevent });
    (tr.props.onClick as () => void)();
    expect(act).toHaveBeenCalledTimes(2);
    expect(prevent).toHaveBeenCalledTimes(1);
    setTopicWords("zz");
    const none = rendered(TopicsBody as never, { bridge, status: "READY", retry: () => {}, topics: [row()], shown: [], names: new Map(), words: "zz" });
    (find(none, (p) => p.actionLabel === "Clear Search").props.onAction as () => void)();
    expect(topicWords()).toBe("");
  });
  it("the page reads the core's topics and the toolbar writes the search words", async () => {
    await ready();
    expect(renderToString(<TopicsPage bridge={bridge} />)).toContain('aria-busy="true"');
    const bar = rendered(TopicsToolbar as never, { base: {}, route: {}, bridge } as never);
    (find(bar, (p) => "trailing" in p).props.trailing as { props: { onChange: (v: string) => void } }).props.onChange("web");
    expect(topicWords()).toBe("web");
  });
  it("registers the root page and the thread route in the Topics section", () => {
    expect(pageFor("topics", { section: "topics", key: "root" }).toolbar).toBe(TopicsToolbar);
    const thread = pageFor("topics", { section: "topics", key: "topic:t1" });
    expect(thread.title({ section: "topics", key: "topic:t1" })).toBe("Topics");
  });
  it("openTopic asks the core to navigate to the topic", async () => {
    await ready();
    const act = vi.spyOn(bridge, "act");
    openTopic(bridge, "t1");
    expect(act).toHaveBeenCalledWith("window_navigate", "window_navigate", expect.any(Function), expect.anything());
  });
  it("a thread row is reachable with Tab and hands Return and ⌘I to the item keys", async () => {
    const fake = await ready();
    const item = fake.world.items.find((i) => i.topic)!;
    const keys = vi.fn();
    slots.itemKeys = keys;
    const row = find(rendered(ThreadRow, { bridge, item, call: item.call }), (p) => p.className === "pc-item lb-throw" || (typeof p.className === "string" && p.className.includes("lb-throw")));
    expect(row.props.tabIndex).toBe(0);
    const e = { key: "Enter" };
    (row.props.onKeyDown as (e: unknown) => void)(e);
    expect(keys).toHaveBeenCalledWith(bridge, item, e);
    slots.itemKeys = null;
  });
});

describe("Topic thread (cpt-noter-state-ui-library-search-topics-view)", () => {
  const data = (groups: never[] = []) => ({ topic: row(), groups });
  const view = (o: Partial<Parameters<typeof ThreadView>[0]> = {}) =>
    renderToString(<ThreadView bridge={bridge} status="READY" retry={() => {}} data={data()} months={[]} {...o} />);
  it("shows THREAD_EMPTY when no entry survives, an error with Try Again, and loading", async () => {
    await ready();
    expect(view()).toContain("Nothing left in this topic");
    expect(view({ status: "ERROR", data: null })).toContain("Couldn’t read this topic");
    expect(view({ status: "LOADING", data: null })).toContain('aria-busy="true"');
  });
  it("draws the title, counts and the month groups of a real topic", async () => {
    const fake = await ready();
    const t = fake.world.topics[0]!;
    const r = await bridge.core.topicGet({ topic_id: t.id });
    if (r.status !== "ok") throw new Error("topic_get");
    const months = monthsOf(r.data.groups);
    const h = view({ data: r.data, months });
    expect(h).toContain(t.name);
    expect(h).toContain('data-state="thread"');
    expect(h).toContain("lb-thmonth");
    expect(renderToString(<DialogsProvider><ThreadPage bridge={bridge} topicId={t.id} /></DialogsProvider>)).toContain('aria-busy="true"');
  });
});

describe("useRead", () => {
  it("starts LOADING under server render", async () => {
    await ready();
    let s = "";
    const Probe = () => ((s = useRead(() => new Promise(() => {}), "k")[0].status), null);
    renderToString(<Probe />);
    expect(s).toBe("LOADING");
  });
});

describe("toolbars and thread rows", () => {
  it("the toolbars show the published head, and the thread's Ask About This Thread asks about its topic", async () => {
    await ready();
    setHead({ title: "Drawer redesign", subtitle: "3 calls" });
    const bar = rendered(ThreadToolbar as never, { base: {}, route: { section: "topics", key: "topic:top_ws" }, bridge } as never);
    expect(bar.props.title).toBe("Drawer redesign");
    expect(bar.props.subtitle).toBe("3 calls");
    const askOf = (b: ReturnType<typeof rendered>) => (find(b, (p) => "trailing" in p).props.trailing as { props: { children: [{ props: { label: string; disabled: boolean; onAction: () => void } }] } }).props.children[0].props;
    const ask = askOf(bar);
    expect(ask.label).toBe("Ask About This Thread");
    expect(ask.disabled).toBe(false);
    const moves: unknown[] = [];
    const stop = navigateEffect((e) => moves.push(e));
    ask.onAction();
    stop();
    expect(moves).toEqual([{ type: "move", move: { type: "push", route: { section: "ask", key: "new-topic:top_ws" } } }]);
    expect(askTopicRoute("top_x")).toEqual({ section: "ask", key: "new-topic:top_x" });
    expect(askOf(rendered(ThreadToolbar as never, { base: {}, route: { section: "topics", key: "root" }, bridge } as never)).disabled).toBe(true);
    expect(rendered(TopicsToolbar as never, { base: {}, route: {}, bridge } as never).props.subtitle).toBe("3 calls");
    setHead({ title: null, subtitle: null });
  });
  it("a thread row names its kind, the call with its date, and no topic chip", async () => {
    const fake = await ready();
    const item = fake.world.items.find((i) => i.topic)!;
    const h = renderToString(<ThreadRow bridge={bridge} item={item} call={item.call} />);
    expect(h).toContain("data-variant=\"thread\"");
    expect(h).toContain(item.call.title);
    expect(h).not.toContain(`>${item.topic!.name}<`);
    const act = vi.spyOn(bridge, "act");
    const tree = rendered(ThreadRow, { bridge, item, call: item.call });
    (find(tree, (p) => typeof p.label === "string" && p.label.includes(item.call.title)).props.onAction as () => void)();
    expect(act).toHaveBeenCalledWith("window_navigate", "window_navigate", expect.any(Function), expect.anything());
  });
});

describe("the Topics row context menu", () => {
  it("offers Open, Rename… and Merge With…, each closing the menu before it acts", () => {
    const [open, rename, merge, close] = [vi.fn(), vi.fn(), vi.fn(), vi.fn()];
    const items = topicMenu(open, { rename, merge }, close);
    expect(items.map((i) => i.label)).toEqual(["Open", "Rename…", "Merge With…"]);
    items.forEach((i) => i.onSelect());
    expect([open, rename, merge].every((f) => f.mock.calls.length === 1)).toBe(true);
    expect(close).toHaveBeenCalledTimes(3);
  });
});

describe("small page helpers", () => {
  it("closeOnPointer listens until stopped", () => {
    const [add, remove, close] = [vi.fn(), vi.fn(), vi.fn()];
    vi.stubGlobal("document", { addEventListener: add, removeEventListener: remove });
    const stop = closeOnPointer(close);
    expect(add).toHaveBeenCalledWith("pointerdown", close);
    stop();
    expect(remove).toHaveBeenCalledWith("pointerdown", close);
    vi.unstubAllGlobals();
  });
  it("registers the Rename and Merge sheets, and claims a read key once", () => {
    const register = vi.fn();
    registerTopicSheets({ register } as never);
    expect(register.mock.calls.map((c) => c[0])).toEqual(["topic-rename", "topic-merge"]);
    const ref = { current: null as string | null };
    expect([claim(ref, "a"), claim(ref, "a"), claim(ref, "b")]).toEqual([true, false, true]);
  });
  // #1045: the › button sits inside the clickable row; its click must not also reach the row (two pushes, two Backs)
  it("the › button opens the topic once: its cell keeps the click from the row", () => {
    const tr = rendered(TopicLine, { bridge: {} as never, topic: { id: "t", name: "T" } as never, stop: true, merge: null, last: "—" });
    const cell = find(tr, (p, type) => type === "td" && JSON.stringify(Object.keys(p)).includes("onClick"));
    const stop = vi.fn();
    (cell.props.onClick as (e: unknown) => void)({ stopPropagation: stop });
    expect(stop).toHaveBeenCalled();
  });
  it("a Topics row opens its menu from the keyboard (Menu key, ⇧F10) at the row, and from the mouse where it was clicked", () => {
    const onContext = vi.fn();
    const row = find(rendered(TopicLine, { bridge: {} as never, topic: { id: "t", name: "T" } as never, stop: true, merge: null, last: "—", onContext }), (p) => typeof p.onKeyDown === "function");
    const e = (key: string, shiftKey = false) => ({ key, shiftKey, preventDefault: vi.fn(), currentTarget: { getBoundingClientRect: () => ({ left: 10, bottom: 50 }) } });
    (row.props.onKeyDown as (e: unknown) => void)(e("ContextMenu"));
    expect(onContext).toHaveBeenLastCalledWith({ x: 34, y: 50 });
    (row.props.onKeyDown as (e: unknown) => void)(e("F10", true));
    expect(onContext).toHaveBeenCalledTimes(2);
    (row.props.onKeyDown as (e: unknown) => void)(e("F10"));
    expect(onContext).toHaveBeenCalledTimes(2);
    (row.props.onContextMenu as (e: unknown) => void)({ clientX: 5, clientY: 6, preventDefault: vi.fn() });
    expect(onContext).toHaveBeenLastCalledWith({ x: 5, y: 6 });
  });
});
