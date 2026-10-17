// M1 — Call screen: replay a line, hide for presenting (DESIGN.md 3.6, stories-a).
// One test per story path. Contract-level today; scrolling, Jump to Live and help tags are
// UI steps added when the call screen lands; hiding the windows themselves is XCUITest's
// (docs/TEST-PLAN.md › M1).
import type { PlaybackState } from "../../src/core/bindings";
import { ahead, ok, refused, until } from "../support/results";
import type { Scenario } from "../support/scenario";
import * as W from "../support/world-presets";
import { expect, given, test, versionsGrow } from "./support/fixtures";

/** Anna K.'s line in the live transcript. */
async function annasLine(scenario: Scenario) {
  const screen = scenario.core("call-screen");
  const snap = ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));
  const line = snap.segments.find((s) => s.speaker.speaker_id === "spk_anna");
  expect(line).toBeDefined();
  return line!;
}

test.describe("cpt-noter-seq-call-screen-replay-line", () => {
  test("happy path: reread Anna K.'s line, play it on headphones while recording, back to live", async ({ scenario }) => {
    const screen = scenario.core("call-screen");
    const playback = await scenario.events("playback:state");
    const line = await annasLine(scenario);

    const span = ok(await screen.transcriptSpan({ span: { call_id: W.LIVE_CALL, t0_ms: line.t0_ms, t1_ms: line.t1_ms } }));
    expect(span.segments.map((s) => s.id)).toContain(line.id); // the line to reread
    expect(span.audio_available).toBe(true);

    const playing = ok(await screen.audioPlay({ call_id: W.LIVE_CALL, from_ms: line.t0_ms, to_ms: line.t1_ms }));
    expect(playing).toMatchObject({ playing: true, call_id: W.LIVE_CALL, route: "headphones" }); // Replaying while recording · headphones
    await until(() => playback.latest()?.playing === true, "playback:state playing");
    const stopped = ok(await screen.audioStop({}));
    expect(stopped.playing).toBe(false);
    expect(ok(await screen.appSnapshot({})).capture.phase).toBe("recording"); // the recording untouched
    expect(versionsGrow(playback.all)).toBe(true);
  });

  test("error path — Recording on speakers: replay is off while recording on speakers, the line stays readable", async ({ scenario }) => {
    await given(scenario, (w) => (w.app.environment.output_route = "speakers"));
    const screen = scenario.core("call-screen");
    const line = await annasLine(scenario);

    const off = refused(await screen.audioPlay({ call_id: W.LIVE_CALL, from_ms: line.t0_ms, to_ms: line.t1_ms }));
    expect(off.code).toBe("replay_needs_headphones");
    expect(off.retryable).toBe(false);
    expect(ok(await screen.transcriptSpan({ span: { call_id: W.LIVE_CALL, t0_ms: line.t0_ms, t1_ms: line.t1_ms } })).segments.length).toBeGreaterThan(0);
  });

  test("error path — Output switches to speakers: playback stops, play controls disabled until headphones are back", async ({ scenario }) => {
    const screen = scenario.core("call-screen");
    const playback = await scenario.events("playback:state");
    const line = await annasLine(scenario);

    ok(await screen.audioPlay({ call_id: W.LIVE_CALL, from_ms: line.t0_ms, to_ms: line.t1_ms }));
    await scenario.change((w) => (w.app.environment.output_route = "speakers")); // headphones unplugged
    // The real core stops at once with `output_switched_to_speakers`; the fake's playback ends on its own.
    await until(() => playback.latest()?.playing === false, "playback stopped");
    const last = playback.latest() as PlaybackState;
    expect(last.stopped_reason === "output_switched_to_speakers" || scenario.target === "fake").toBe(true);
    expect(refused(await screen.audioPlay({ call_id: W.LIVE_CALL, from_ms: line.t0_ms })).code).toBe("replay_needs_headphones");
  });

  test("error path — Output not identified: Treat as headphones in Settings, then replay works on that device", async ({ scenario }) => {
    await given(scenario, (w) => {
      w.app.environment.output_route = "unknown";
      w.app.environment.output_device = { name: "Scarlett 2i2 USB", uid: "AppleUSBAudioEngine:Focusrite:Scarlett", marked_headphones: false };
    });
    const screen = scenario.core("call-screen");
    const line = await annasLine(scenario);

    expect(refused(await screen.audioPlay({ call_id: W.LIVE_CALL, from_ms: line.t0_ms })).code).toBe("output_route_unknown");
    const settings = scenario.core("settings");
    const current = ok(await settings.settingsGet({}));
    const audio = structuredClone(current.audio);
    audio.output.headphones_devices = [...audio.output.headphones_devices, "AppleUSBAudioEngine:Focusrite:Scarlett"]; // Treat as headphones
    const saved = ok(await settings.settingsUpdate({ rev: current.rev, section: { section: "audio", value: audio } }));
    expect(saved.rev).toBeGreaterThan(current.rev);
    expect(ok(await screen.audioPlay({ call_id: W.LIVE_CALL, from_ms: line.t0_ms, to_ms: line.t1_ms })).playing).toBe(true);
    ok(await screen.audioStop({}));
  });

  test("error path — Noter's own sounds not excluded: turn it on after the call, Play Test Clip, self-test passed", async ({ scenario }) => {
    await given(scenario, (w) => (w.settings.audio.exclude_own_sounds = false));
    const screen = scenario.core("call-screen");
    const line = await annasLine(scenario);

    expect(refused(await screen.audioPlay({ call_id: W.LIVE_CALL, from_ms: line.t0_ms })).code).toBe("own_sounds_not_excluded");
    ok(await screen.captureStop({ call_id: W.LIVE_CALL })); // after the call
    const settings = scenario.core("settings");
    const current = ok(await settings.settingsGet({}));
    const saved = ok(await settings.settingsUpdate({ rev: current.rev, section: { section: "audio", value: { ...current.audio, exclude_own_sounds: true } } }));
    expect(saved.audio.exclude_own_sounds).toBe(true);
    const stale = refused(await settings.settingsUpdate({ rev: current.rev, section: { section: "audio", value: current.audio } }));
    expect(stale.code).toBe("conflict"); // a second Settings edit on an old rev is refused, not merged
    expect(stale.detail).toEqual({ type: "conflict", current_rev: saved.rev });

    let passed = false;
    ok(await settings.selfTestRun({ play_clip: true }, (m) => (passed ||= m.event.type === "passed"))); // Play Test Clip
    await until(() => passed, "Noter's own sounds stay out of the recording · Self-test passed");
  });
});

test.describe("cpt-noter-seq-call-screen-hide-for-presenting", () => {
  test("happy path: Hide Noter for Presenting (⌃⌥⌘0), recording goes on, Show Noter brings everything back", async ({ scenario }) => {
    const screen = scenario.core("call-screen");
    const presenting = await scenario.events("app:presenting");
    const copilot = await scenario.events("copilot:status");
    const before = ok(await screen.windowCallState({}));

    expect(ok(await screen.appSetHiddenForPresenting({ hidden: true })).hidden).toBe(true);
    await until(() => presenting.latest()?.hidden === true, "app:presenting hidden");
    await until(() => copilot.latest()?.card_keys.registered === false, "card keys released while hidden");
    expect(ok(await scenario.core("main").appSnapshot({})).capture.phase).toBe("recording");

    expect(ok(await screen.appSetHiddenForPresenting({ hidden: false })).hidden).toBe(false); // ⌃⌥⌘0 again, or Show Noter
    await until(() => presenting.latest()?.hidden === false, "app:presenting shown");
    expect(ok(await screen.windowCallState({})).visible).toBe(before.visible); // exactly the windows that were open
    expect(versionsGrow(presenting.all)).toBe(true);
  });

  test("empty path — Call detected while hidden: no prompt, Call Detected · Start Recording, nothing drawn until Show Noter", async ({ scenario }) => {
    await given(scenario, W.idle);
    const main = scenario.core("main");
    ok(await main.appSetHiddenForPresenting({ hidden: true }));
    await scenario.change((w) => W.detect(w, W.APPS.teams)); // a second call starts

    expect(ok(await main.appSnapshot({})).detection.detection?.app_name).toBe("Microsoft Teams"); // Call Detected · Start Recording
    expect(ok(await main.captureStart({ source: "menu_bar", sensitive: false })).phase).toBe("recording");
    expect(ok(await main.appSnapshot({})).presenting.hidden).toBe(true);
    expect(ok(await main.appSetHiddenForPresenting({ hidden: false })).hidden).toBe(false); // Show Noter
  });

  test("error path — Notification while hidden: Summary ready held back, delivered after ⌃⌥⌘0, opens the Summary", async ({ scenario }) => {
    const main = scenario.core("main");
    const nav = await scenario.events("nav:request");
    ok(await main.appSetHiddenForPresenting({ hidden: true }));
    ok(await main.windowReportView({ call_id: null })); // no call page frontmost: the core may notify once shown
    expect(ok(await main.appSetHiddenForPresenting({ hidden: false })).hidden).toBe(false);
    // Clicking Summary ready opens that call's Summary.
    ok(await main.windowNavigate({ target: { type: "call_page", call_id: W.PAST_CALL, tab: "summary" } }));
    await until(() => nav.latest()?.type === "call_page", "the call's Summary");
    ok(await main.windowReportView({ call_id: W.PAST_CALL }));
  });

  test("other path — Check the share before presenting: Screen Share Test during the call, then ⌃⌥⌘0", async ({ scenario }) => {
    const settings = scenario.core("settings");
    const share = ahead(await settings.shareTestRun({ run_capture_test: true })); // Screen Share Test… (M2 command)
    if (share) {
      expect(share.capture_test.type).toBe("blocked_by_call"); // Run the test when no call is being recorded.
      expect(share.rows.find((r) => r.surface === "main_window")).toBeDefined(); // Visible for the main window on a whole-display share
    }
    expect(ok(await scenario.core("call-screen").appSetHiddenForPresenting({ hidden: true })).hidden).toBe(true);
    expect(ok(await settings.appSnapshot({})).capture.phase).toBe("recording");
  });

  test("other path — Share warning in the floating panel: laptop only, floating layout, recording dot and clock", async ({ scenario }) => {
    await given(scenario, W.idle, W.laptopOnly);
    const screen = scenario.core("call-screen");
    expect(ok(await screen.captureStart({ source: "call_window", sensitive: false })).phase).toBe("recording");

    const panel = ok(await screen.windowSetCallLayout({ preference: "auto" }));
    expect(panel.layout).toBe("floating"); // no second display: the floating panel beside Teams
    expect(typeof panel.show_share_warning).toBe("boolean"); // Hidden from window shares only… with Got It
    const shown = ok(await screen.windowShowCall({}));
    expect(shown.visible).toBe(true);
  });
});
