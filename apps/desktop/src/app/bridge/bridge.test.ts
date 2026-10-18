import { afterEach, describe, expect, it, vi } from "vitest";

import { ERROR_CODES, EVENTS, isDefaultRetryable, type CommandName, type Transport, type WindowLabel } from "../../core/bindings";
import { FakeCore, type FakeCoreOptions } from "../../core/fake/fake-core";
import { createBridge, type Bridge } from "./bridge";

type Call = { cmd: string; args?: unknown };

let bridge: Bridge | null = null;

/** A FakeCore behind a transport that records every call; `patch` may change a result. */
function setup(window: WindowLabel = "main", opts: Partial<FakeCoreOptions> = {}, patch?: (cmd: CommandName, result: unknown) => unknown) {
  const fake = new FakeCore({ window, ...opts });
  const calls: Call[] = [];
  const transport: Transport = {
    async invoke(cmd, args, onMessage) {
      calls.push({ cmd, args });
      const result = await fake.invoke(cmd, args, onMessage);
      return patch ? patch(cmd, result) : result;
    },
    listen(event, handler) {
      calls.push({ cmd: `listen:${event}` });
      return fake.listen(event, handler);
    },
  };
  bridge = createBridge(window, transport);
  const b = bridge;
  const count = (cmd: string) => calls.filter((c) => c.cmd === cmd).length;
  const logs = () => calls.filter((c) => c.cmd === "log_ui").map((c) => c.args);
  return { fake, b, calls, count, logs, state: () => b.store.getState() };
}

afterEach(async () => {
  await bridge?.close();
  bridge = null;
  vi.useRealTimers();
});

describe("open a window (snapshot, then stream)", () => {
  it("cpt-noter-flow-ui-core-bridge-open-window: subscribes to all 20 events before asking for the snapshot, then is READY", async () => {
    const { b, calls, fake, state } = setup();
    const opening = b.open();
    expect(state().status).toBe("LOADING");
    await opening;
    const events = Object.keys(EVENTS);
    expect(events).toHaveLength(20);
    expect(calls.slice(0, 20).map((c) => c.cmd)).toEqual(events.map((e) => `listen:${e}`));
    expect(calls[20]?.cmd).toBe("app_snapshot");
    expect(state().status).toBe("READY");
    expect(state().whole.capture).toEqual(fake.world.app.capture);
    expect(state().app?.window).toBe("main");
  });

  it("applies later events by version and drops an older one", async () => {
    const { b, fake, state } = setup();
    await b.open();
    fake.setWorld((w) => (w.app.presenting.hidden = true));
    expect(state().whole.presenting?.hidden).toBe(true);
    const v = state().whole.presenting!.version;
    fake.emit("app:presenting", { version: v - 1, hidden: false });
    expect(state().whole.presenting?.hidden).toBe(true);
  });

  it("a failed snapshot is FAILED with Try Again when retryable; Try Again loads again without subscribing twice", async () => {
    const { b, fake, count, logs, state } = setup();
    fake.failNext("app_snapshot", "internal");
    await b.open();
    expect(state().status).toBe("FAILED");
    expect(state().error).toEqual({ code: "internal", state: "section", tryAgain: true });
    expect(logs()).toEqual([{ level: "warn", screen: "main", code: "internal", message: "app_snapshot" }]);
    await b.open();
    expect(state().status).toBe("READY");
    expect(state().error).toBeNull();
    expect(count("listen:capture:state")).toBe(1);
  });

  it("refuses to start on a contract major version mismatch and logs it", async () => {
    const { b, logs, state } = setup("main", {}, (cmd, r) => (cmd === "app_snapshot" ? { ...(r as object), contract_version: "3.0" } : r));
    await b.open();
    expect(state().status).toBe("FAILED");
    expect(state().error).toEqual({ code: null, state: "section", tryAgain: false });
    expect(logs()).toEqual([{ level: "error", screen: "main", code: null, message: "app_snapshot: contract 3.0, bindings 2.0" }]);
  });

  it("shows a slow read after 300 ms", async () => {
    vi.useFakeTimers();
    const { b, state } = setup("main", { latency: 500 });
    const opening = b.open();
    await vi.advanceTimersByTimeAsync(299);
    expect(state().slow).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state().slow).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    await opening;
    expect(state().slow).toBe(false);
    expect(state().status).toBe("READY");
  });
});

describe("streams", () => {
  const segment = (id: string) => ({ id, call_id: "call_live", channel: "mic", t0_ms: 0, t1_ms: 1, text: id }) as never;

  it("cpt-noter-algo-ui-core-bridge-snapshot-then-stream: fills the slice from the snapshot, flushes every 100 ms in one update, loses and doubles nothing", async () => {
    vi.useFakeTimers();
    const { b, fake, state } = setup();
    await b.open();
    await b.subscribe("transcript_subscribe", { call_id: "call_live" });
    const snap = fake.world.transcripts.find((t) => t.call_id === "call_live")!;
    const stream = () => state().streams.transcript_subscribe!;
    expect(stream().data?.segments).toEqual(snap.segments);
    let updates = 0;
    const off = b.store.subscribe(() => updates++);
    fake.push("transcript_subscribe", { event: { type: "confirmed", segment: segment("n1") } });
    fake.push("transcript_subscribe", { event: { type: "confirmed", segment: segment("n2") } });
    expect(updates).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    off();
    expect(updates).toBe(1);
    const ids = stream().data!.segments.map((s) => s.id);
    expect(ids.slice(-2)).toEqual(["n1", "n2"]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(snap.segments.length + 2);
    // The fixture's first live event (a hypothesis) reached the page before the snapshot resolved: not lost.
    expect(stream().data!.hypotheses).toEqual([fake.world.live_script[0]!.type === "hypothesis" && fake.world.live_script[0]!.segment]);
  });

  it("a seq gap resubscribes (RESYNCING) and the slice ends equal to the core's state", async () => {
    vi.useFakeTimers();
    const { b, fake, count, state } = setup();
    await b.open();
    await b.subscribe("transcript_subscribe", { call_id: "call_live" });
    const first = fake.latestSubscription("transcript_subscribe");
    fake.push("transcript_subscribe", { seq: 999, event: { type: "confirmed", segment: segment("lost") } });
    expect(state().status).toBe("RESYNCING");
    await vi.waitFor(() => expect(state().status).toBe("READY"));
    expect(count("transcript_subscribe")).toBe(2);
    expect(count("stream_unsubscribe")).toBe(1);
    expect(fake.latestSubscription("transcript_subscribe")).not.toBe(first);
    const snap = fake.world.transcripts.find((t) => t.call_id === "call_live")!;
    expect(state().streams.transcript_subscribe?.data?.segments).toEqual(snap.segments);
    // A late message on the old subscription is ignored.
    await vi.advanceTimersByTimeAsync(100);
    expect(state().streams.transcript_subscribe?.data?.segments.some((s) => s.id === "lost")).toBe(false);
  });

  it("ended with lagged resubscribes; any other reason ends the stream", async () => {
    vi.useFakeTimers();
    const { b, fake, count, state } = setup();
    await b.open();
    await b.subscribe("transcript_subscribe", { call_id: "call_live" });
    fake.push("transcript_subscribe", { event: { type: "ended", reason: "lagged" } });
    await vi.waitFor(() => expect(count("transcript_subscribe")).toBe(2));
    await vi.waitFor(() => expect(state().status).toBe("READY"));
    fake.push("transcript_subscribe", { event: { type: "ended", reason: "call_stopped" } });
    await vi.advanceTimersByTimeAsync(100);
    expect(state().streams.transcript_subscribe?.ended).toBe("call_stopped");
    const before = count("stream_unsubscribe");
    await b.close();
    expect(count("stream_unsubscribe")).toBe(before); // the core already ended it
  });

  it("levels keep the newest message per flush", async () => {
    vi.useFakeTimers();
    const { b, state } = setup("first-run");
    await b.open();
    await b.subscribe("levels_subscribe", { call_id: null });
    await vi.advanceTimersByTimeAsync(400);
    const levels = state().streams.levels_subscribe?.data?.levels;
    expect(levels?.seq).toBeGreaterThanOrEqual(3);
  });

  it("self-test messages arrive in order and the stream ends with its reason", async () => {
    vi.useFakeTimers();
    const { b, state } = setup("first-run");
    await b.open();
    await b.subscribe("self_test_run", { play_clip: false });
    await vi.advanceTimersByTimeAsync(1800);
    const st = state().streams.self_test_run!;
    expect(st.data?.messages.map((m) => m.event.type)).toEqual(["stream_arrived", "stream_arrived", "levels", "line", "passed", "ended"]);
    expect(st.ended).toBe("call_stopped");
  });

  it("cards fill from the snapshot and follow the Channel", async () => {
    vi.useFakeTimers();
    const { b, fake, state } = setup("call-screen");
    await b.open();
    await b.subscribe("cards_subscribe", { call_id: "call_live" });
    expect(state().streams.cards_subscribe?.data?.feedback).toBeNull();
    fake.push("cards_subscribe", { event: { type: "key_feedback", key: 2, outcome: "no_card", card_id: null } });
    await vi.advanceTimersByTimeAsync(100);
    expect(state().streams.cards_subscribe?.data?.feedback?.key).toBe(2);
  });

  it("a Channel opened after the window closed is ended at once", async () => {
    vi.useFakeTimers();
    const { b, count } = setup("first-run", { latency: 50 });
    const opening = b.open();
    await vi.advanceTimersByTimeAsync(50);
    await opening;
    const subscribing = b.subscribe("levels_subscribe", { call_id: null });
    await b.close();
    await vi.advanceTimersByTimeAsync(100);
    await subscribing;
    expect(count("stream_unsubscribe")).toBe(1);
  });

  it("a failed subscribe shows the stream's mapped error", async () => {
    const { b, fake, state } = setup();
    await b.open();
    fake.failNext("transcript_subscribe", "not_found");
    await b.subscribe("transcript_subscribe", { call_id: "call_live" }, { not_found: "call-deleted" });
    expect(state().streams.transcript_subscribe?.error).toEqual({ code: "not_found", state: "call-deleted", tryAgain: false });
  });

  it("cpt-noter-flow-ui-core-bridge-close-window: unsubscribes every open Channel, stops events and drops the store", async () => {
    const { b, fake, calls, state } = setup("first-run");
    await b.open();
    await b.subscribe("levels_subscribe", { call_id: null });
    const id = fake.latestSubscription("levels_subscribe");
    fake.failNext("stream_unsubscribe", "not_found"); // already ended by the core: ignored
    await b.close();
    expect(calls.filter((c) => c.cmd === "stream_unsubscribe").map((c) => c.args)).toEqual([{ subscription_id: id }]);
    expect(state().status).toBe("CLOSED");
    expect(state().whole).toEqual({});
    fake.setWorld((w) => (w.app.presenting.hidden = !w.app.presenting.hidden));
    expect(state().whole).toEqual({});
  });

  it("unsubscribe ends one Channel and drops its slice", async () => {
    const { b, count, state } = setup("first-run");
    await b.open();
    await b.subscribe("levels_subscribe", { call_id: null });
    await b.unsubscribe("levels_subscribe");
    expect(count("stream_unsubscribe")).toBe(1);
    expect(state().streams.levels_subscribe).toBeUndefined();
    await b.unsubscribe("levels_subscribe");
    expect(count("stream_unsubscribe")).toBe(1);
  });
});

describe("act on a record (typed errors to named states, no retries)", () => {
  it("cpt-noter-flow-ui-core-bridge-act: WAITING, then DONE with the returned whole-state slice", async () => {
    const { b, fake, state } = setup();
    await b.open();
    const banner = fake.world.app.banners.banners[0]?.type ?? "update_ready";
    const acting = b.act("dismiss", "banner_dismiss", () => b.core.bannerDismiss({ banner }), { slice: "banners" });
    expect(state().commands.dismiss).toEqual({ state: "WAITING", error: null });
    const res = await acting;
    expect(res.status).toBe("ok");
    expect(state().commands.dismiss).toEqual({ state: "DONE", error: null });
    expect(state().whole.banners).toEqual(fake.world.app.banners);
  });

  it("writes the returned record into the window store", async () => {
    // The answer differs from the entity:changed event, so only the act's own write can explain it.
    const answer = (cmd: CommandName, r: unknown) =>
      cmd === "item_set_done" ? { ...(r as object), item: { ...(r as { item: object }).item, rev: 99, text: "from the answer" } } : r;
    const { b, fake, state } = setup("main", {}, answer);
    await b.open();
    const item = fake.world.items.find((i) => i.status === "open")!;
    const res = await b.act("tick", "item_set_done", () => b.core.itemSetDone({ item_id: item.id, rev: item.rev, done: true }), { entity: "item" });
    expect(res.status).toBe("ok");
    expect(state().entities.item[item.id]).toMatchObject({ id: item.id, rev: 99, text: "from the answer", status: "done" });
  });

  it.each(ERROR_CODES)("maps %s to the section-level error, Try Again only when retryable, and logs it", async (code) => {
    const { b, fake, logs, state } = setup();
    fake.failNext("banner_dismiss", code);
    await b.act("dismiss", "banner_dismiss", () => b.core.bannerDismiss({ banner: "update_ready" }));
    expect(state().commands.dismiss).toEqual({ state: "ERROR", error: { code, state: "section", tryAgain: isDefaultRetryable(code) } });
    const level = code === "window_not_allowed" || code === "invalid_input" ? "error" : "warn"; // a bug, or a state
    expect(logs()).toEqual([{ level, screen: "main", code, message: "banner_dismiss" }]);
  });

  it("a screen's named state wins and is not logged", async () => {
    const { b, fake, logs, state } = setup();
    fake.failNext("banner_dismiss", "conflict");
    await b.act("dismiss", "banner_dismiss", () => b.core.bannerDismiss({ banner: "update_ready" }), { named: { conflict: "item-changed" }, screen: "today" });
    expect(state().commands.dismiss?.error).toEqual({ code: "conflict", state: "item-changed", tryAgain: false });
    expect(logs()).toEqual([]);
  });

  it("window_not_allowed from outside the window's scope is logged", async () => {
    const { b, logs, state } = setup("settings");
    await b.act("dismiss", "banner_dismiss", () => b.core.bannerDismiss({ banner: "update_ready" }));
    expect(state().commands.dismiss?.error?.code).toBe("window_not_allowed");
    expect(logs()).toHaveLength(1);
  });

  it("retries only on the user's Try Again, and only a retryable error", async () => {
    const { b, fake, count, state } = setup();
    fake.failNext("banner_dismiss", "internal");
    await b.act("dismiss", "banner_dismiss", () => b.core.bannerDismiss({ banner: "update_ready" }));
    expect(count("banner_dismiss")).toBe(1); // never retried by itself
    await b.retry("dismiss");
    expect(count("banner_dismiss")).toBe(2);
    expect(state().commands.dismiss?.state).toBe("DONE");
    await b.retry("dismiss"); // nothing to retry after DONE
    fake.failNext("banner_dismiss", "not_found");
    await b.act("dismiss", "banner_dismiss", () => b.core.bannerDismiss({ banner: "update_ready" }));
    await b.retry("dismiss"); // not retryable
    await b.retry("unknown");
    expect(count("banner_dismiss")).toBe(3);
  });
});
