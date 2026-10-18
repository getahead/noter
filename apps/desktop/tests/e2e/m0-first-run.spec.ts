// M0 — First-run wizard (DESIGN.md 3.6, stories-a). One test per story path.
// Contract-level today (no React screens yet): each step drives the command the screen sends
// and asserts what the screen would render from. UI steps are added when the wizard lands
// (docs/TEST-PLAN.md › M0).
import type { LevelsMsg, SelfTestMsg, SetupStatus } from "../../src/core/bindings";
import { ahead, ok, refused, until } from "../support/results";
import * as W from "../support/world-presets";
import { expect, given, seqContiguous, test, versionsGrow } from "./support/fixtures";

const granted = (s: SetupStatus, kind: string) => s.permissions.find((p) => p.kind === kind)?.state === "granted";

/** Both audio permissions granted on the Microphone and system audio step. */
function audioGranted(w: Parameters<typeof W.firstRun>[0]): void {
  W.permission(w, "microphone", "granted");
  W.permission(w, "system_audio", "granted");
}

test.describe("cpt-noter-seq-first-run-complete-setup", () => {
  test("happy path: allow both permissions, Run Test, Self-test passed with a live line, Call display next", async ({ scenario }) => {
    await given(scenario, (w) => W.firstRun(w));
    const fr = scenario.core("first-run");
    const setupEvents = await scenario.events("setup:changed");

    const before = ok(await fr.setupStatus({}));
    expect(granted(before, "system_audio")).toBe(false); // Run Test dimmed until system audio is allowed

    expect(ok(await fr.permissionRequest({ kind: "microphone" })).state).toBe("granted");
    const levels: LevelsMsg[] = [];
    const meter = ahead(await fr.levelsSubscribe({ call_id: null }, (m) => levels.push(m))); // the level meter (M1 command)
    if (meter) {
      await until(() => levels.length >= 3, "Hearing you: the level meter moves");
      expect(levels.some((l) => l.mic_db !== null)).toBe(true);
      expect(seqContiguous(levels)).toBe(true);
      ok(await fr.streamUnsubscribe({ subscription_id: meter.subscription_id }));
    }

    ahead(await fr.openExternal({ target: { type: "system_settings", permission: "system_audio" } })); // Open System Settings… (M1 command)
    expect(ok(await fr.permissionRequest({ kind: "system_audio" })).state).toBe("granted"); // Checking… then Granted

    const run: SelfTestMsg[] = [];
    ok(await fr.selfTestRun({ play_clip: false }, (m) => run.push(m)));
    await until(() => run.some((m) => m.event.type === "passed"), "Self-test passed");
    expect(run.some((m) => m.event.type === "line")).toBe(true);
    const streams = new Set(run.flatMap((m) => (m.event.type === "stream_arrived" ? [m.event.channel] : [])));
    expect([...streams].sort()).toEqual(["mic", "sys"]);
    expect(seqContiguous(run)).toBe(true);

    const after = await until(async () => {
      const s = ok(await fr.setupStatus({}));
      return s.self_test.type === "passed" && s;
    }, "the self-test recorded as passed");
    expect(granted(after, "microphone") && granted(after, "system_audio")).toBe(true);
    const next = ok(await fr.setupSetStep({ step: "permissions", state: "done" }));
    expect(next.steps.find((s) => s.step === "call_display")?.state).toBe("todo"); // Call display next
    expect(versionsGrow(setupEvents.all)).toBe(true);
  });

  test("other path — Finish the remaining steps: Call display, Audio storage, Assistants, Finish to Today with detection on", async ({ scenario }) => {
    await given(scenario, (w) => W.firstRun(w), audioGranted, (w) => {
      w.app.setup.self_test = { type: "passed", at: Date.now() };
      w.app.setup.detection_enabled = w.settings.general.offer_to_record;
      w.app.setup.steps.find((s) => s.step === "permissions")!.state = "done";
    });
    const fr = scenario.core("first-run");

    const snap = ok(await fr.appSnapshot({}));
    const withoutCallApp = snap.environment.displays.find((d) => !d.holds_call_app);
    expect(withoutCallApp?.id).toBe(W.STUDIO_DISPLAY); // the display without the call app is chosen
    expect(ok(await fr.setupSetCallDisplay({ display_id: withoutCallApp!.id })).call_display).toBe(W.STUDIO_DISPLAY);
    const settings = ok(await fr.settingsGet({}));
    expect(settings.call_screen.open_automatically).toBe(true);
    ok(await fr.setupSetStep({ step: "call_display", state: "done" }));

    expect(settings.audio.retention).toBe("days30"); // Keep audio for 30 days selected
    ok(await fr.setupSetAudioStorage({ never_store_audio: false, retention: "days30" }));
    ok(await fr.setupSetStep({ step: "audio_storage", state: "done" }));
    const finished = ok(await fr.setupSetStep({ step: "assistants", state: "done" }));
    expect(finished.complete).toBe(true);

    const today = ok(await scenario.core("main").appSnapshot({}));
    expect(today.setup.complete).toBe(true);
    expect(today.setup.detection_enabled).toBe(true);
    expect(today.degraded.states.some((d) => d.type === "setup_incomplete")).toBe(false); // no setup banner
    expect(ok(await scenario.core("main").settingsGet({})).audio.retention).toBe("days30");
  });

  test("error path — Microphone not allowed: Open System Settings…, turn Noter on, Hearing you", async ({ scenario }) => {
    await given(scenario, (w) => W.firstRun(w), (w) => W.permission(w, "microphone", "denied"));
    const fr = scenario.core("first-run");
    const setupEvents = await scenario.events("setup:changed");

    const denied = refused(await fr.permissionRequest({ kind: "microphone" }));
    expect(denied.code).toBe("permission_denied"); // Microphone · not allowed
    expect(denied.detail).toEqual({ type: "permission", kind: "microphone" });
    expect(denied.retryable).toBe(false);
    ahead(await fr.openExternal({ target: { type: "system_settings", permission: "microphone" } })); // Open System Settings… (M1 command)

    await scenario.change((w) => W.permission(w, "microphone", "granted")); // turned on in System Settings
    await until(() => setupEvents.latest() && granted(setupEvents.latest()!, "microphone"), "the row re-checked as granted");
    const levels: LevelsMsg[] = [];
    if (ahead(await fr.levelsSubscribe({ call_id: null }, (m) => levels.push(m)))) {
      await until(() => levels.some((l) => l.mic_db !== null), "Hearing you beside the moving meter"); // the meter (M1 command)
    }
  });

  test("error path — System audio not allowed: allow it in System Settings, row re-checked, Run Test ready", async ({ scenario }) => {
    await given(scenario, (w) => W.firstRun(w), (w) => {
      W.permission(w, "microphone", "granted");
      W.permission(w, "system_audio", "denied");
    });
    const fr = scenario.core("first-run");
    const setupEvents = await scenario.events("setup:changed");

    const denied = refused(await fr.permissionRequest({ kind: "system_audio" }));
    expect(denied.code).toBe("permission_denied"); // System audio recording · not allowed yet
    expect(denied.detail).toEqual({ type: "permission", kind: "system_audio" });
    ahead(await fr.openExternal({ target: { type: "system_settings", permission: "system_audio" } })); // Open System Settings… (M1 command)

    await scenario.change((w) => W.permission(w, "system_audio", "granted"));
    await until(() => setupEvents.latest() && granted(setupEvents.latest()!, "system_audio"), "the row checked again by itself");
    const run: SelfTestMsg[] = [];
    ok(await fr.selfTestRun({ play_clip: false }, (m) => run.push(m))); // Run Test ready
    await until(() => run.some((m) => m.event.type === "passed"), "Self-test passed");
  });

  test("error path — Self-test hears only one stream: the hint, play a sound, Run Test again, passed", async ({ scenario }) => {
    await given(scenario, (w) => W.firstRun(w), audioGranted);
    const fr = scenario.core("first-run");

    const first: SelfTestMsg[] = [];
    ok(await fr.selfTestRun({ play_clip: false }, (m) => first.push(m)));
    // The engine hears the microphone but nothing from system audio.
    await scenario.push("self_test_run", { event: { type: "levels", mic_db: -30, sys_db: null } });
    await scenario.push("self_test_run", { event: { type: "failed", reason: { type: "one_stream_silent", channel: "sys" } } });
    await scenario.push("self_test_run", { event: { type: "ended", reason: "call_stopped" } });
    await until(() => first.some((m) => m.event.type === "ended"), "the first run to end");
    const failure = first.find((m) => m.event.type === "failed")?.event;
    expect(failure).toEqual({ type: "failed", reason: { type: "one_stream_silent", channel: "sys" } });
    expect(first.some((m) => m.event.type === "passed")).toBe(false);

    const second: SelfTestMsg[] = [];
    ok(await fr.selfTestRun({ play_clip: false }, (m) => second.push(m))); // after playing a video
    await until(() => second.some((m) => m.event.type === "passed"), "Self-test passed");
    await until(async () => ok(await fr.setupStatus({})).self_test.type === "passed", "the step marked done");
  });

  test("empty path — Self-test skipped: detection off until the self-test passes, Run Audio Self-Test… from Today", async ({ scenario }) => {
    await given(scenario, (w) => W.firstRun(w), audioGranted);
    const fr = scenario.core("first-run");

    expect(ok(await fr.setupSetStep({ step: "permissions", state: "skipped" })).steps.find((s) => s.step === "permissions")?.state).toBe("skipped");
    for (const step of ["call_display", "audio_storage", "assistants"] as const) ok(await fr.setupSetStep({ step, state: "done" }));

    const main = scenario.core("main");
    const today = ok(await main.appSnapshot({}));
    expect(today.setup.detection_enabled).toBe(false); // Call detection is off until the audio self-test passes
    expect(today.setup.self_test.type).not.toBe("passed");

    const run: SelfTestMsg[] = [];
    ok(await main.selfTestRun({ play_clip: false }, (m) => run.push(m))); // Run Audio Self-Test… on Today
    await until(() => run.some((m) => m.event.type === "passed"), "Self-test passed");
    await until(async () => ok(await main.setupStatus({})).detection_enabled, "call detection on, banner gone");
  });
});

test.describe("cpt-noter-seq-first-run-download-models", () => {
  test("happy path: start the downloads, continue at once, self-test passes, Finish while the rest downloads", async ({ scenario }) => {
    await given(scenario, (w) => W.firstRun(w, { modelsReady: false }));
    const fr = scenario.core("first-run");

    const models = ok(await fr.setupStatus({})).models;
    expect(models.bundles.length).toBeGreaterThanOrEqual(3);
    expect(models.bundles.every((b) => b.size_mb > 0)).toBe(true);
    expect(models.total_mb).toBe(models.bundles.reduce((n, b) => n + b.size_mb, 0));

    const started = ok(await fr.modelsDownload({ action: "start" }));
    expect(started.models.bundles.some((b) => b.state === "downloading")).toBe(true);
    ok(await fr.setupSetStep({ step: "models", state: "done" })); // Continue at once; downloads go on

    ok(await fr.permissionRequest({ kind: "microphone" }));
    ok(await fr.permissionRequest({ kind: "system_audio" }));
    await until(async () => ok(await fr.setupStatus({})).models.bundles.find((b) => b.required_for_capture)?.state === "ready", "the speech model to arrive");
    const run: SelfTestMsg[] = [];
    ok(await fr.selfTestRun({ play_clip: false }, (m) => run.push(m)));
    await until(() => run.some((m) => m.event.type === "passed"), "Self-test passed");
    ok(await fr.setupSetStep({ step: "permissions", state: "done" }));
    for (const step of ["call_display", "audio_storage", "assistants"] as const) ok(await fr.setupSetStep({ step, state: "done" }));

    const done = await until(async () => {
      const s = ok(await fr.setupStatus({}));
      return s.models.bundles.every((b) => b.state === "ready") && s;
    }, "the remaining models to finish on their own");
    expect(done.complete).toBe(true);
    expect(done.detection_enabled).toBe(true); // Today with call detection on
  });

  test("error path — No connection: Waiting for a connection, Continue, downloads resume once online", async ({ scenario }) => {
    await given(scenario, (w) => W.firstRun(w, { modelsReady: false }), (w) => (w.app.environment.online = false));
    const fr = scenario.core("first-run");

    const offline = refused(await fr.modelsDownload({ action: "start" }));
    expect(offline.code).toBe("offline");
    expect(offline.retryable).toBe(true);
    ok(await fr.setupSetStep({ step: "models", state: "done" })); // Continue: nothing else to do

    await scenario.change((w) => (w.app.environment.online = true));
    // The real core resumes by itself when the Mac is online again; the fake has no download
    // scheduler, so there the resume the core would do is sent explicitly.
    if (scenario.target === "fake") ok(await fr.modelsDownload({ action: "resume" }));
    await until(async () => ok(await fr.setupStatus({})).models.bundles.every((b) => b.state === "ready"), "the progress bars moving again");
  });

  test("error path — Not enough disk space: Needs 2.1 GB, 1.4 GB free, Try Again starts the downloads", async ({ scenario }) => {
    await given(scenario, (w) => W.firstRun(w, { modelsReady: false }));
    const fr = scenario.core("first-run");
    await scenario.failNext("first-run", "models_download", "disk_full", { type: "disk_space", free_mb: 1400, needed_mb: 2100 });

    const full = refused(await fr.modelsDownload({ action: "start" }));
    expect(full.code).toBe("disk_full");
    expect(full.detail).toEqual({ type: "disk_space", free_mb: 1400, needed_mb: 2100 });

    const retried = ok(await fr.modelsDownload({ action: "retry" })); // after deleting files in Finder
    expect(retried.models.bundles.some((b) => b.state === "downloading" || b.state === "ready")).toBe(true);
    ok(await fr.setupSetStep({ step: "models", state: "done" }));
  });

  test("error path — Download failed its check: Check failed, Try Again downloads the bundle again", async ({ scenario }) => {
    await given(scenario, (w) => W.firstRun(w, { modelsReady: false }), (w) => {
      Object.assign(W.speechModel(w), { state: "checksum_failed" });
      w.app.setup.models.error = "checksum_failed";
    });
    const fr = scenario.core("first-run");

    const shown = ok(await fr.setupStatus({}));
    expect(shown.models.bundles.find((b) => b.required_for_capture)?.state).toBe("checksum_failed");
    const again = ok(await fr.modelsDownload({ action: "retry" }));
    expect(["downloading", "verifying", "ready"]).toContain(again.models.bundles.find((b) => b.required_for_capture)?.state);
    await until(async () => ok(await fr.setupStatus({})).models.bundles.find((b) => b.required_for_capture)?.state === "ready", "the model checked and in place");
    ok(await fr.setupSetStep({ step: "models", state: "done" }));
  });

  test("error path — Speech model not downloaded yet: the test waits for the speech model, then passes", async ({ scenario }) => {
    await given(scenario, (w) => W.firstRun(w, { modelsReady: false }), audioGranted, (w) => {
      const speech = W.speechModel(w);
      Object.assign(speech, { state: "downloading", done_mb: Math.round(speech.size_mb * 0.62) });
      w.app.setup.steps.find((s) => s.step === "models")!.state = "done";
    });
    const fr = scenario.core("first-run");
    ok(await fr.modelsDownload({ action: "resume" }));

    const run: SelfTestMsg[] = [];
    ok(await fr.selfTestRun({ play_clip: false }, (m) => run.push(m))); // Waiting for the speech model · 62 %
    await until(() => run.some((m) => m.event.type === "passed"), "Self-test passed once the model is in", 10_000);
    expect(run.some((m) => m.event.type === "failed")).toBe(false);
    expect(ok(await fr.setupStatus({})).models.bundles.find((b) => b.required_for_capture)?.state).toBe("ready");
  });
});
