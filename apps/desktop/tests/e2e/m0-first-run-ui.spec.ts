// M0 — First-run window (docs/features/ui/first-run.md, DESIGN.md › Screen — First run, FR-R1..R3).
// The UI half of the first-run stories: m0-first-run.spec.ts proves each path at the contract;
// these drive the first-run window itself over the selected core (support/app.ts) and check
// what the user sees and which commands the window sends. Written before the window exists
// (tests first): they fail until the first-run feature lands, and the feature's PR carries them.
// Copy and markup follow the prototype (`surface('firstrun')`): the stepper is the list
// "Setup steps" with `data-state` per step, FR-R2 is `data-region="FR-R2"`, and the permission
// rows and the self-test panel carry their DESIGN component IDs in `data-component`.
import type { Page } from "@playwright/test";

import type { ModelBundle } from "../../src/core/bindings";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const FAKE = process.env.NOTER_CORE !== "stdio";

const stepper = (page: Page) => page.getByRole("list", { name: "Setup steps" });
const step = (page: Page, label: string) => stepper(page).getByRole("listitem").filter({ hasText: label });
const stepBody = (page: Page) => page.locator('[data-region="FR-R2"]');
const permissionRow = (page: Page, name: string) =>
  page.locator('[data-component="cpt-noter-component-ui-permission-check-row"]').filter({ hasText: name });
const selfTest = (page: Page) => page.locator('[data-component="cpt-noter-component-ui-self-test-panel"]');
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
/** Arguments of every `name` command the window sent, in order. */
const sent = async (page: Page, name: string): Promise<unknown[]> =>
  (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args);

/** Both audio permissions granted. */
function audioGranted(w: World): void {
  W.permission(w, "microphone", "granted");
  W.permission(w, "system_audio", "granted");
}

test.describe("cpt-noter-seq-first-run-complete-setup", () => {
  test("UI — happy path: Allow… the microphone, system audio from System Settings, Run Test, Self-test passed, Call display next", async ({ page }) => {
    const steer = await openWindow(page, "first-run", { world: (w) => W.firstRun(w) });

    // Opens where setup stopped: Welcome and Models done, Permissions current.
    await expect(step(page, "Permissions")).toHaveAttribute("aria-current", "step");
    await expect(step(page, "Welcome")).toHaveAttribute("data-state", "done");
    await expect(page.getByRole("heading", { name: "Microphone and system audio" })).toBeVisible();
    await expect(button(page, "Run Test")).toBeDisabled(); // dimmed until system audio is allowed

    await permissionRow(page, "Microphone").getByRole("button", { name: "Allow…" }).click();
    expect(await sent(page, "permission_request")).toContainEqual({ kind: "microphone" });
    await expect(permissionRow(page, "Microphone")).toContainText("Granted");
    if (FAKE) await expect(permissionRow(page, "Microphone")).toContainText("Hearing you"); // the meter needs levels_subscribe (M1)

    const sys = permissionRow(page, "System audio recording");
    await expect(sys).toContainText("not allowed yet");
    await sys.getByRole("button", { name: "Open System Settings…" }).click();
    await steer.change((w) => W.permission(w, "system_audio", "granted")); // turned on in System Settings
    await expect(sys).toContainText("Granted");
    await expect(selfTest(page)).not.toContainText("System audio recording is not allowed yet.");

    await button(page, "Run Test").click();
    expect(await sent(page, "self_test_run")).toHaveLength(1);
    await expect(selfTest(page).getByRole("status")).toContainText("Self-test passed");
    for (const line of ["System audio arrives", "Your microphone arrives", "Both streams line up"]) {
      await expect(selfTest(page)).toContainText(line);
    }

    await button(page, "Continue").click();
    expect(await sent(page, "setup_set_step")).toContainEqual({ step: "permissions", state: "done" });
    await expect(step(page, "Permissions")).toHaveAttribute("data-state", "done");
    await expect(step(page, "Call display")).toHaveAttribute("aria-current", "step");
  });

  test("UI — other path: Finish the remaining steps — Call display, Audio storage, Assistants, Finish", async ({ page }) => {
    await openWindow(page, "first-run", {
      world: (w) => {
        W.firstRun(w);
        audioGranted(w);
        w.app.setup.self_test = { type: "passed", at: Date.now() };
        w.app.setup.steps.find((s) => s.step === "permissions")!.state = "done";
      },
    });

    await expect(step(page, "Call display")).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("radio", { name: /The display without the call app/ })).toBeChecked(); // Recommended
    await expect(page.getByRole("switch", { name: "Open the call screen automatically" })).toBeChecked();
    await button(page, "Continue").click();
    const display = (await sent(page, "setup_set_call_display")).at(-1) as { display_id?: string | null } | undefined;
    expect(display).toBeDefined();
    expect([undefined, null, W.STUDIO_DISPLAY]).toContain(display!.display_id); // the display without the call app

    await expect(step(page, "Audio storage")).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("radio", { name: "Keep audio for 30 days" })).toBeChecked();
    await button(page, "Continue").click();
    expect(await sent(page, "setup_set_audio_storage")).toContainEqual({ never_store_audio: false, retention: "days30" });

    await expect(step(page, "Assistants")).toHaveAttribute("aria-current", "step");
    await expect(button(page, "Finish")).toBeEnabled(); // also without an assistant
    await button(page, "Finish").click();
    expect(await sent(page, "setup_set_step")).toContainEqual({ step: "assistants", state: "done" });
  });

  test("UI — error path: Microphone not allowed — Open System Settings…, turn Noter on, Granted", async ({ page }) => {
    const steer = await openWindow(page, "first-run", { world: (w) => (W.firstRun(w), W.permission(w, "microphone", "denied")) });
    const mic = permissionRow(page, "Microphone");

    await expect(mic).toContainText("Microphone · not allowed");
    await expect(mic.getByRole("button", { name: "Allow…" })).toHaveCount(0);
    await mic.getByRole("button", { name: "Open System Settings…" }).click();
    if (FAKE) expect(await sent(page, "open_external")).toContainEqual({ target: { type: "system_settings", permission: "microphone" } }); // M1 command

    await steer.change((w) => W.permission(w, "microphone", "granted"));
    await expect(mic).toContainText("Granted");
    if (FAKE) await expect(mic).toContainText("Hearing you");
  });

  test("UI — error path: System audio not allowed — the how-to line, allowed in System Settings, Granted, Run Test ready", async ({ page }) => {
    const steer = await openWindow(page, "first-run", {
      world: (w) => (W.firstRun(w), W.permission(w, "microphone", "granted"), W.permission(w, "system_audio", "denied")),
    });
    const sys = permissionRow(page, "System audio recording");

    await expect(sys).toContainText("not allowed");
    await expect(sys).toContainText("System Settings › Privacy & Security");
    await expect(selfTest(page)).toContainText("System audio recording is not allowed yet.");
    await expect(button(page, "Run Test")).toBeDisabled();
    await expect(button(page, "Play Test Clip")).toBeDisabled();

    await steer.change((w) => W.permission(w, "system_audio", "granted"));
    await expect(sys).toContainText("Granted");
    await expect(selfTest(page)).not.toContainText("System audio recording is not allowed yet.");
    await expect(button(page, "Run Test")).toBeEnabled();
  });

  test("UI — error path: Self-test hears only one stream — the hint, Run Test again, passed", async ({ page }) => {
    const steer = await openWindow(page, "first-run", { world: (w) => (W.firstRun(w), audioGranted(w)) });

    await button(page, "Run Test").click();
    await expect.poll(async () => (await sent(page, "self_test_run")).length).toBe(1);
    await steer.push("self_test_run", { event: { type: "levels", mic_db: -30, sys_db: null } });
    await steer.push("self_test_run", { event: { type: "failed", reason: { type: "one_stream_silent", channel: "sys" } } });
    await steer.push("self_test_run", { event: { type: "ended", reason: "call_stopped" } });
    await expect(selfTest(page)).toContainText("We hear your microphone but not system audio. Play any sound in another app and try again.");
    await expect(selfTest(page).getByRole("status")).toHaveCount(0); // not passed

    await button(page, "Run Test").click(); // after playing a sound in another app
    await expect(selfTest(page).getByRole("status")).toContainText("Self-test passed");
    await expect(selfTest(page)).not.toContainText("We hear your microphone but not system audio.");
  });

  test("UI — empty path: Self-test skipped — Skip for Now marks Permissions with a dash and moves on", async ({ page }) => {
    await openWindow(page, "first-run", { world: (w) => (W.firstRun(w), audioGranted(w)) });

    await button(page, "Skip for Now").click();
    expect(await sent(page, "setup_set_step")).toContainEqual({ step: "permissions", state: "skipped" });
    await expect(step(page, "Permissions")).toHaveAttribute("data-state", "skipped");
    await expect(step(page, "Permissions")).toContainText("Skipped"); // read as Skipped
    await expect(step(page, "Call display")).toHaveAttribute("aria-current", "step");
    // The banner after Finish is the main window's: m0-main-window-shell.spec.ts.
  });
});

test.describe("cpt-noter-seq-first-run-download-models", () => {
  test("UI — happy path: the bundles with size and progress, About 2 GB, Pause and Resume, Continue at once, ring on Models", async ({ page }) => {
    let bundles: ModelBundle[] = [];
    await openWindow(page, "first-run", { world: (w) => (W.firstRun(w, { modelsReady: false }), (bundles = structuredClone(w.app.setup.models.bundles))) });

    await expect(step(page, "Models")).toHaveAttribute("aria-current", "step");
    for (const b of bundles) await expect(stepBody(page)).toContainText(b.name);
    await expect(stepBody(page).getByRole("progressbar")).toHaveCount(bundles.length);
    await expect(stepBody(page)).toContainText(/About \d+ GB/);
    await expect.poll(() => sent(page, "models_download")).toContainEqual({ action: "start" });

    await button(page, "Pause").click();
    expect(await sent(page, "models_download")).toContainEqual({ action: "pause" });
    await button(page, "Resume").click();
    expect(await sent(page, "models_download")).toContainEqual({ action: "resume" });

    await expect(button(page, "Continue")).toBeEnabled(); // at once, downloads go on
    await button(page, "Continue").click();
    expect(await sent(page, "setup_set_step")).toContainEqual({ step: "models", state: "done" });
    await expect(step(page, "Permissions")).toHaveAttribute("aria-current", "step");
    // The ring while downloading in the background, then done once every bundle is in.
    await expect(step(page, "Models")).toHaveAttribute("data-state", /running|done/);
    await expect(step(page, "Models")).toHaveAttribute("data-state", "done", { timeout: 15_000 });
  });

  test("UI — error path: No connection — Waiting for a connection, Continue, the line goes once online", async ({ page }) => {
    const steer = await openWindow(page, "first-run", { world: (w) => (W.firstRun(w, { modelsReady: false }), (w.app.environment.online = false)) });
    const waiting = stepBody(page).getByText("Waiting for a connection — downloads resume automatically");

    await expect(waiting).toBeVisible();
    await expect(button(page, "Continue")).toBeEnabled(); // nothing to do

    await steer.change((w) => (w.app.environment.online = true));
    await expect(waiting).toHaveCount(0);
  });

  test("UI — error path: Not enough disk space — Needs 2.1 GB, 1.4 GB free, Try Again starts the downloads", async ({ page }) => {
    const steer = await openWindow(page, "first-run", { world: (w) => W.firstRun(w, { modelsReady: false }) });
    await expect(step(page, "Models")).toHaveAttribute("aria-current", "step");
    await button(page, "Pause").click();
    await steer.failNext("models_download", "disk_full", { type: "disk_space", free_mb: 1400, needed_mb: 2100 });
    await button(page, "Resume").click(); // the disk is full now

    const banner = stepBody(page).getByRole("alert").filter({ hasText: "Needs 2.1 GB, 1.4 GB free" });
    await expect(banner).toBeVisible();
    await expect(button(page, "Pause")).toHaveCount(0);
    await expect(button(page, "Resume")).toHaveCount(0);
    await banner.getByRole("button", { name: "Try Again" }).click(); // after freeing space in Finder
    await expect(banner).toHaveCount(0);
    expect((await sent(page, "models_download")).at(-1)).toMatchObject({ action: expect.stringMatching(/start|retry/) });
  });

  test("UI — error path: Download failed its check — Check failed and Try Again on the row, error glyph on Models", async ({ page }) => {
    await openWindow(page, "first-run", { world: (w) => W.firstRun(w, { modelsReady: false }), corruptNextDownload: true }); // the window's own download fails its check once

    await expect(stepBody(page)).toContainText("Check failed");
    await button(page, "Continue").click(); // moving on shows the error glyph on Models
    await expect(step(page, "Models")).toHaveAttribute("data-state", "error");

    await step(page, "Models").getByRole("button").click(); // a failed step is clickable
    await expect(step(page, "Models")).toHaveAttribute("aria-current", "step");
    await stepBody(page).getByRole("button", { name: "Try Again" }).click();
    expect(await sent(page, "models_download")).toContainEqual({ action: "retry" });
    await expect(stepBody(page)).not.toContainText("Check failed");
  });

  test("UI — error path: Speech model not downloaded yet — Waiting for the speech model, then the test runs by itself", async ({ page }) => {
    await openWindow(page, "first-run", {
      world: (w) => {
        W.firstRun(w, { modelsReady: false });
        audioGranted(w); // the window starts the download itself; the speech model is still coming in
        w.app.setup.steps.find((s) => s.step === "models")!.state = "done";
      },
    });

    await expect(selfTest(page)).toContainText(/Waiting for the speech model · \d+ %/);
    await expect(button(page, "Run Test")).toBeDisabled();
    await expect(selfTest(page).getByRole("status")).toContainText("Self-test passed", { timeout: 15_000 }); // runs by itself once the model is in
  });
});
