// ADR-0002 behaviour rules for the commands of M0 and M1 (harness/milestones.toml), with
// valid arguments and real state changes — the existing files check every command with
// empty arguments. Each test opens its own isolated core (tests/support/scenario.ts): the fake
// today, the real core through noter-core-harness with NOTER_CORE=stdio. Successful commands
// are recorded into this worker's conformance log (tests/support/record-setup.ts).
//
// A core that answers only some milestones (the real core, milestone by milestone) answers the
// rest `not_implemented`. A step on a later command goes through `ahead()` (or `pending()` for an
// expected refusal) and the test stops there; everything before it is still asserted, and
// against the fake (which answers every command) every step runs.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_RETRYABLE, ERROR_CODES, type CaptureState, type CommandName, type CoreError, type LevelsMsg, type TranscriptMsg, type WindowLabel } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ahead, ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import * as W from "../support/world-presets";

let s: Scenario;
beforeEach(() => {
  s = openScenario({ alsoRecord: exercised });
});
afterEach(async () => {
  await s.dispose();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** True when a later milestone's command answered `not_implemented`: the test stops at that step. */
function pending<T>(res: { status: string; error?: CoreError } & T): boolean {
  return res.status === "error" && res.error?.code === "not_implemented";
}

/** `s.change`, or false while the core does not own the slice the change touches yet (`not_implemented`). */
async function changeAhead(mutate: Parameters<Scenario["change"]>[0]): Promise<boolean> {
  try {
    await s.change(mutate);
    return true;
  } catch (e) {
    if ((e as CoreError | null)?.code === "not_implemented") return false;
    throw e;
  }
}

function typed(e: CoreError, code: string): void {
  expect(e.code).toBe(code);
  expect(ERROR_CODES as readonly string[]).toContain(e.code);
  expect(typeof e.message).toBe("string");
  expect(e.retryable).toBe(DEFAULT_RETRYABLE.includes(e.code));
}

describe("window scope with valid arguments (PM-08): refused, and nothing changes", () => {
  const cases: Array<[CommandName, WindowLabel, unknown]> = [
    ["calls_delete", "record-prompt", { call_ids: [W.PAST_CALL] }],
    ["calls_delete", "call-screen", { call_ids: [W.PAST_CALL] }],
    ["capture_stop", "record-prompt", { call_id: W.LIVE_CALL }],
    ["capture_stop", "settings", { call_id: W.LIVE_CALL }],
    ["capture_mark_moment", "main", { call_id: W.LIVE_CALL }],
    ["capture_discard", "main", { call_id: W.LIVE_CALL }],
    ["capture_set_paused", "record-prompt", { call_id: W.LIVE_CALL, paused: true }],
    ["window_hide_call", "main", {}],
    ["window_set_collapsed", "main", { collapsed: true }],
    ["hotkey_set", "main", { action: "pause", shortcut: "Ctrl+Alt+Super+Y" }],
    ["settings_update", "main", { rev: 1, section: { section: "menu_bar", value: {} } }],
    ["setup_set_audio_storage", "settings", { never_store_audio: true, retention: "never_store" }],
    ["banner_dismiss", "call-screen", { banner: "update_ready" }],
    ["models_download", "main", { action: "pause" }],
    ["open_external", "record-prompt", { target: { type: "url", url: "https://example.com" } }],
  ];
  it.each(cases)("%s from %s", async (cmd, window, args) => {
    const before = ok(await s.core("main").appSnapshot({}));
    const calls = ahead(await s.core("main").callsList({ filter: {}, sort: "newest", page: {} }))?.total ?? null;
    const keys = ok(await s.core("settings").hotkeysList({}));
    const err = await (s as unknown as { core(w: WindowLabel): { [k: string]: unknown } }).core(window) && (await invokeRaw(window, cmd, args));
    expect(err?.code).toBe("window_not_allowed");
    const after = ok(await s.core("main").appSnapshot({}));
    expect(after.capture).toEqual(before.capture);
    expect(after.setup.version).toBe(before.setup.version);
    if (calls !== null) expect(ok(await s.core("main").callsList({ filter: {}, sort: "newest", page: {} })).total).toBe(calls);
    expect(ok(await s.core("settings").hotkeysList({}))).toEqual(keys);
  });

  /** Send one command from a window through the typed client's transport and return its CoreError. */
  async function invokeRaw(window: WindowLabel, cmd: CommandName, args: unknown): Promise<CoreError | null> {
    const client = s.core(window) as unknown as Record<string, (a: unknown, cb?: unknown) => Promise<{ status: string; error?: CoreError }>>;
    const method = Object.keys(client).find((k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`) === cmd);
    if (!method) throw new Error(`no client method for ${cmd}`);
    const res = await client[method](args, () => {});
    return res.status === "error" ? res.error! : null;
  }
});

describe("typed errors of M0/M1 commands: code, detail and retryable as the core sets them", () => {
  it("not_found, conflict with current_rev, and validation details", async () => {
    const main = s.core("main");
    const missing = await main.callGet({ call_id: "call_missing" });
    if (pending(missing)) return;
    typed(refused(missing), "not_found");
    const row = ok(await main.callGet({ call_id: W.PAST_CALL })).call;
    const renamed = ok(await main.callUpdate({ call_id: W.PAST_CALL, rev: row.rev, title: "Backend sync (renamed)" }));
    expect(renamed.call.rev).toBe(row.rev + 1);
    const stale = refused(await main.callUpdate({ call_id: W.PAST_CALL, rev: row.rev, title: "again" }));
    typed(stale, "conflict");
    expect(stale.detail).toEqual({ type: "conflict", current_rev: row.rev + 1 });
    const types = ok(await main.callTypesList({})).call_types;
    expect(types.length).toBeGreaterThan(0);
    const bad = refused(await main.callUpdate({ call_id: W.PAST_CALL, rev: row.rev + 1, call_type: "no_such_type" }));
    typed(bad, "invalid_input");
    expect(bad.detail?.type).toBe("validation");
    // The native-surfaces commands answer from their own feature on (M1).
    const announced = await s.core("call-screen").windowAnnounce({ text: " ", politeness: "polite" });
    if (pending(announced)) return;
    const blank = refused(announced);
    typed(blank, "invalid_input");
    expect(blank.detail).toEqual({ type: "validation", field: "text", rule: "required" });
    typed(refused(await main.openExternal({ target: { type: "url", url: "file:///etc/passwd" } })), "invalid_input");
  });

  it("capture refusals: not_recording, notice_expired, continue_window_closed, detection_expired, already_recording", async () => {
    const screen = s.core("call-screen");
    const again = await screen.captureStart({ source: "call_window", sensitive: false });
    if (pending(again)) return;
    typed(refused(again), "already_recording");
    typed(refused(await screen.captureHoldNotice({ call_id: W.LIVE_CALL, held: true })), "notice_expired");
    typed(refused(await screen.captureAnswerCallEnd({ call_id: W.LIVE_CALL, choice: "stop_now" })), "notice_expired");
    typed(refused(await screen.captureKeepRecording({ call_id: W.LIVE_CALL })), "notice_expired");
    typed(refused(await screen.captureContinue({ call_id: W.LIVE_CALL })), "continue_window_closed");
    typed(refused(await s.core("record-prompt").captureDismissDetection({ detection_id: "det_gone", reason: "closed" })), "detection_expired");
    await s.change(W.idle);
    typed(refused(await screen.captureStop({ call_id: W.LIVE_CALL })), "not_recording");
    typed(refused(await screen.captureMarkMoment({ call_id: W.LIVE_CALL })), "not_recording");
  });

  it("environment refusals: offline is retryable, a missing update is not_found (F3)", async () => {
    await s.change((w) => {
      W.firstRun(w, { modelsReady: false });
      w.app.environment.online = false;
      w.app.environment.update = null;
    });
    typed(refused(await s.core("first-run").modelsDownload({ action: "start" })), "offline");
    typed(refused(await s.core("settings").updateInstall({})), "not_found"); // F3: checked before the recording state
    await s.change((w) => (w.app.environment.update = { version: "1.0.1", notes_md: "Fixes.", ready: true }));
    ok(await s.core("settings").updateInstall({}));
  });
});

describe("O1: capture_start is never gated on setup, permissions or the self-test", () => {
  it("starts with setup incomplete, permissions missing, the self-test not run and detection off", async () => {
    await s.change((w) => {
      W.firstRun(w);
      W.permission(w, "microphone", "denied");
      W.permission(w, "system_audio", "denied");
    });
    for (const [window, source] of [["main", "today"], ["record-prompt", "hotkey"], ["call-screen", "call_window"]] as const) {
      const started = ahead(await s.core(window).captureStart({ source, sensitive: false }));
      if (!started) return;
      expect(started.phase).toBe("recording");
      ok(await s.core("call-screen").captureDiscard({ call_id: started.call_id! }));
    }
  });

  it("is refused only with disk_full (with the space needed) and model_missing", async () => {
    await s.change((w) => {
      W.firstRun(w); // setup incomplete through its steps, not a bare flag the real core derives
      w.app.environment.disk_free_mb = 300;
    });
    const refusal = await s.core("main").captureStart({ source: "hotkey", sensitive: false });
    if (pending(refusal)) return;
    const full = refused(refusal);
    typed(full, "disk_full");
    expect(full.detail).toEqual({ type: "disk_space", free_mb: 300, needed_mb: 500 });
    await s.change((w) => {
      w.app.environment.disk_free_mb = 90_000;
      W.speechModel(w).state = "downloading";
    });
    typed(refused(await s.core("main").captureStart({ source: "hotkey", sensitive: false })), "model_missing");
    await s.change((w) => (W.speechModel(w).state = "ready"));
    expect(ok(await s.core("main").captureStart({ source: "hotkey", sensitive: false })).phase).toBe("recording");
  });
});

describe("capture notices: hold, keep and resume", () => {
  it("capture_hold_notice holds the call-ended countdown and restarts it on release; holding twice is harmless", async () => {
    if (!(await changeAhead((w) => W.notice(w, { type: "call_ended", stops_at: Date.now() + 10_000 })))) return;
    for (const window of ["call-screen", "record-prompt"] as const) {
      const c = s.core(window);
      const held = ahead(await c.captureHoldNotice({ call_id: W.LIVE_CALL, held: true }));
      if (!held) return;
      expect(held.notice).toEqual({ type: "call_ended", stops_at: null });
      expect(ok(await c.captureHoldNotice({ call_id: W.LIVE_CALL, held: true })).notice).toEqual({ type: "call_ended", stops_at: null });
      const released = ok(await c.captureHoldNotice({ call_id: W.LIVE_CALL, held: false })).notice;
      expect(released?.type === "call_ended" && released.stops_at !== null && released.stops_at > Date.now()).toBe(true);
    }
    expect(ok(await s.core("call-screen").captureAnswerCallEnd({ call_id: W.LIVE_CALL, choice: "keep_recording" }))).toMatchObject({ phase: "recording", notice: null });
  });

  it("capture_keep_recording closes the nothing-heard notice and keeps the call", async () => {
    if (!(await changeAhead((w) => W.notice(w, { type: "nothing_heard", since: Date.now() - 5 * W.MIN })))) return;
    const kept = ahead(await s.core("call-screen").captureKeepRecording({ call_id: W.LIVE_CALL }));
    if (!kept) return;
    expect(kept).toMatchObject({ phase: "recording", call_id: W.LIVE_CALL, notice: null });
  });

  it("capture_resume_interrupted continues the call Noter quit during, once, and clears its banner", async () => {
    await s.change((w) => {
      W.idle(w);
      w.app.banners.banners = [{ type: "recording_interrupted_by_quit", call: { id: W.LIVE_CALL, title: W.LIVE_TITLE, started_at: w.now, call_type: "planning" } }];
    });
    const main = s.core("main");
    const resumed = ahead(await main.captureResumeInterrupted({ call_id: W.LIVE_CALL }));
    if (!resumed) return;
    expect(resumed).toMatchObject({ phase: "recording", call_id: W.LIVE_CALL, title: W.LIVE_TITLE });
    expect(ok(await main.appSnapshot({})).banners.banners).toEqual([]);
    expect(ok(await s.core("call-screen").transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {})).gaps.some((g) => g.reason === "interrupted")).toBe(true);
    typed(refused(await main.captureResumeInterrupted({ call_id: W.LIVE_CALL })), "notice_expired");
  });

  it("banner_dismiss removes the interrupted-recording banner without resuming", async () => {
    await s.change((w) => {
      W.idle(w);
      w.app.banners.banners = [{ type: "recording_interrupted_by_quit", call: { id: W.LIVE_CALL, title: W.LIVE_TITLE, started_at: w.now, call_type: "planning" } }];
    });
    const banners = ok(await s.core("main").bannerDismiss({ banner: "recording_interrupted_by_quit" }));
    expect(banners.banners).toEqual([]);
    expect(ok(await s.core("main").appSnapshot({})).capture.phase).toBe("idle");
  });

  it("capture_set_sensitive is one-way during capture", async () => {
    const screen = s.core("call-screen");
    const first = ahead(await screen.captureSetSensitive({ call_id: W.LIVE_CALL, sensitive: true }));
    if (!first) return;
    expect(first.sensitive).toBe(true);
    expect(ok(await screen.captureSetSensitive({ call_id: W.LIVE_CALL, sensitive: true })).sensitive).toBe(true);
    typed(refused(await screen.captureSetSensitive({ call_id: W.LIVE_CALL, sensitive: false })), "invalid_input");
  });
});

describe("snapshot, then stream (R23/R24)", () => {
  it("levels: seq from 1 with no gap, and nothing after stream_unsubscribe", async () => {
    const c = s.core("call-screen");
    const got: LevelsMsg[] = [];
    const sub = ahead(await c.levelsSubscribe({ call_id: W.LIVE_CALL }, (m) => got.push(m)));
    if (!sub) return;
    await until(() => got.length >= 3, "three level messages");
    got.forEach((m, i) => expect(m.seq).toBe(i + 1));
    ok(await c.streamAck({ subscription_id: sub.subscription_id, seq: got.at(-1)!.seq }));
    ok(await c.streamUnsubscribe({ subscription_id: sub.subscription_id }));
    const n = got.length;
    await sleep(400);
    expect(got.length).toBe(n);
  });

  it("transcript: a second subscriber starts from its own snapshot, both continue from last_seq + 1", async () => {
    const a: TranscriptMsg[] = [];
    const b: TranscriptMsg[] = [];
    const first = ahead(await s.core("call-screen").transcriptSubscribe({ call_id: W.LIVE_CALL }, (m) => a.push(m)));
    if (!first) return;
    const second = ok(await s.core("main").transcriptSubscribe({ call_id: W.LIVE_CALL }, (m) => b.push(m)));
    expect(first.live && second.live).toBe(true);
    await until(() => a.length >= 2 && b.length >= 2, "both streams delivering");
    a.forEach((m, i) => expect(m.seq).toBe(first.last_seq + i + 1));
    b.forEach((m, i) => expect(m.seq).toBe(second.last_seq + i + 1));
    expect(second.segments.length).toBeGreaterThanOrEqual(first.segments.length);
  });

  it("transcript of a past call: a snapshot only, no live subscription", async () => {
    const got: TranscriptMsg[] = [];
    const snap = ahead(await s.core("main").transcriptSubscribe({ call_id: W.PAST_CALL }, (m) => got.push(m)));
    if (!snap) return;
    expect(snap).toMatchObject({ live: false, subscription_id: null });
    await sleep(300);
    expect(got).toEqual([]);
  });

  it("self-test: messages in seq order ending with ended; the setup status follows", async () => {
    await s.change(W.idle);
    const got: { seq: number; event: { type: string } }[] = [];
    ok(await s.core("settings").selfTestRun({ play_clip: true }, (m) => got.push(m)));
    await until(() => got.some((m) => m.event.type === "ended"), "the self-test stream to end");
    got.forEach((m, i) => expect(m.seq).toBe(i + 1));
    expect(got.at(-1)!.event.type).toBe("ended");
    expect(ok(await s.core("settings").setupStatus({})).self_test.type).toBe("passed");
  });

  it("self-test: refused with model_missing while the speech bundle is not ready (D-21), then it runs", async () => {
    await s.change((w) => W.firstRun(w, { modelsReady: false }));
    const got: { event: { type: string } }[] = [];
    typed(refused(await s.core("settings").selfTestRun({ play_clip: false }, (m) => got.push(m))), "model_missing");
    expect(got).toEqual([]); // the Channel never opened
    expect(ok(await s.core("settings").setupStatus({})).self_test.type).toBe("not_run");
    // The model arrived and the audio permissions were granted meanwhile: the real core's self-test checks the microphone first.
    await s.change((w) => {
      w.app.setup.models.bundles.forEach((b) => Object.assign(b, { state: "ready", done_mb: b.size_mb }));
      W.permission(w, "microphone", "granted");
      W.permission(w, "system_audio", "granted");
    });
    ok(await s.core("settings").selfTestRun({ play_clip: false }, (m) => got.push(m)));
    await until(() => got.some((m) => m.event.type === "ended"), "the self-test stream to end");
    expect(ok(await s.core("settings").setupStatus({})).self_test.type).toBe("passed");
  });
});

// @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-for-groups
// @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-run-group
describe("whole-state events carry growing versions (R25)", () => {
  it("capture:state, setup:changed, settings:changed, hotkeys:changed, window:call and app:presenting only grow", async () => {
    const logs = {
      capture: await s.events("capture:state"),
      setup: await s.events("setup:changed"),
      settings: await s.events("settings:changed"),
      hotkeys: await s.events("hotkeys:changed"),
      window: await s.events("window:call"),
      presenting: await s.events("app:presenting"),
    };
    const snap = ok(await s.core("main").appSnapshot({}));
    const screen = s.core("call-screen");
    const settings = s.core("settings");
    // M1 steps run only where the core answers them; the M0 steps (hotkeys, settings, setup) always run.
    const results: CaptureState[] = [];
    const paused = ahead(await screen.captureSetPaused({ call_id: W.LIVE_CALL, paused: true }));
    if (paused) results.push(paused, ok(await screen.captureSetPaused({ call_id: W.LIVE_CALL, paused: false })));
    const collapsed = ahead(await screen.windowSetCollapsed({ collapsed: true }));
    if (collapsed) ok(await screen.windowSetCollapsed({ collapsed: false }));
    const hidden = ahead(await screen.appSetHiddenForPresenting({ hidden: true }));
    if (hidden) ok(await screen.appSetHiddenForPresenting({ hidden: false }));
    ok(await settings.hotkeySet({ action: "pause", shortcut: "Ctrl+Alt+Super+Y" }));
    ok(await settings.hotkeysReset({}));
    const current = ok(await settings.settingsGet({}));
    ok(await settings.settingsUpdate({ rev: current.rev, section: { section: "menu_bar", value: current.menu_bar } }));
    ok(await s.core("first-run").setupSetStep({ step: "assistants", state: "skipped" })); // a change: the fixture has it done

    const ran = { capture: paused !== null, setup: true, settings: true, hotkeys: true, window: collapsed !== null, presenting: hidden !== null };
    await until(
      () =>
        (!ran.capture || logs.capture.all.length >= 2) &&
        (!ran.presenting || logs.presenting.all.length >= 2) &&
        (!ran.window || logs.window.all.length >= 2) &&
        logs.setup.all.length > 0 &&
        logs.settings.all.length > 0 &&
        logs.hotkeys.all.length > 0,
      "the events",
    );
    for (const [name, log] of Object.entries(logs)) {
      if (!ran[name as keyof typeof ran]) continue;
      expect(log.all.length, name).toBeGreaterThan(0);
      log.all.forEach((p, i) => i > 0 && expect(p.version, `${name} #${i}`).toBeGreaterThan(log.all[i - 1].version));
    }
    expect(logs.setup.all[0].version).toBeGreaterThan(snap.setup.version);
    if (ran.presenting) expect(logs.presenting.all[0].version).toBeGreaterThan(snap.presenting.version);
    if (!ran.capture) return;
    expect(logs.capture.all[0].version).toBeGreaterThan(snap.capture.version);
    // A command result is the same whole state as the event it caused.
    expect(results.at(-1)!.version).toBe(logs.capture.latest()!.version);
    const later = ok(await s.core("main").appSnapshot({}));
    expect(later.capture.version).toBe(logs.capture.latest()!.version);
  });
});
// @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-run-group
// @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-for-groups

describe("M0 settings commands not covered by a story", () => {
  it("glossary: list, add, rename with rev, duplicate and unknown refused, remove", async () => {
    const settings = s.core("settings");
    const before = ok(await settings.glossaryList({})).terms.length;
    const added = ok(await settings.glossaryUpsert({ term: "Noter", variants_latin: ["noter"], variants_cyrillic: ["нотер"], spoken_forms: [], always_apply: false }));
    const term = added.terms.find((t) => t.term === "Noter")!;
    expect(added.terms.length).toBe(before + 1);
    typed(refused(await settings.glossaryUpsert({ term: "noter", variants_latin: [], variants_cyrillic: [], spoken_forms: [], always_apply: false })), "invalid_input");
    const renamed = ok(await s.core("main").glossaryUpsert({ id: term.id, rev: term.rev, term: "Noter app", variants_latin: [], variants_cyrillic: [], spoken_forms: [], always_apply: true }));
    expect(renamed.terms.find((t) => t.id === term.id)).toMatchObject({ term: "Noter app", rev: term.rev + 1 });
    typed(refused(await settings.glossaryUpsert({ id: term.id, rev: term.rev, term: "stale", variants_latin: [], variants_cyrillic: [], spoken_forms: [], always_apply: false })), "conflict");
    expect(ok(await settings.glossaryRemove({ id: term.id })).terms.length).toBe(before);
    typed(refused(await settings.glossaryRemove({ id: term.id })), "not_found");
  });

  // setup_set_call_display and hotkeys_reset change settings sections too (DESIGN-core › settings
  // table, Constraints): they bump `rev` and emit settings:changed as well as their own event.
  it("hotkeys_reset also restores the card keys: settings rev grows and settings:changed arrives", async () => {
    const settings = s.core("settings");
    const before = ok(await settings.settingsGet({}));
    const card_keys = { enabled: true, modifiers: { control: true, option: true, command: false } };
    const moved = ok(await settings.settingsUpdate({ rev: before.rev, section: { section: "copilot", value: { ...before.copilot, card_keys } } }));
    const changes = await s.events("settings:changed");
    ok(await settings.hotkeysReset({}));
    const after = ok(await settings.settingsGet({}));
    expect(after.copilot.card_keys).toEqual({ enabled: true, modifiers: { control: true, option: true, command: true } });
    expect(after.rev).toBe(moved.rev + 1);
    await until(() => changes.latest(), "settings:changed after the reset");
    expect(changes.latest()!.rev).toBe(after.rev);
  });

  it("setup_set_call_display also writes the call-screen display: settings rev grows and settings:changed arrives", async () => {
    const before = ok(await s.core("settings").settingsGet({}));
    const changes = await s.events("settings:changed");
    ok(await s.core("first-run").setupSetCallDisplay({ display_id: W.BUILTIN_DISPLAY }));
    const after = ok(await s.core("settings").settingsGet({}));
    expect(after.call_screen.display_id).toBe(W.BUILTIN_DISPLAY);
    expect(after.rev).toBe(before.rev + 1);
    await until(() => changes.latest(), "settings:changed after the display choice");
    expect(changes.latest()!.rev).toBe(after.rev);
  });

  it("log_ui accepts a UI error without transcript text", async () => {
    ok(await s.core("call-screen").logUi({ level: "error", screen: "call_screen", code: "engine_unavailable", message: "engine banner shown" }));
  });
});
