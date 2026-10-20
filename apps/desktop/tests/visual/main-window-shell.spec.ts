// Main window shell (cpt-noter-feature-ui-main-window-shell): idle, capturing, one banner, several banners, Narrow,
// the degraded footer and the pseudo-localised sidebar and toolbar, rendered against the fake core.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";

const ready = (page: Page) => expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
const passed = (w: World) => void (w.app.setup.self_test = { type: "passed", at: 1 });
const quitBanner = (w: World) => w.app.banners.banners.push({ type: "recording_interrupted_by_quit", call: { id: "call_x", title: "Planning: VHI 8.0 drawer redesign", started_at: 0, call_type: "x" } } as never);
const update = (w: World) => w.app.banners.banners.push({ type: "update_ready", version: "1.2" });

async function shot(page: Page, name: string, world: (w: World) => void, query = "") {
  await openWindow(page, `main${query}`, { world });
  await ready(page);
  await expect(page.locator('[data-component="cpt-noter-component-shell-main-window"]')).toBeVisible();
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`, { mask: [page.locator(".np-recind .np-tnum")] });
}

test.describe("cpt-noter-dod-ui-main-window-shell-frame main window", () => {
  test("idle", async ({ page }) => shot(page, "idle", (w) => (W.idle(w), passed(w))));

  test("idle, dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await shot(page, "idle-dark", (w) => (W.idle(w), passed(w)));
  });

  test("capturing: the live-call row and the Recording footer", async ({ page }) => {
    await shot(page, "capturing", (w) => {
      passed(w);
      w.app.capture.phase = "recording";
    });
  });

  test("paused: Paused instead of the time", async ({ page }) => {
    await shot(page, "paused", (w) => {
      passed(w);
      w.app.capture.phase = "paused";
    });
  });

  test("one banner: the self-test notice", async ({ page }) => {
    await shot(page, "banner", (w) => (W.idle(w), W.selfTestSkipped(w)));
  });

  test("several banners: the most severe shows with +2 More", async ({ page }) => {
    await shot(page, "banners", (w) => (W.idle(w), W.selfTestSkipped(w), update(w), quitBanner(w)));
  });

  test("No assistant: the footer in the warning form", async ({ page }) => {
    await shot(page, "no-assistant", (w) => (W.idle(w), passed(w), W.degrade(w, { type: "no_assistant" } as never)));
  });

  test("Narrow: the sidebar collapsed, the search an icon", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 700 });
    await shot(page, "narrow", (w) => (W.idle(w), passed(w)));
  });
});

for (const mode of ["cyrillic", "german"] as const) {
  test(`cpt-noter-dod-ui-main-window-shell-collapse: no sidebar label or toolbar button truncates (${mode} pseudo-localisation)`, async ({ page }) => {
    await shot(page, `pseudo-${mode}`, (w) => (W.idle(w), passed(w)), `&pseudo=${mode}`);
    const clipped = await page.$$eval('[data-region="MW-R2"] [role="listitem"], [data-region="MW-R2"] .np-srclist__group, [data-region="MW-R1"] button', (els) =>
      els.filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).map((el) => (el.textContent ?? "").trim() || el.getAttribute("aria-label") || el.tagName),
    );
    expect(clipped, `truncated: ${clipped.join(", ")}`).toEqual([]);
  });
}
