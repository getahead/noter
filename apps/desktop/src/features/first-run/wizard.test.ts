import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { ModelBundle, SetupStep } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import type { World } from "../../../tests/support/scenario";
import * as W from "../../../tests/support/world-presets";
import { initialSelfTestPanel } from "./self-test";
import {
  allReady, bundlePercent, bundleRowState, createWizard, downloadPaused, gigabytes, overallPercent, resumeStep, rowStateFor, speechPercent, speechReady, syncSelfTest, wholeGigabytes, type Wizard,
} from "./wizard";

const at = (step: SetupStep) => (w: World) => {
  const order = ["welcome", "models", "permissions", "call_display", "audio_storage", "assistants"];
  w.app.setup.steps.forEach((s) => (s.state = order.indexOf(s.step) < order.indexOf(step) ? "done" : "todo"));
};
const bundle = (state: ModelBundle["state"], done_mb = 0, required = false): ModelBundle => ({ name: "m", size_mb: 100, done_mb, state, required_for_capture: required });

describe("model bundles (cpt-noter-flow-ui-first-run-download-models)", () => {
  it("reads progress, readiness and the row state off the bundles", () => {
    expect(bundlePercent(bundle("downloading", 62))).toBe(62);
    expect(bundlePercent(bundle("ready", 100))).toBe(100);
    expect(bundlePercent({ ...bundle("pending"), size_mb: 0 })).toBe(0);
    expect(speechPercent([bundle("pending"), bundle("downloading", 30, true)])).toBe(30);
    expect(speechPercent([])).toBe(0);
    expect(speechReady([bundle("ready", 100, true)])).toBe(true);
    expect(speechReady([bundle("downloading", 10, true)])).toBe(false);
    expect(allReady([])).toBe(false);
    expect(allReady([bundle("ready"), bundle("ready")])).toBe(true);
    expect(overallPercent({ bundles: [bundle("ready")], total_mb: 100, done_mb: 100, error: null })).toBe(100);
    expect(overallPercent({ bundles: [bundle("pending")], total_mb: 200, done_mb: 50, error: null })).toBe(25);
    expect(bundleRowState(bundle("checksum_failed"))).toBe("failed");
    expect(bundleRowState(bundle("failed"))).toBe("failed");
    expect(bundleRowState(bundle("ready"))).toBe("finished");
    expect(bundleRowState(bundle("paused"))).toBe("paused");
    expect(bundleRowState(bundle("verifying"))).toBe("running");
  });

  it("offers Resume only when every unfinished bundle is paused", () => {
    expect(downloadPaused([bundle("paused"), bundle("ready")])).toBe(true);
    expect(downloadPaused([bundle("paused"), bundle("downloading")])).toBe(false);
    expect(downloadPaused([bundle("ready")])).toBe(false);
  });

  it("writes sizes in gigabytes with one decimal, and the whole download as About N GB", () => {
    expect(gigabytes(2100)).toBe("2.1 GB");
    expect(gigabytes(1400)).toBe("1.4 GB");
    expect(wholeGigabytes(2048)).toBe("2 GB");
    expect(wholeGigabytes(100)).toBe("1 GB");
  });
});

describe("resumeStep", () => {
  const rows = (...states: ("todo" | "done" | "skipped")[]) => (["welcome", "models", "permissions", "call_display", "audio_storage", "assistants"] as SetupStep[]).map((step, i) => ({ step, state: states[i] ?? "todo" }));
  it("opens at the first step still to do, and at Assistants when all have an answer", () => {
    expect(resumeStep(rows())).toBe("welcome");
    expect(resumeStep(rows("done", "done"))).toBe("permissions");
    expect(resumeStep(rows("done", "done", "skipped", "todo"))).toBe("call_display");
    expect(resumeStep(rows("done", "done", "done", "done", "done", "done"))).toBe("assistants");
  });
});

describe("syncSelfTest", () => {
  const idle = initialSelfTestPanel("IDLE", true);
  it("shows the missing permission, then Idle once it is granted", () => {
    const missing = syncSelfTest(idle, { sysGranted: false, modelReady: true });
    expect(missing.panel.state).toBe("PERMISSION_MISSING");
    expect(syncSelfTest(missing.panel, { sysGranted: false, modelReady: true }).panel).toBe(missing.panel);
    expect(syncSelfTest(missing.panel, { sysGranted: true, modelReady: true }).panel.state).toBe("IDLE");
  });
  it("waits for the speech model at once, and runs by itself when it arrives (D-21)", () => {
    const waiting = syncSelfTest(idle, { sysGranted: true, modelReady: false });
    expect(waiting).toMatchObject({ autoRun: false, panel: { state: "WAITING_FOR_MODEL", runEnabled: false } });
    expect(syncSelfTest(waiting.panel, { sysGranted: true, modelReady: true })).toMatchObject({ autoRun: true, panel: { state: "RUNNING" } });
  });
  it("leaves a finished or running test alone", () => {
    for (const state of ["RUNNING", "PASSED", "FAILED"] as const) {
      const p = initialSelfTestPanel(state, true);
      expect(syncSelfTest(p, { sysGranted: true, modelReady: true }).panel).toBe(p);
    }
  });
});

describe("rowStateFor (cpt-noter-state-ui-first-run-permission-row)", () => {
  const none = { checking: [], zeroBuffers: false };
  it("follows the core, starting system audio as missing", () => {
    expect(rowStateFor("microphone", "not_asked", none)).toBe("NOT_ASKED");
    expect(rowStateFor("microphone", "denied", none)).toBe("DENIED");
    expect(rowStateFor("microphone", "granted", none)).toBe("GRANTED");
    expect(rowStateFor("system_audio", "not_asked", none)).toBe("MISSING");
    expect(rowStateFor("system_audio", undefined, none)).toBe("MISSING");
  });
  it("checks while the core re-reads, and reads digital silence as missing", () => {
    expect(rowStateFor("system_audio", "denied", { checking: ["system_audio"], zeroBuffers: false })).toBe("CHECKING");
    expect(rowStateFor("system_audio", "granted", { checking: ["system_audio"], zeroBuffers: false })).toBe("GRANTED");
    expect(rowStateFor("system_audio", "granted", { checking: [], zeroBuffers: true })).toBe("MISSING");
    expect(rowStateFor("microphone", "granted", { checking: [], zeroBuffers: true })).toBe("GRANTED");
  });
});

// The controller against the fake core, which answers like the real one (D-21 included).
describe("createWizard", () => {
  let fake: FakeCore;
  let bridge: Bridge;
  let wizard: Wizard;
  let said: string[];
  let stop: () => void;
  const sent = (cmd: string) => calls.filter((c) => c.cmd === cmd).map((c) => c.args);
  let calls: { cmd: string; args: unknown }[];

  async function open(prepare: (w: World) => void = () => {}) {
    fake = new FakeCore({ window: "first-run" });
    fake.setWorld((w) => (W.firstRun(w, { modelsReady: true }), prepare(w)));
    const invoke = fake.invoke.bind(fake);
    fake.invoke = ((cmd: string, args: unknown, onMessage?: never) => (calls.push({ cmd, args }), invoke(cmd as never, args as never, onMessage))) as typeof fake.invoke;
    bridge = createBridge("first-run", fake);
    await bridge.open();
    said = [];
    wizard = createWizard(bridge, (text) => said.push(text));
    stop = wizard.start();
    await vi.advanceTimersByTimeAsync(0);
  }
  const state = () => wizard.store.getState();
  const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
  });
  afterEach(async () => {
    stop?.();
    await bridge?.close();
    vi.useRealTimers();
  });

  it("opens where setup stopped and starts no download when the models are in", async () => {
    await open();
    expect(state()).toMatchObject({ current: "permissions", resumed: true, retention: "days30", autoOpen: true });
    expect(sent("models_download")).toEqual([]);
  });

  it("starts the downloads while the bundles are pending, and announces Models downloaded once", async () => {
    await open((w) => W.firstRun(w, { modelsReady: false }));
    expect(state()).toMatchObject({ current: "models", resumed: true });
    expect(sent("models_download")).toEqual([{ action: "start" }]);
    await settle(900);
    expect(allReady(bridge.store.getState().whole.setup!.models.bundles)).toBe(true);
    expect(said).toEqual(["Models downloaded"]);
    await settle(900);
    expect(said).toHaveLength(1);
  });

  it("pauses, resumes, and shows the core's refusal for lack of disk space until Try Again", async () => {
    await open((w) => W.firstRun(w, { modelsReady: false }));
    await wizard.download("pause");
    expect(downloadPaused(bridge.store.getState().whole.setup!.models.bundles)).toBe(true);
    fake.failNext("models_download", "disk_full", { type: "disk_space", free_mb: 1400, needed_mb: 2100 });
    await wizard.download("resume");
    expect(state().disk).toEqual({ free_mb: 1400, needed_mb: 2100 });
    await wizard.download("start");
    expect(state().disk).toBeNull();
    fake.failNext("models_download", "disk_full");
    await wizard.download("start");
    expect(state().disk).toBeNull(); // a refusal without numbers shows no banner here
  });

  it("saves each step on Continue and Skip for Now, and goes Back and to an earlier step", async () => {
    await open();
    await wizard.skip();
    expect(sent("setup_set_step")).toContainEqual({ step: "permissions", state: "skipped" });
    expect(state().current).toBe("call_display");
    await wizard.continue();
    expect(sent("setup_set_call_display")).toEqual([{ display_id: null }]);
    expect(sent("settings_update")).toHaveLength(1);
    expect(state().current).toBe("audio_storage");
    wizard.choose({ retention: "never_store" });
    await wizard.continue();
    expect(sent("setup_set_audio_storage")).toEqual([{ never_store_audio: true, retention: "never_store" }]);
    expect(state().current).toBe("assistants");
    wizard.back();
    expect(state().current).toBe("audio_storage");
    wizard.goto("permissions");
    expect(state().current).toBe("permissions");
    wizard.goto("assistants"); // the stepper only goes back
    expect(state().current).toBe("permissions");
  });

  it("stays on the step when its command is refused", async () => {
    await open();
    fake.failNext("setup_set_step", "not_found");
    await wizard.continue();
    expect(state().current).toBe("permissions");
  });

  it("finishes: the last step done, then the main window", async () => {
    await open();
    await wizard.finish();
    expect(sent("setup_set_step")).toContainEqual({ step: "assistants", state: "done" });
    expect(sent("window_navigate")).toEqual([{ target: { type: "today" } }]);
    expect(state().current).toBe("done");
  });

  it("asks for the microphone, then re-reads the setup status", async () => {
    await open();
    await wizard.allow("microphone");
    expect(sent("permission_request")).toEqual([{ kind: "microphone" }]);
    expect(sent("setup_status")).toHaveLength(1);
    expect(bridge.store.getState().whole.setup!.permissions.find((p) => p.kind === "microphone")?.state).toBe("granted");
  });

  it("checks a row again when the user is back from System Settings", async () => {
    await open();
    await wizard.returned(); // nothing to check
    expect(sent("setup_status")).toEqual([]);
    await wizard.openSettings("system_audio");
    await wizard.openSettings("system_audio");
    expect(sent("open_external")).toHaveLength(2);
    expect(state().away).toEqual(["system_audio"]);
    const back = wizard.returned();
    expect(state().checking).toEqual(["system_audio"]);
    await back;
    expect(state()).toMatchObject({ away: [], checking: [] });
  });

  it("waits for the speech model without asking the core, then runs the test by itself (D-21)", async () => {
    await open((w) => (W.firstRun(w, { modelsReady: false }), W.permission(w, "microphone", "granted"), W.permission(w, "system_audio", "granted")));
    expect(state().panel.state).toBe("WAITING_FOR_MODEL");
    await wizard.runTest(false);
    expect(sent("self_test_run")).toEqual([]);
    await settle(900); // the speech model is in
    expect(sent("self_test_run")).toEqual([{ play_clip: false }]);
    expect(state().panel.state).toBe("RUNNING");
    await settle(2000);
    expect(state().panel).toMatchObject({ state: "PASSED", aligned: true, arrived: { mic: true, sys: true } });
    expect(said).toEqual(expect.arrayContaining(["Your microphone arrives", "System audio arrives", "Both streams line up", "Self-test passed"]));
    expect(said.filter((s) => s === "Self-test passed")).toHaveLength(1);
    expect(state().panel.line).toEqual({ channel: "sys", text: "This is the Noter self-test." }); // shown, never announced
    expect(said).not.toContain("This is the Noter self-test.");
  });

  it("runs Play Test Clip, and again after a verdict", async () => {
    await open((w) => (W.permission(w, "microphone", "granted"), W.permission(w, "system_audio", "granted")));
    await wizard.runTest(true);
    expect(state()).toMatchObject({ clip: true, panel: { state: "RUNNING" } });
    await settle(2000);
    expect(state().panel.state).toBe("PASSED");
    await wizard.runTest(false);
    expect(sent("self_test_run")).toEqual([{ play_clip: true }, { play_clip: false }]);
    expect(state().clip).toBe(false);
  });

  it("waits when the core still refuses for the speech model, and ends the test on any other refusal", async () => {
    await open((w) => (W.permission(w, "microphone", "granted"), W.permission(w, "system_audio", "granted")));
    fake.failNext("self_test_run", "model_missing");
    await wizard.runTest(false);
    expect(state().panel).toMatchObject({ state: "WAITING_FOR_MODEL", runEnabled: false });
    const p = state().panel;
    wizard.store.setState({ panel: { ...p, state: "IDLE", runEnabled: true } });
    fake.failNext("self_test_run", "not_found");
    await wizard.runTest(false);
    expect(state().panel).toMatchObject({ state: "FAILED", runEnabled: true, failure: "self_test.refused" });
  });

  it("reads digital silence as System Audio Recording not allowed", async () => {
    await open((w) => (W.permission(w, "microphone", "granted"), W.permission(w, "system_audio", "granted")));
    await wizard.runTest(false);
    await settle(100);
    fake.push("self_test_run", { event: { type: "failed", reason: { type: "zero_buffers" } } });
    await settle(200);
    expect(state()).toMatchObject({ zeroBuffers: true, panel: { state: "PERMISSION_MISSING" } });
    expect(rowStateFor("system_audio", "granted", state())).toBe("MISSING");
    await wizard.openSettings("system_audio");
    await wizard.returned();
    expect(state().zeroBuffers).toBe(false);
  });

  it("keeps the old privacy mode on screen when the core refuses the change, and saves one change at a time", async () => {
    await open();
    fake.failNext("settings_update", "conflict");
    await wizard.choosePrivacy("cloud_allowed");
    expect(state().privacy).toBe("cloud_redacted");
    await Promise.all([wizard.choosePrivacy("cloud_allowed"), wizard.choosePrivacy("local_only")]);
    expect(fake.world.settings.privacy.mode).toBe("local_only");
    expect(state().privacy).toBe("local_only");
  });

  it("shows the persisted mode when two quick privacy changes are both refused", async () => {
    await open();
    fake.failNext("settings_update", "conflict");
    fake.failNext("settings_update", "conflict");
    await Promise.all([wizard.choosePrivacy("local_only"), wizard.choosePrivacy("cloud_allowed")]);
    expect(state().privacy).toBe("cloud_redacted");
    expect(fake.world.settings.privacy.mode).toBe("cloud_redacted");
  });

  it("keeps the last confirmed privacy mode when the read before the save is refused", async () => {
    await open();
    expect(state().loaded).toBe(true);
    fake.failNext("settings_get", "offline");
    await wizard.choosePrivacy("local_only");
    expect(state().privacy).toBe("cloud_redacted");
    expect(fake.world.settings.privacy.mode).toBe("cloud_redacted");
    expect(bridge.store.getState().commands.settings_get?.state).toBe("ERROR");
  });

  it("keeps a newer privacy choice while an older one is refused, and Try Again runs the refused action again", async () => {
    await open();
    fake.failNext("settings_update", "conflict");
    await Promise.all([wizard.choosePrivacy("local_only"), wizard.choosePrivacy("cloud_allowed")]);
    expect(state().privacy).toBe("cloud_allowed"); // the second one was saved
    fake.failNext("settings_update", "offline");
    await wizard.choosePrivacy("local_only");
    expect(state().privacy).toBe("cloud_allowed");
    await wizard.retry();
    expect(state().privacy).toBe("local_only");
  });

  it("names a refused settings read, and Continue retries it", async () => {
    fake = new FakeCore({ window: "first-run" });
    fake.setWorld((w) => (W.firstRun(w, { modelsReady: true }), at("audio_storage")(w)));
    bridge = createBridge("first-run", fake);
    await bridge.open();
    wizard = createWizard(bridge, () => {});
    fake.failNext("settings_get", "offline");
    stop = wizard.start();
    await settle(0);
    expect(bridge.store.getState().commands.settings_get).toMatchObject({ state: "ERROR", error: { tryAgain: true } });
    await wizard.retry();
    expect(state().loaded).toBe(true);
    expect(bridge.store.getState().commands.settings_get?.state).toBe("DONE");
  });

  it("saves nothing from the defaults while the stored settings could not be read", async () => {
    fake = new FakeCore({ window: "first-run" });
    fake.setWorld((w) => (W.firstRun(w, { modelsReady: true }), at("audio_storage")(w)));
    fake.world.settings.audio.retention = "days7";
    bridge = createBridge("first-run", fake);
    await bridge.open();
    wizard = createWizard(bridge, () => {});
    fake.failNext("settings_get", "offline");
    stop = wizard.start();
    await settle(0);
    expect(state().loaded).toBe(false);
    fake.failNext("settings_get", "offline");
    await wizard.continue();
    expect(state().current).toBe("audio_storage"); // nothing was saved, the stored 7 days stay
    expect(fake.world.settings.audio.retention).toBe("days7");
    await wizard.continue(); // the settings read now: the stored choice is what Continue saves
    expect(state()).toMatchObject({ retention: "days7", current: "assistants" });
  });

  it("keeps what the user chose while the stored settings were still on their way, and drops a read that arrives after cleanup", async () => {
    fake = new FakeCore({ window: "first-run" });
    fake.setWorld((w) => (W.firstRun(w, { modelsReady: true }), at("audio_storage")(w)));
    bridge = createBridge("first-run", fake);
    await bridge.open();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const invoke = fake.invoke.bind(fake);
    fake.invoke = ((cmd: string, args: unknown, onMessage?: never) => (cmd === "settings_get" ? held.then(() => invoke(cmd as never, args as never, onMessage)) : invoke(cmd as never, args as never, onMessage))) as typeof fake.invoke;
    wizard = createWizard(bridge, () => {});
    stop = wizard.start();
    wizard.choose({ retention: "never_store", autoOpen: false });
    release();
    await settle(0);
    expect(state()).toMatchObject({ loaded: true, retention: "never_store", autoOpen: false, privacy: "cloud_redacted" });
    stop();
    const again = createWizard(bridge, () => {});
    const stop2 = again.start();
    stop2(); // cleaned up before its read comes back
    await settle(0);
    expect(again.store.getState().loaded).toBe(false);
  });

  it("saves the privacy mode", async () => {
    await open();
    await wizard.choosePrivacy("local_only");
    expect(state().privacy).toBe("local_only");
    expect(sent("settings_update")).toHaveLength(1);
    expect(fake.world.settings.privacy.mode).toBe("local_only");
  });

  it("ignores the store being emptied when the window closes", async () => {
    await open();
    await bridge.close();
    await settle(0);
    expect(state().current).toBe("permissions");
  });

  it("is started once, takes the user's choices, and stops listening on cleanup", async () => {
    await open();
    expect(wizard.start()()).toBeUndefined();
    wizard.choose({ display: "dsp_studio", autoOpen: false, retention: "days7" });
    expect(state()).toMatchObject({ display: "dsp_studio", autoOpen: false, retention: "days7" });
    stop();
    await bridge.core.setupSetStep({ step: "audio_storage", state: "done" }); // nothing is listening any more
    expect(speechPercent(bridge.store.getState().whole.setup!.models.bundles)).toBe(100);
  });
});
