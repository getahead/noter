import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeCore } from "./fake-core";
import type { AskMsg, CaptureState, ItemView, LevelsMsg, PlaybackState, TranscriptMsg } from "../bindings";

const cores: FakeCore[] = [];
const core = (window: "main" | "call-screen" | "settings" = "call-screen") => {
  const fake = new FakeCore({ window });
  cores.push(fake);
  return fake;
};

afterEach(() => {
  cores.splice(0).forEach((fake) => fake.dispose());
  vi.useRealTimers();
});

describe("fake core stream and record parity", () => {
  it("creates a call row and live transcript on capture start, then stops the row and transcript", async () => {
    const fake = core();
    fake.world.app.capture.phase = "idle";
    fake.world.app.capture.call_id = null;
    const capture = await fake.invoke("capture_start", { source: "menu_bar", sensitive: false }) as CaptureState;
    expect(fake.world.calls.find((c) => c.id === capture.call_id)?.status).toBe("recording");
    const messages: TranscriptMsg[] = [];
    await fake.invoke("transcript_subscribe", { call_id: capture.call_id }, (m) => messages.push(m as TranscriptMsg));
    await fake.invoke("capture_stop", { call_id: capture.call_id });
    expect(fake.world.calls.find((c) => c.id === capture.call_id)?.status).not.toBe("recording");
    expect(messages.at(-1)?.event).toEqual({ type: "ended", reason: "call_stopped" });
  });

  it("discard removes the call's transcript, detail and items and emits removed", async () => {
    const fake = core();
    fake.world.app.capture.phase = "idle";
    fake.world.app.capture.call_id = null;
    const capture = await fake.invoke("capture_start", { source: "menu_bar", sensitive: false }) as CaptureState;
    const row = fake.world.calls.find((c) => c.id === capture.call_id)!;
    const detail = structuredClone(fake.world.call_details[0]!);
    detail.call = row;
    fake.world.call_details.push(detail);
    const item = structuredClone(fake.world.items[0]!);
    item.id = "discard-item";
    item.call.id = row.id;
    fake.world.items.push(item);
    const messages: TranscriptMsg[] = [];
    const subscription = await fake.invoke("transcript_subscribe", { call_id: row.id }, (m) => messages.push(m as TranscriptMsg)) as { subscription_id: string };
    const removed = vi.spyOn(fake, "emit");
    await fake.invoke("capture_discard", { call_id: row.id });
    expect(fake.world.calls.some((c) => c.id === row.id)).toBe(false);
    expect(fake.world.transcripts.some((t) => t.call_id === row.id)).toBe(false);
    expect(fake.world.call_details.some((d) => d.call.id === row.id)).toBe(false);
    expect(fake.world.items.some((i) => i.call.id === row.id)).toBe(false);
    expect(messages.at(-1)?.event).toEqual({ type: "ended", reason: "call_deleted" });
    expect(await fake.invoke("stream_unsubscribe", { subscription_id: subscription.subscription_id })).toEqual({});
    expect(removed).toHaveBeenCalledWith("entity:changed", { type: "removed", kind: "call", id: row.id });
  });

  it("creates blank items even with an empty fixture and pins a card without copying fixture fields", async () => {
    const fake = core("call-screen");
    fake.world.items = [];
    const made = await fake.invoke("item_create", { call_id: "call_backend", kind: "risk", text: "New risk" }) as { item: ItemView };
    expect(made.item).toMatchObject({ owner: null, due: null, topic: null, spans: [], carried_from: null });
    expect(made.item.lang).toBeTruthy();
    expect(made.item).not.toHaveProperty("undefined");
    const fixture = fake.world.items[0]!;
    fake.world.items.push({ ...fixture, id: "fixture", owner: { id: "per_anna", display_name: "Anna", short_name: "Anna", initials: "A", is_you: false }, due: "2026-10-17", spans: [{ call_id: "call_backend", t0_ms: 1, t1_ms: 2, channel: null }] } as never);
    const pinned = await fake.invoke("card_pin", { card_id: "card_1" }) as { item: ItemView };
    expect(pinned.item).toMatchObject({ owner: null, due: null, topic: null, spans: [], carried_from: null });
  });

  it("reports a hotkey conflict when another action owns the shortcut", async () => {
    const fake = core("settings");
    const target = fake.world.hotkeys.bindings.find((b) => b.action === "start_stop")!;
    const owner = fake.world.hotkeys.bindings.find((b) => b.action === "open_call_screen")!;
    await expect(fake.invoke("hotkey_set", { action: target!.action, shortcut: owner!.shortcut! })).rejects.toMatchObject({ code: "hotkey_conflict" });
  });

  it("keeps levels flowing after thirty seconds and stops after unsubscribe", async () => {
    vi.useFakeTimers();
    const fake = core();
    const levels: LevelsMsg[] = [];
    const handle = await fake.invoke("levels_subscribe", {}, (m) => levels.push(m as LevelsMsg)) as { subscription_id: string };
    await vi.advanceTimersByTimeAsync(30_100);
    expect(levels.length).toBeGreaterThan(300);
    const count = levels.length;
    await fake.invoke("stream_unsubscribe", { subscription_id: handle.subscription_id });
    await vi.advanceTimersByTimeAsync(500);
    expect(levels).toHaveLength(count);
  });

  it("runs a call's live script once across direct duplicate subscriptions", async () => {
    vi.useFakeTimers();
    const fake = core();
    fake.world.live_script = ["s1", "s2", "s3"].map((id) => ({ type: "confirmed" as const, segment: { id, call_id: "call_live", channel: "mic", t0_ms: 1, t1_ms: 2, text: id } as never }));
    fake.world.script_interval_ms = 100;
    await fake.invoke("transcript_subscribe", { call_id: "call_live" }, () => {});
    await fake.invoke("transcript_subscribe", { call_id: "call_live" }, () => {});
    await vi.advanceTimersByTimeAsync(500);
    const ids = fake.world.transcripts.find((t) => t.call_id === "call_live")!.segments.map((s) => s.id);
    expect(ids.filter((id) => /^s\d$/.test(id))).toEqual(["s1", "s2", "s3"]);
  });

  it("does not let an earlier replay timer stop a replay after a seek", async () => {
    vi.useFakeTimers();
    const fake = core();
    fake.world.app.capture.phase = "idle";
    await fake.invoke("audio_play", { call_id: "call_backend", from_ms: 0 });
    await vi.advanceTimersByTimeAsync(2_500);
    await fake.invoke("audio_play", { call_id: "call_backend", from_ms: 2_500 });
    await vi.advanceTimersByTimeAsync(500);
    expect(fake.playback.playing).toBe(true);
  });

  it("stopping Ask keeps the partial answer and cancels the remaining response", async () => {
    vi.useFakeTimers();
    const fake = core("main");
    const messages: AskMsg[] = [];
    const handle = await fake.invoke("ask_start", { question: "What happened?", scope: {} }, (m) => messages.push(m as AskMsg)) as { turn_id: string; thread_id: string };
    await vi.advanceTimersByTimeAsync(900);
    const partial = messages.flatMap((m) => m.event.type === "delta" ? [m.event.text] : []).join("");
    expect(partial.length).toBeGreaterThan(0);
    await fake.invoke("ask_stop", { turn_id: handle.turn_id });
    await vi.advanceTimersByTimeAsync(5_000);
    const thread = await fake.invoke("ask_thread_get", { thread_id: handle.thread_id }) as { turns: Array<{ answer_md: string }> };
    expect(thread.turns[0]?.answer_md).toBe(partial);
    expect(thread.turns[0]?.answer_md).not.toContain("notification service");
  });
});
