import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeCore } from "./fake-core";
import { createCore, type AskMsg, type CaptureState, type ItemView, type LevelsMsg, type TranscriptMsg } from "../bindings";

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
  // #1162, #1163: as the core does, Show latency and Text size reach the call window through window:call.
  it("puts Show latency and Text size into the call window state and republishes it", async () => {
    const fake = core("settings");
    const heard: { show_latency?: boolean; text_size_pct?: number }[] = [];
    await fake.listen("window:call", (payload) => void heard.push(payload as never));
    const { call_screen, rev } = fake.world.settings;
    await fake.invoke("settings_update", { rev, section: { section: "call_screen", value: { ...call_screen, show_latency: true, text_size_pct: 120 } } });
    expect(heard.at(-1)).toMatchObject({ show_latency: true, text_size_pct: 120 });
  });

  it("does not carry handoff edits into a fresh core with a fresh world", async () => {
    const first = core("main");
    await first.invoke("handoff_edit", { item_id: "itm_replay", rev: 1, prompt_md: "private edit" });

    const second = core("main");
    const handoff = await second.invoke("handoff_get", { item_id: "itm_replay" }) as { rev: number; edited: boolean; prompt_md: string };

    expect(handoff).toMatchObject({ rev: 1, edited: false });
    expect(handoff.prompt_md).not.toContain("private edit");
  });

  it("rebinds handler state when a core replaces its world", async () => {
    const first = core("main");
    await first.invoke("handoff_edit", { item_id: "itm_replay", rev: 1, prompt_md: "old world edit" });
    const fresh = core("main");

    first.setWorld(fresh.world);
    const handoff = await first.invoke("handoff_get", { item_id: "itm_replay" }) as { edited: boolean; prompt_md: string };
    expect(handoff).toMatchObject({ edited: false });
    expect(handoff.prompt_md).not.toContain("old world edit");
  });

  it("partially redoes speaker naming without replacing output text edited after undo", async () => {
    const fake = core("main");
    const api = createCore(fake);
    const call = await api.callGet({ call_id: "call_backend" });
    expect(call.status).toBe("ok");
    if (call.status !== "ok") return;
    const speaker = call.data.speakers.find((item) => item.label.type === "person");
    expect(speaker).toBeDefined();
    if (!speaker) return;
    const output = await api.outputsGet({ call_id: "call_backend" });
    expect(output.status).toBe("ok");
    if (output.status !== "ok") return;
    const summary = output.data.sections.find((item) => item.kind === "summary");
    expect(summary).toBeDefined();
    if (!summary?.rev || !summary.summary_id) return;
    const summaryId = summary.summary_id;

    expect((await api.outputEdit({ call_id: "call_backend", summary_id: summaryId, rev: summary.rev, body_md: `${speaker.label.type === "person" ? speaker.label.person.display_name : ""} owns this.` })).status).toBe("ok");
    const named = await api.transcriptNameSpeakers({ call_id: "call_backend", assignments: [{ speaker_id: speaker.id, person: { type: "new", display_name: "Renamed Person" } }] });
    expect(named.status).toBe("ok");
    if (named.status !== "ok") return;
    const target = { type: "change" as const, change_id: named.data.change_id };
    expect((await api.changeUndo({ target })).status).toBe("ok");
    const undoneOutput = await api.outputsGet({ call_id: "call_backend" });
    expect(undoneOutput.status).toBe("ok");
    if (undoneOutput.status !== "ok") return;
    const undoneSummary = undoneOutput.data.sections.find((item) => item.summary_id === summaryId);
    expect(undoneSummary).toBeDefined();
    if (!undoneSummary?.rev) return;
    expect((await api.outputEdit({ call_id: "call_backend", summary_id: summaryId, rev: undoneSummary.rev, body_md: "My later edit must survive." })).status).toBe("ok");

    // the naming's batch also holds the participant row it added (#1097)
    expect(await api.changeRedo({ target })).toEqual({ status: "ok", data: { undone: 3, skipped_edited_later: 2 } });
    const redoneCall = await api.callGet({ call_id: "call_backend" });
    expect(redoneCall.status).toBe("ok");
    if (redoneCall.status !== "ok") return;
    expect(redoneCall.data.speakers.find((item) => item.id === speaker.id)?.label).toMatchObject({ type: "person", person: { display_name: "Renamed Person" } });
    const finalOutput = await api.outputsGet({ call_id: "call_backend" });
    expect(finalOutput.status).toBe("ok");
    if (finalOutput.status !== "ok") return;
    expect(finalOutput.data.sections.find((item) => item.summary_id === summaryId)?.body_md).toBe("My later edit must survive.");
  });

  it("shares events only among cores for the same world and drops listeners on dispose", async () => {
    const first = core("main");
    const peer = new FakeCore({ window: "main", world: first.world });
    const unrelated = core("main");
    cores.push(peer);
    const heardByPeer = vi.fn();
    const heardByUnrelated = vi.fn();
    await peer.listen("entity:changed", heardByPeer);
    await unrelated.listen("entity:changed", heardByUnrelated);

    const event = { type: "removed", kind: "call", id: "call_fake" } as const;
    first.emit("entity:changed", event);
    expect(heardByPeer).toHaveBeenCalledTimes(1);
    expect(heardByUnrelated).not.toHaveBeenCalled();

    peer.dispose();
    first.emit("entity:changed", event);
    expect(heardByPeer).toHaveBeenCalledTimes(1);
  });

  it("clears an in-flight handoff when its owning core is disposed", async () => {
    const first = core("main");
    const world = first.world;
    const peer = new FakeCore({ window: "main", world });
    cores.push(peer);
    const started = await first.invoke("handoff_generate", { item_id: "itm_replay", regenerate: true }) as { state: { type: string } };
    expect(started.state).toEqual({ type: "generating" });

    first.dispose();
    const current = await peer.invoke("handoff_get", { item_id: "itm_replay" }) as { state: { type: string } };
    expect(current.state).toEqual({ type: "ready" });
  });

  it("cpt-noter-seq-call-screen-stop-at-call-end imports only the next invitation when splitting", async () => {
    const fake = core();
    const event = fake.world.today.today[0]!;
    event.attendees = [{ name: "hidden@example.test", person: null, email: "hidden@example.test" }];
    const current = fake.world.app.capture;
    current.notice = {
      type: "new_meeting", event: { id: event.event_id, title: event.title, starts_at: event.starts_at, ends_at: event.ends_at },
      app_name: "Zoom", detected_at: fake.world.now, expires_at: fake.world.now + 60_000, default_choice: "start_as_new_call",
    };
    const next = await fake.invoke("capture_answer_new_meeting", { call_id: current.call_id, choice: "start_as_new_call" }) as CaptureState;
    expect(fake.world.calls.find((c) => c.id === next.call_id)).toMatchObject({ participants: [], invited_guests: ["Guest"], title: event.title });
  });

  it("creates a call row and live transcript on capture start, then stops the row and transcript", async () => {
    const fake = core();
    const other = new FakeCore({ window: "main", world: fake.world });
    cores.push(other);
    fake.world.app.capture.phase = "idle";
    fake.world.app.capture.call_id = null;
    const capture = await fake.invoke("capture_start", { source: "menu_bar", sensitive: false }) as CaptureState;
    expect(fake.world.calls.find((c) => c.id === capture.call_id)?.status).toBe("recording");
    const messages: TranscriptMsg[] = [];
    await other.invoke("transcript_subscribe", { call_id: capture.call_id }, (m) => messages.push(m as TranscriptMsg));
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
    expect(messages.at(-1)?.event).toEqual({ type: "ended", reason: "discarded" });
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
    await expect(fake.invoke("hotkey_set", { action: target!.action, shortcut: owner!.shortcut! })).rejects.toMatchObject({
      code: "hotkey_conflict",
      detail: { type: "hotkey_owner", owner: owner!.action },
    });
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

  it("keeps one live script across windows while each transcript subscriber continues after its snapshot", async () => {
    vi.useFakeTimers();
    const fake = core();
    const other = new FakeCore({ window: "main", world: fake.world });
    cores.push(other);
    fake.world.live_script = ["s1", "s2", "s3"].map((id) => ({ type: "confirmed" as const, segment: { id, call_id: "call_live", channel: "mic", t0_ms: 1, t1_ms: 2, text: id } as never }));
    fake.world.script_interval_ms = 100;
    const firstMessages: TranscriptMsg[] = [];
    const secondMessages: TranscriptMsg[] = [];
    const first = await createCore(fake).transcriptSubscribe({ call_id: "call_live" }, (m) => firstMessages.push(m));
    const second = await createCore(other).transcriptSubscribe({ call_id: "call_live" }, (m) => secondMessages.push(m));
    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status !== "ok" || second.status !== "ok") return;
    expect(second.data.last_seq).toBe(first.data.last_seq + 1);
    await vi.advanceTimersByTimeAsync(300);
    expect(firstMessages.map((m) => m.seq)).toEqual([first.data.last_seq + 1, first.data.last_seq + 2, first.data.last_seq + 3]);
    expect(secondMessages.map((m) => m.seq)).toEqual([second.data.last_seq + 1, second.data.last_seq + 2]);
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

  it("prepare refuses a missing or unsupported CLI, as the real core does", async () => {
    const fake = core("settings");
    const claude = fake.world.app.accounts.accounts.find((a) => a.provider === "claude")!;
    claude.cli = { ...claude.cli, installed: false, path: null, version: null };
    await expect(fake.invoke("account_signin_prepare", { provider: "claude" })).rejects.toMatchObject({ code: "cli_missing" });
    claude.cli = { ...claude.cli, installed: true, supported: false };
    await expect(fake.invoke("account_signin_prepare", { provider: "claude" })).rejects.toMatchObject({ code: "cli_version_unsupported" });
  });

  it("installing Ollama leaves the local runtime installed and running", async () => {
    vi.useFakeTimers();
    const fake = core("settings");
    const local = fake.world.app.accounts.local;
    Object.assign(local, { running: false, cli: { ...local.cli, installed: false, path: null } });
    await fake.invoke("cli_install", { tool: "ollama" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fake.world.app.accounts.local).toMatchObject({ running: true, cli: { installed: true } });
  });

  it("a rename to a taken name is refused before the revision is looked at, as the real core does", async () => {
    const fake = core("main");
    const [a, b] = fake.world.topics;
    await expect(fake.invoke("topic_rename", { topic_id: a.id, rev: a.rev + 7, name: b.name })).rejects.toMatchObject({ code: "invalid_input", detail: { rule: "duplicate" } });
  });

  it("stopping Ask keeps the partial answer and cancels the remaining response", async () => {
    vi.useFakeTimers();
    const fake = core("main");
    const messages: AskMsg[] = [];
    const handle = await fake.invoke("ask_start", { question: "What did we agree about the websocket notifications?", scope: {} }, (m) => messages.push(m as AskMsg)) as { turn_id: string; thread_id: string };
    await vi.advanceTimersByTimeAsync(900);
    const partial = messages.flatMap((m) => m.event.type === "delta" ? [m.event.text] : []).join("");
    expect(partial.length).toBeGreaterThan(0);
    await fake.invoke("ask_stop", { turn_id: handle.turn_id });
    await vi.advanceTimersByTimeAsync(5_000);
    const thread = await fake.invoke("ask_thread_get", { thread_id: handle.thread_id }) as { turns: Array<{ answer_md: string; stopped: boolean; found: boolean }> };
    expect(thread.turns[0]).toMatchObject({ answer_md: partial, stopped: true, found: false });
    expect(thread.turns[0]?.answer_md).not.toContain("notification service");
  });

  it("an Ask question none of whose words is in scope answers not found, with no citations and no streamed text", async () => {
    vi.useFakeTimers();
    const fake = core("main");
    const messages: AskMsg[] = [];
    await fake.invoke("ask_start", { question: "Zzqx quuxplan frobnicate", scope: {} }, (m) => messages.push(m as AskMsg));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(messages.map((m) => m.event.type)).toEqual(["started", "done"]);
    expect(messages.at(-1)?.event).toMatchObject({ answer: { found: false, citations: [], answer_md: "I could not find this in your calls." } });
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
