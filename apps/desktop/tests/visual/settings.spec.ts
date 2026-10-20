// Screenshot specs of the Settings window (docs/features/ui/settings.md › Definitions of Done): every pane,
// and the prototype's Settings › State ▾ states, rendered against the fake core. Baselines come from the
// update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import type { SettingsPane } from "../../src/core/bindings";
import { openWindow, type CorePlan } from "../e2e/support/app";

const PANES: [SettingsPane, string][] = [
  ["general", "General"],
  ["audio_and_transcription", "Audio & Transcription"],
  ["models_and_runtimes", "Models & Runtimes"],
  ["privacy", "Privacy"],
  ["call_screen_and_menu_bar", "Call Screen & Menu Bar"],
  ["hotkeys", "Hotkeys"],
  ["repositories", "Repositories"],
  ["knowledge_sources", "Knowledge Sources"],
  ["maintenance", "Maintenance"],
  ["performance", "Performance"],
  ["updates", "Updates"],
];
const title = (id: SettingsPane) => PANES.find(([p]) => p === id)![1];

async function show(page: Page, pane: SettingsPane, plan: CorePlan = {}) {
  const steer = await openWindow(page, "settings", plan);
  const nav = page.getByRole("navigation", { name: "Settings panes" });
  await nav.getByRole("listitem").filter({ hasText: title(pane) }).first().click();
  await expect(page.locator('[data-region="ST-R2"]').getByRole("heading", { name: title(pane), exact: true })).toBeVisible();
  return steer;
}
const shot = (page: Page, name: string) => expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });

for (const [pane] of PANES) {
  test(`pane ${pane}`, async ({ page }) => {
    await show(page, pane);
    await shot(page, `pane-${pane}`);
  });
}

test.describe("states of the prototype's Settings › State menu", () => {
  test("self-test: Needs a passed audio self-test", async ({ page }) => {
    await show(page, "general", { world: (w) => (w.app.setup.self_test = { type: "not_run" }) });
    await shot(page, "self-test");
  });

  test("notifications-off", async ({ page }) => {
    await show(page, "general", { world: (w) => (w.settings.general.notifications_enabled = false) });
    await shot(page, "notifications-off");
  });

  test("icloud: storage folder in iCloud Drive", async ({ page }) => {
    await show(page, "general", {
      world: (w) => Object.assign(w.settings.general, { storage_in_cloud_folder: true, storage_path: "~/Library/Mobile Documents/com~apple~CloudDocs/Noter" }),
    });
    await shot(page, "icloud");
  });

  test("model-downloading", async ({ page }) => {
    await show(page, "audio_and_transcription", {
      // an in-progress amount below the bundle's own size, never a fixed number
      world: (w) => {
        const b = w.app.setup.models.bundles[0]!;
        Object.assign(b, { state: "downloading", done_mb: Math.round(b.size_mb * 0.68) });
      },
    });
    const progress = page.getByText(/^Downloading [\d,]+ of [\d,]+ MB$/);
    await progress.scrollIntoViewIfNeeded();
    await expect(progress).toBeVisible();
    await shot(page, "model-downloading");
  });

  test("update-ready", async ({ page }) => {
    await show(page, "updates", { world: (w) => (w.app.environment.update = { version: "1.2", notes_md: "", ready: true }) });
    await shot(page, "update-ready");
  });

  test("no-match: No settings match “zoom calls”", async ({ page }) => {
    await openWindow(page, "settings");
    await page.getByRole("navigation", { name: "Settings panes" }).getByPlaceholder("Search").fill("zoom calls");
    await shot(page, "no-match");
  });

  test("hk-voiceover: Used by VoiceOver", async ({ page }) => {
    const steer = await show(page, "hotkeys");
    await steer.failNext("hotkey_set", "hotkey_reserved", { type: "hotkey_owner", owner: "VoiceOver" });
    await page.getByRole("button", { name: /^Catch me up: / }).click();
    await page.keyboard.press("Control+Alt+Meta+KeyH");
    await expect(page.getByText("Used by VoiceOver")).toBeVisible();
    await shot(page, "hk-voiceover");
  });

  test("hk-nomod: Add Command, Option or Control", async ({ page }) => {
    await show(page, "hotkeys");
    await page.getByRole("button", { name: /^Mark moment: / }).click();
    await page.keyboard.press("KeyN");
    await expect(page.getByText("Add Command, Option or Control")).toBeVisible();
    await shot(page, "hk-nomod");
  });

  test("hk-card-conflict: Card key used by another app", async ({ page }) => {
    await show(page, "hotkeys", { world: (w) => (w.copilot.card_keys.conflicts = ["Ctrl+Alt+Super+3"]) });
    await expect(page.getByText(/is used by another app/)).toBeVisible();
    await shot(page, "hk-card-conflict");
  });

  test("share-test sheet", async ({ page }) => {
    await show(page, "privacy", { world: (w) => (w.app.capture.phase = "idle") });
    await page.getByRole("button", { name: "Screen Share Test…" }).click();
    await expect(page.getByRole("dialog", { name: "Screen Share Test" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Call window" })).toBeVisible();
    await shot(page, "share-test");
  });

  test("share-test sheet: capture test ran, with Screen Recording granted", async ({ page }) => {
    await show(page, "privacy", { world: (w) => ((w.app.capture.phase = "idle"), w.app.environment.permissions.forEach((p) => p.kind === "screen_recording" && (p.state = "granted"))) });
    await page.getByRole("button", { name: "Screen Share Test…" }).click();
    await page.getByRole("button", { name: "Run Capture Test" }).click();
    await expect(page.getByText("On your screen")).toBeVisible();
    await shot(page, "share-test-ran");
  });

  test("share-test sheet: Screen Recording asked once", async ({ page }) => {
    await show(page, "privacy", { world: (w) => ((w.app.capture.phase = "idle"), w.app.environment.permissions.forEach((p) => p.kind === "screen_recording" && (p.state = "not_asked"))) });
    await page.getByRole("button", { name: "Screen Share Test…" }).click();
    await page.getByRole("button", { name: "Run Capture Test" }).click();
    await expect(page.getByText("Screen Recording · needed for this test only")).toBeVisible();
    await shot(page, "share-test-asking");
  });

  test("share-test sheet: during a call", async ({ page }) => {
    await show(page, "privacy", { world: (w) => (w.app.capture.phase = "recording") });
    await page.getByRole("button", { name: "Screen Share Test…" }).click();
    await expect(page.getByText("Run the test when no call is being recorded.")).toBeVisible();
    await shot(page, "share-test-during-call");
  });
});
