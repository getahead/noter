// Screenshot specs of the record prompt (docs/features/ui/record-prompt.md › Definitions of Done): one per prototype
// `RP_STATES` entry, rendered against the fake core in the panel's own window. Baselines come from the
// update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";

const panel = (page: Page) => page.locator('[data-component="cpt-noter-component-ui-record-prompt"]');
const detected = (more: (w: World) => void = () => {}) => (w: World) => {
  W.idle(w);
  w.app.setup.self_test = { type: "passed", at: 1 };
  W.detect(w, W.APPS.teams);
  more(w);
};
async function shot(page: Page, name: string, world: (w: World) => void) {
  await openWindow(page, "record-prompt", { world });
  await expect(panel(page)).toBeVisible();
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`, { mask: [page.locator(".np-tnum")] });
}

test.describe("cpt-noter-dod-ui-record-prompt-panel record prompt", () => {
  test("default", ({ page }) => shot(page, "default", detected()));
  test("event: the matched calendar event is the source line", ({ page }) =>
    shot(page, "event", detected((w) => (w.app.detection.detection!.matched_event = { id: "evt", title: W.LIVE_TITLE, starts_at: 0, ends_at: 1 }))));
  test("disk-full", ({ page }) =>
    shot(page, "disk-full", detected((w) => ((w.app.detection.detection!.blocked = "disk_full"), (w.app.environment.disk_free_mb = 420)))));
  test("system-audio-off", ({ page }) => shot(page, "system-audio-off", detected((w) => W.permission(w, "system_audio", "denied"))));
  test("model-missing", ({ page }) =>
    shot(page, "model-missing", detected((w) => {
      w.app.detection.detection!.blocked = "model_missing";
      Object.assign(W.speechModel(w), { state: "downloading", size_mb: 1000, done_mb: 620 });
    })));
  test("not-a-call: the inline confirmation", async ({ page }) => {
    await openWindow(page, "record-prompt", { world: detected() });
    await page.getByRole("button", { name: /^Not Now/ }).click();
    await page.getByRole("menuitem", { name: /^Don't Ask for/ }).click();
    await expect(panel(page)).toHaveAttribute("data-state", "not-a-call");
    await expect(page).toHaveScreenshot("not-a-call.png");
  });
  test("call-ended", ({ page }) =>
    shot(page, "call-ended", (w) => {
      W.notice(w, { type: "call_ended", stops_at: Date.now() + 600_000 });
    }));
  test("new-meeting", ({ page }) =>
    shot(page, "new-meeting", (w) => {
      W.notice(w, { type: "new_meeting", event: { id: "e", title: "1:1 with Anna K.", starts_at: 0, ends_at: 1 }, app_name: "Microsoft Teams", detected_at: Date.now(), expires_at: Date.now() + 60_000, default_choice: "start_as_new_call" });
    }));
});
