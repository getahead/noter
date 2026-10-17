// M1 — Record prompt (DESIGN.md 3.6, stories-a). One test per story path.
// `cpt-noter-seq-record-prompt-start-recording` is one of the five critical stories (sequence
// diagram in 3.6). Contract-level today: the record prompt, call screen and menu bar steps are
// the commands those surfaces send; the panel itself (non-activating, focus stays in the call
// app) is XCUITest's (docs/TEST-PLAN.md › M1).
import type { CaptureState, DetectionChanged, LevelsMsg } from "../../src/core/bindings";
import { ahead, ok, refused, until } from "../support/results";
import * as W from "../support/world-presets";
import { expect, given, test, versionsGrow } from "./support/fixtures";

const recording = (c: CaptureState) => c.phase === "recording" && c.call_id !== null;

test.describe("cpt-noter-seq-record-prompt-start-recording", () => {
  test("happy path: Record this call? → Record → call screen recording, focus stays in Teams", async ({ scenario }) => {
    let detection!: ReturnType<typeof W.detect>;
    await given(scenario, W.idle, (w) => (detection = W.detect(w, W.APPS.teams)));
    const prompt = scenario.core("record-prompt");
    const captures = await scenario.events("capture:state");
    const detected = await scenario.events("capture:detected");

    const snap = ok(await prompt.appSnapshot({}));
    expect(snap.detection.detection).toMatchObject({ app_name: "Microsoft Teams", blocked: null }); // Microsoft Teams is using the microphone
    ok(await prompt.windowAnnounce({ text: "Record this call?", politeness: "polite" }));

    const started = ok(await prompt.captureStart({ source: "record_prompt", sensitive: false, detection_id: detection.id }));
    expect(recording(started)).toBe(true);
    expect(started.sensitive).toBe(false);
    await until(() => detected.latest()?.detection === null, "the prompt closes (capture:detected without a detection)");
    await until(() => captures.latest() && recording(captures.latest()!), "capture:state recording");
    expect(versionsGrow(captures.all)).toBe(true);

    ok(await prompt.windowShowCall({})); // the call screen opens on the second display
    const screen = scenario.core("call-screen");
    const there = ok(await screen.appSnapshot({}));
    expect(there.capture).toMatchObject({ phase: "recording", call_id: started.call_id }); // Recording · 00:12
    const levels: LevelsMsg[] = [];
    ok(await screen.levelsSubscribe({ call_id: started.call_id }, (m) => levels.push(m)));
    await until(() => levels.length >= 2, "both meters moving on the call screen");
  });

  test("other path — Vendor call recorded as sensitive: Record as Sensitive, nothing leaves the Mac", async ({ scenario }) => {
    let detection!: ReturnType<typeof W.detect>;
    await given(scenario, W.idle, (w) => (detection = W.detect(w, W.APPS.zoom)));
    const prompt = scenario.core("record-prompt");

    const started = ok(await prompt.captureStart({ source: "record_prompt", sensitive: true, detection_id: detection.id }));
    expect(started).toMatchObject({ phase: "recording", sensitive: true });
    expect(ok(await scenario.core("call-screen").appSnapshot({})).capture.sensitive).toBe(true); // Sensitive · local
    // Sensitive is one-way during capture: it cannot be switched back while recording.
    const back = refused(await scenario.core("call-screen").captureSetSensitive({ call_id: started.call_id!, sensitive: false }));
    expect(back.code).toBe("invalid_input");
  });

  test("other path — Not a call: Don't Ask for Safari…, no more prompts, listed in Settings › General with Remove", async ({ scenario }) => {
    await given(scenario, W.idle, (w) => W.detect(w, W.APPS.safari));
    const prompt = scenario.core("record-prompt");
    const detected = await scenario.events("capture:detected");

    ok(await prompt.captureIgnoreApp({ ...W.APPS.safari })); // Don't Ask
    await until(() => detected.latest()?.detection === null, "the prompt closes");
    const settings = scenario.core("settings");
    const general = ok(await settings.settingsGet({})).general;
    expect(general.ignored_apps).toContainEqual({ ...W.APPS.safari }); // Apps Noter doesn't ask about

    const removed = ok(await settings.settingsUnignoreApp({ bundle_id: W.APPS.safari.bundle_id })); // Remove
    expect(removed.general.ignored_apps.some((a) => a.bundle_id === W.APPS.safari.bundle_id)).toBe(false);
    expect(refused(await settings.settingsUnignoreApp({ bundle_id: W.APPS.safari.bundle_id })).code).toBe("not_found");
  });

  test("error path — Not enough disk space: Record disabled, Delete Old Audio…, then Call Detected · Start Recording", async ({ scenario }) => {
    await given(scenario, W.idle, (w) => {
      w.app.environment.disk_free_mb = 420;
      W.detect(w, W.APPS.teams, "disk_full");
    });
    const prompt = scenario.core("record-prompt");

    expect(ok(await prompt.appSnapshot({})).detection.detection?.blocked).toBe("disk_full"); // Record disabled
    const full = refused(await prompt.captureStart({ source: "record_prompt", sensitive: false }));
    expect(full.code).toBe("disk_full");
    expect(full.detail).toEqual({ type: "disk_space", free_mb: 420, needed_mb: 500 }); // (420 MB free)

    ok(await prompt.windowNavigate({ target: { type: "today" } })); // Delete Old Audio… opens its sheet in the main window
    const main = scenario.core("main");
    ahead(await main.audioDeleteOlder({ older_than_days: 30 })); // Delete Audio (M2 command)
    await scenario.change((w) => {
      w.app.environment.disk_free_mb = 6_600; // 6.2 GB freed
      if (w.app.detection.detection) w.app.detection.detection.blocked = null;
    });

    const started = ok(await main.captureStart({ source: "menu_bar", sensitive: false })); // Call Detected · Start Recording
    expect(recording(started)).toBe(true);
  });

  test("error path — System audio access is off: only your side, Record still the default and records at once", async ({ scenario }) => {
    await given(scenario, W.idle, (w) => W.permission(w, "system_audio", "denied"), (w) => W.detect(w, W.APPS.teams));
    const prompt = scenario.core("record-prompt");

    const snap = ok(await prompt.appSnapshot({}));
    expect(snap.environment.permissions.find((p) => p.kind === "system_audio")?.state).toBe("denied");
    expect(snap.detection.detection?.blocked).toBeNull(); // Record stays enabled and the default

    // O1: a start is never gated on permissions. Clicking Record at step 1 records at once…
    const started = ok(await prompt.captureStart({ source: "record_prompt", sensitive: false }));
    expect(recording(started)).toBe(true);
    // …and the call screen says System audio silent until it is allowed and Noter reopens.
    await scenario.change((w) => W.degrade(w, { type: "system_audio_silent", call_id: started.call_id!, since: Date.now(), confidence: null }));
    expect(ok(await scenario.core("call-screen").appSnapshot({})).degraded.states.some((d) => d.type === "system_audio_silent")).toBe(true);
    ok(await scenario.core("call-screen").openExternal({ target: { type: "system_settings", permission: "system_audio" } }));
  });
});

test.describe("cpt-noter-seq-record-prompt-record-after-missed-prompt", () => {
  test("happy path: Not Now, then ⌃⌥⌘R minutes later records from that moment", async ({ scenario }) => {
    let detection!: ReturnType<typeof W.detect>;
    await given(scenario, W.idle, (w) => (detection = W.detect(w, W.APPS.teams)));
    const prompt = scenario.core("record-prompt");
    const detected = await scenario.events("capture:detected");

    ok(await prompt.captureDismissDetection({ detection_id: detection.id, reason: "not_now" }));
    await until(() => detected.latest()?.detection === null, "the prompt closes");
    expect(refused(await prompt.captureDismissDetection({ detection_id: detection.id, reason: "not_now" })).code).toBe("detection_expired");

    const started = ok(await scenario.core("call-screen").captureStart({ source: "hotkey", sensitive: false })); // ⌃⌥⌘R
    expect(started).toMatchObject({ phase: "recording", recorded_ms: 0 });
  });

  test("empty path — Prompt closed unanswered: Call Detected · Start Recording from the menu, no second prompt", async ({ scenario }) => {
    let detection!: ReturnType<typeof W.detect>;
    await given(scenario, W.idle, (w) => (detection = W.detect(w, W.APPS.teams)));
    const prompt = scenario.core("record-prompt");
    const detected = await scenario.events("capture:detected");

    ok(await prompt.captureDismissDetection({ detection_id: detection.id, reason: "timed_out" }));
    const started = ok(await scenario.core("main").captureStart({ source: "menu_bar", sensitive: false }));
    expect(recording(started)).toBe(true);
    expect(ok(await prompt.appSnapshot({})).detection.detection).toBeNull(); // no second prompt for this call
    expect(detected.all.every((d: DetectionChanged) => d.detection === null)).toBe(true);
  });

  test("error path — Setup incomplete: no prompt, Start Recording works, Finish Setup… after the call", async ({ scenario }) => {
    await given(scenario, W.idle, W.selfTestSkipped, (w) => (w.app.setup.complete = false));
    const main = scenario.core("main");
    const nav = await scenario.events("nav:request");

    const snap = ok(await main.appSnapshot({}));
    expect(snap.setup.detection_enabled).toBe(false); // Setup incomplete · call detection off
    expect(snap.detection.detection).toBeNull(); // no Record this call?

    const started = ok(await main.captureStart({ source: "menu_bar", sensitive: false })); // O1: never gated on setup
    expect(recording(started)).toBe(true);
    expect(ok(await main.captureStop({ call_id: started.call_id! })).phase).toBe("stopped");

    ok(await main.windowNavigate({ target: { type: "first_run", step: "permissions" } })); // Finish Setup…
    await until(() => nav.latest()?.type === "first_run", "the first-run window at Permissions");
    const fr = scenario.core("first-run");
    let passed = false;
    ok(await fr.selfTestRun({ play_clip: false }, (m) => (passed ||= m.event.type === "passed")));
    await until(() => passed, "Self-test passed");
    await until(async () => ok(await fr.setupStatus({})).detection_enabled, "call detection on for the next call");
  });

  test("error path — Audio access not granted yet: Start Recording asks for the microphone, records mic only", async ({ scenario }) => {
    await given(scenario, W.idle, (w) => {
      W.permission(w, "microphone", "not_asked");
      W.permission(w, "system_audio", "not_asked");
      w.app.setup.complete = false;
      w.app.setup.detection_enabled = false;
    });
    const main = scenario.core("main");

    const started = ok(await main.captureStart({ source: "menu_bar", sensitive: false })); // O1: never gated on permissions
    expect(recording(started)).toBe(true);
    expect(ok(await main.permissionRequest({ kind: "microphone" })).state).toBe("granted"); // the macOS prompt, allowed
    await scenario.change((w) => W.degrade(w, { type: "system_audio_silent", call_id: started.call_id!, since: Date.now(), confidence: null }));
    expect(ok(await scenario.core("call-screen").appSnapshot({})).degraded.states.map((d) => d.type)).toContain("system_audio_silent"); // Recording · mic only

    ok(await main.captureStop({ call_id: started.call_id! }));
    ok(await main.windowNavigate({ target: { type: "first_run", step: "permissions" } })); // Finish Setup…
    expect(ok(await scenario.core("first-run").permissionRequest({ kind: "system_audio" })).state).toBe("granted");
  });

  test("empty path — Hidden for presenting: no prompt drawn, Call Detected · Start Recording keeps everything hidden", async ({ scenario }) => {
    await given(scenario, W.idle);
    const main = scenario.core("main");
    expect(ok(await main.appSetHiddenForPresenting({ hidden: true })).hidden).toBe(true);
    await scenario.change((w) => W.detect(w, W.APPS.teams)); // the call starts while hidden

    const snap = ok(await main.appSnapshot({}));
    expect(snap.presenting.hidden).toBe(true); // eye-slash mark; Show Noter in the menu
    const started = ok(await main.captureStart({ source: "menu_bar", sensitive: false }));
    expect(recording(started)).toBe(true);
    expect(ok(await main.appSnapshot({})).presenting.hidden).toBe(true); // nothing drawn on the shared screen
  });
});
