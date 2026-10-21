// The first-run window (cpt-noter-component-screen-first-run) in every state of the prototype's FR_STATES that
// belongs to steps 1 to 5 (docs/features/ui/first-run.md § 6): the real window over the fake core, started from the
// world each state needs. Step 6's key states belong to cpt-noter-feature-ui-accounts.
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { openWindow } from "../e2e/support/app";

const STEPS = ["welcome", "models", "permissions", "call_display", "audio_storage", "assistants"];
/** Setup stopped at `step`: the steps before it are done. */
const at = (step: string) => (w: World) => w.app.setup.steps.forEach((s) => (s.state = STEPS.indexOf(s.step) < STEPS.indexOf(step) ? "done" : "todo"));
const granted = (w: World) => (W.permission(w, "microphone", "granted"), W.permission(w, "system_audio", "granted"));
const downloading = (w: World) => W.firstRun(w, { modelsReady: false });
/** The bundles part-way through, the speech model at 62 % as in the prototype. */
const partway = (w: World) => {
  const m = w.app.setup.models;
  m.bundles.forEach((b) => Object.assign(b, { state: "downloading", done_mb: Math.round(b.size_mb * (b.required_for_capture ? 0.62 : 0.4)) }));
  m.done_mb = m.bundles.reduce((n, b) => n + b.done_mb, 0);
};
const win = (page: Page) => page.locator('[data-component="cpt-noter-component-screen-first-run"]');

const states: { id: string; world: (w: World) => void; ready?: (page: Page) => Promise<void> }[] = [
  { id: "welcome", world: (w) => (W.firstRun(w), at("welcome")(w)) },
  { id: "models", world: (w) => (downloading(w), at("models")(w), partway(w)) },
  { id: "no-connection", world: (w) => (downloading(w), at("models")(w), (w.app.environment.online = false)) },
  {
    id: "disk",
    // the bundles are under way, so the window does not start the downloads and clear the error before the capture
    world: (w) => {
      downloading(w);
      at("models")(w);
      w.app.setup.models.bundles.forEach((b) => Object.assign(b, { state: "downloading", done_mb: 0 }));
      w.app.setup.models.error = "disk_full";
      w.app.environment.disk_free_mb = 1400;
    },
    ready: async (page) => {
      await expect(win(page).getByRole("alert").filter({ hasText: /Needs .* free/ })).toBeVisible();
      await expect(win(page).getByRole("button", { name: "Try Again" })).toBeVisible();
    },
  },
  {
    id: "checksum",
    // the other bundles are under way, so the window does not start the downloads again and the failed one stays failed
    world: (w) => (downloading(w), at("models")(w), w.app.setup.models.bundles.forEach((b, i) => Object.assign(b, { state: i === 0 ? "checksum_failed" : "downloading", done_mb: 0 }))),
    ready: async (page) => {
      await expect(win(page).getByText("Check failed")).toBeVisible();
      await expect(win(page).getByRole("button", { name: "Try Again" })).toBeVisible();
    },
  },
  { id: "speech-wait", world: (w) => (downloading(w), at("permissions")(w), granted(w), partway(w)) },
  { id: "perm-not-asked", world: (w) => (W.firstRun(w), at("permissions")(w)) },
  { id: "mic-denied", world: (w) => (W.firstRun(w), at("permissions")(w), W.permission(w, "microphone", "denied")) },
  { id: "sys-missing", world: (w) => (W.firstRun(w), at("permissions")(w), W.permission(w, "microphone", "granted")) },
  {
    id: "passed",
    world: (w) => (W.firstRun(w), at("permissions")(w), granted(w)),
    ready: async (page) => {
      await page.getByRole("button", { name: "Run Test", exact: true }).click();
      await expect(win(page).getByRole("status").filter({ hasText: "Self-test passed" })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("button", { name: "Run Test", exact: true })).toBeEnabled();
    },
  },
  { id: "skipped", world: (w) => (W.firstRun(w), at("call_display")(w), (w.app.setup.steps.find((s) => s.step === "permissions")!.state = "skipped")) },
  { id: "display", world: (w) => (W.firstRun(w), at("call_display")(w), granted(w)) },
  { id: "one-display", world: (w) => (W.firstRun(w), at("call_display")(w), granted(w), w.app.environment.displays.splice(1)) },
  { id: "storage", world: (w) => (W.firstRun(w), at("audio_storage")(w), granted(w)) },
  { id: "assistants", world: (w) => (W.firstRun(w), at("assistants")(w), granted(w)) },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`first-run window (${scheme})`, () => {
    test.use({ viewport: { width: 760, height: 560 }, colorScheme: scheme });
    for (const s of states) {
      test(`renders ${s.id}`, async ({ page }) => {
        await openWindow(page, "first-run", { world: s.world });
        await expect(win(page)).toBeVisible();
        await s.ready?.(page);
        // the window is the frame: 760 x 560, the footer at its bottom edge, and only the step scrolls
        const box = (await win(page).boundingBox())!;
        expect(box.height).toBe(560);
        const footer = (await page.locator('[data-region="FR-R3"]').boundingBox())!;
        expect(footer.y + footer.height).toBeCloseTo(560, 0);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await expect(win(page)).toHaveScreenshot(`first-run-${s.id}-${scheme}.png`);
      });
    }
  });
}

test.describe("first-run window states that need a step on the way", () => {
  test.use({ viewport: { width: 760, height: 560 } });

  test("renders one stream silent", async ({ page }) => {
    const steer = await openWindow(page, "first-run", { world: (w) => (W.firstRun(w), at("permissions")(w), granted(w)) });
    await page.getByRole("button", { name: "Run Test", exact: true }).click();
    await steer.push("self_test_run", { event: { type: "failed", reason: { type: "one_stream_silent", channel: "sys" } } });
    await steer.push("self_test_run", { event: { type: "ended", reason: "call_stopped" } });
    await expect(page.getByText("We hear your microphone but not system audio.")).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(win(page)).toHaveScreenshot("first-run-one-silent-light.png");
  });

  test("renders Back from System Settings (Checking…)", async ({ page }) => {
    await openWindow(page, "first-run", { world: (w) => (W.firstRun(w), at("permissions")(w), W.permission(w, "microphone", "granted")) });
    await page.locator('[data-component="cpt-noter-component-ui-permission-check-row"]').filter({ hasText: "System audio recording" }).getByRole("button", { name: "Open System Settings…" }).click();
    // the core is slow to answer: the row shows Checking… until it does
    await page.evaluate(() => {
      const fake = (globalThis as unknown as { __noterFake: { latency: number } }).__noterFake;
      fake.latency = 60_000;
      dispatchEvent(new Event("focus"));
    });
    await expect(page.getByText("Checking…").first()).toBeVisible();
    await expect(win(page)).toHaveScreenshot("first-run-checking-light.png");
  });
});
