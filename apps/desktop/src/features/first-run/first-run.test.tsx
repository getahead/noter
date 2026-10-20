import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../app/App";
import { FirstRun } from "./first-run";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import type { World } from "../../../tests/support/scenario";
import * as W from "../../../tests/support/world-presets";

let bridge: Bridge | null = null;

/** The first-run window over the fake core, set up by `prepare`, rendered once the snapshot is in. */
async function screen(prepare: (w: World) => void = () => {}) {
  const fake = new FakeCore({ window: "first-run" });
  fake.setWorld((w) => (W.firstRun(w, { modelsReady: true }), prepare(w)));
  bridge = createBridge("first-run", fake);
  await bridge.open();
  return renderToString(<App bridge={bridge} />);
}
/** Steps before `step` done. */
const at = (step: string) => (w: World) => {
  const order = ["welcome", "models", "permissions", "call_display", "audio_storage", "assistants"];
  w.app.setup.steps.forEach((s) => (s.state = order.indexOf(s.step) < order.indexOf(step) ? "done" : "todo"));
};

beforeEach(() => vi.stubGlobal("document", { hasFocus: () => true, querySelector: () => null }));
afterEach(async () => {
  await bridge?.close();
  bridge = null;
  vi.unstubAllGlobals();
});

describe("first-run window (cpt-noter-component-screen-first-run)", () => {
  it("is the three regions of FR-R1 to FR-R3 with the stepper, the step and the footer", async () => {
    const html = await screen(at("welcome"));
    expect(html).toContain('data-component="cpt-noter-component-screen-first-run" data-variant="step-1" data-state="welcome"');
    for (const r of ["FR-R1", "FR-R2", "FR-R3"]) expect(html).toContain(`data-region="${r}"`);
    expect(html).toContain("Set up Noter");
    expect(html).toContain('aria-label="Setup steps"');
    expect(html).toContain("Everything here runs on this Mac.");
    expect(html).toContain("Welcome to Noter");
    expect(html).toContain("English, Russian and German");
    expect(html).toContain('data-variant="first-pass"');
    // Welcome has Continue and a dimmed Back, no Skip for Now
    expect(html).toContain("Continue");
    expect(html).not.toContain("Skip for Now");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*><span>Back<\/span>/);
  });

  it("opens where setup stopped: the stepper resumed, Skip for Now on Permissions", async () => {
    const html = await screen();
    expect(html).toContain('data-variant="resumed"');
    expect(html).toContain('data-state="step-3"');
    expect(html).toContain("Microphone and system audio");
    expect(html).toContain("Skip for Now");
    expect(html).toContain("Allow…"); // the microphone has never been asked
  });

  it("lists the models with progress, About 2 GB and Pause; Continue is not disabled by the download", async () => {
    const html = await screen((w) => (W.firstRun(w, { modelsReady: false }), at("models")(w)));
    expect(html).toContain("Noter downloads its speech, speaker and search models once.");
    expect(html.match(/data-primitive="progress"/g)!.length).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/About 2 GB|About \d+ GB/);
    expect(html).toContain(">Pause<");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*><span>Continue/);
    expect(html).not.toContain("Waiting for a connection");
  });

  it("shows no connection, the disk banner and a failed check as the prototype states do", async () => {
    const offline = await screen((w) => (W.firstRun(w, { modelsReady: false }), at("models")(w), (w.app.environment.online = false)));
    expect(offline).toContain("Waiting for a connection — downloads resume automatically");
    const disk = await screen((w) => (W.firstRun(w, { modelsReady: false }), at("models")(w), (w.app.setup.models.error = "disk_full")));
    expect(disk).toContain('role="alert"');
    expect(disk).toMatch(/Needs [\d.]+ GB, [\d.]+ GB free/);
    expect(disk).toContain("Try Again");
    expect(disk).not.toContain(">Pause<");
    const failed = await screen((w) => (W.firstRun(w, { modelsReady: false }), at("models")(w), (w.app.setup.models.bundles[0]!.state = "checksum_failed")));
    expect(failed).toContain("Check failed");
    expect(failed).toContain("Try Again");
    expect(failed).toContain('data-state="failed"');
  });

  it("shows Resume once the downloads are paused and Ready on a finished bundle", async () => {
    const html = await screen((w) => (W.firstRun(w, { modelsReady: false }), at("models")(w), w.app.setup.models.bundles.forEach((b, i) => (b.state = i === 0 ? "ready" : "paused"))));
    expect(html).toContain(">Resume<");
    expect(html).toContain(">Ready<");
  });

  it("shows the permission rows by state", async () => {
    const denied = await screen((w) => (W.permission(w, "microphone", "denied"), W.permission(w, "system_audio", "not_asked")));
    expect(denied).toContain('<span class="fr-perm__word"> · <!-- -->not allowed</span>');
    expect(denied).toContain("not allowed yet");
    expect(denied).toContain("System Settings › Privacy &amp; Security");
    const granted = await screen((w) => (W.permission(w, "microphone", "granted"), W.permission(w, "system_audio", "granted")));
    expect(granted).toContain("Granted");
    expect(granted).not.toContain("Allow…");
  });

  it("shows Call display with the picker and the automatic opening switch on", async () => {
    const html = await screen(at("call_display"));
    expect(html).toContain('data-region="FR-R2" aria-label="Call display"');
    expect(html).toContain("Recommended");
    expect(html).toContain('role="switch"');
    expect(html).toContain("Open the call screen automatically");
    expect(html).toContain("Skip for Now");
  });

  it("shows Audio storage with 30 days chosen, and Assistants with Finish and the no-assistant warning", async () => {
    const storage = await screen(at("audio_storage"));
    expect(storage).toContain("Keep audio for 30 days");
    expect(storage).toContain("Never store audio");
    expect(storage).not.toContain("Skip for Now");
    const assistants = await screen((w) => {
      at("assistants")(w);
      w.app.accounts.local.running = false;
      w.app.accounts.keys.forEach((k) => (k.status = { type: "not_set" }));
      w.app.accounts.accounts.forEach((a) => (a.status = { type: "not_signed_in" }));
    });
    expect(assistants).toContain("Privacy mode");
    expect(assistants).toContain("Cloud with redaction");
    expect(assistants).toContain("Local runtime");
    expect(assistants).toContain("none found");
    expect(assistants).toContain("Without an assistant Noter still records and transcribes");
    expect(assistants).toContain(">Finish<");
    expect(assistants).not.toContain(">Continue<");
  });

  it("finds a local runtime and drops the warning", async () => {
    const html = await screen((w) => (at("assistants")(w), (w.app.accounts.local.running = true)));
    expect(html).toContain("Ollama detected");
    expect(html).not.toContain("Without an assistant");
  });

  it("says so with Try Again when the core refuses a save", async () => {
    const fake = new FakeCore({ window: "first-run" });
    fake.setWorld((w) => (W.firstRun(w, { modelsReady: true }), at("permissions")(w)));
    bridge = createBridge("first-run", fake);
    await bridge.open();
    fake.failNext("setup_set_step", "offline");
    await bridge.act("setup_set_step", "setup_set_step", () => bridge!.core.setupSetStep({ step: "permissions", state: "done" }));
    const html = renderToString(<App bridge={bridge} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try Again");
  });

  it("offers Try Again only for a refusal that can succeed on a second try", async () => {
    const fake = new FakeCore({ window: "first-run" });
    fake.setWorld((w) => (W.firstRun(w, { modelsReady: true }), at("permissions")(w)));
    bridge = createBridge("first-run", fake);
    await bridge.open();
    fake.failNext("settings_get", "not_found");
    await bridge.act("settings_get", "settings_get", () => bridge!.core.settingsGet({}));
    const html = renderToString(<App bridge={bridge} />);
    expect(html).toContain("Something went wrong");
    expect(html).not.toContain(">Try Again<");
  });

  it("draws nothing once the window's store is emptied on close", async () => {
    await screen(at("permissions"));
    expect(renderToString(<FirstRun bridge={bridge!} />)).toContain("FR-R1");
    await bridge!.close();
    expect(renderToString(<FirstRun bridge={bridge!} />)).toBe("");
  });

  it("mounts only in the first-run window, after the snapshot", async () => {
    const fake = new FakeCore({ window: "main" });
    bridge = createBridge("main", fake);
    await bridge.open();
    expect(renderToString(<App bridge={bridge} />)).not.toContain("FR-R1");
    const early = createBridge("first-run", new FakeCore({ window: "first-run" }));
    expect(renderToString(<App bridge={early} />)).not.toContain("FR-R1");
  });
});
