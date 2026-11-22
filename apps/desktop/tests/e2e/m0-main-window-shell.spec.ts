// M0 — Main window shell (docs/features/ui/main-window-shell.md, DESIGN.md › Shell — Main window, MW-R1..R5).
// The shell has no story of its own; it shows the app banner of `cpt-noter-seq-first-run-complete-setup`
// (Empty — Self-test skipped) and carries the keyboard-only pass across sections that
// accessibility-l10n asks of every screen. Written before the shell exists (tests first): they fail
// until the main-window-shell feature lands, and its PR carries them. Markup follows the prototype
// (05-shell.js): the sidebar is MW-R2 with `aria-current="page"` on the selected section, the banner
// slot is MW-R5, the page is MW-R3.
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { coreReady, openWindow, steerFor } from "./support/app";
import { expect, test } from "./support/fixtures";

const BANNER = "Call detection is off until the audio self-test passes";
const sidebar = (page: Page) => page.locator('[data-region="MW-R2"]');
const section = (page: Page, label: string) => sidebar(page).getByRole("listitem").filter({ hasText: label });
const content = (page: Page) => page.locator('[data-region="MW-R3"]');

test.describe("cpt-noter-seq-first-run-complete-setup", () => {
  test("UI — empty path: Self-test skipped — the app banner with Run Audio Self-Test… and Finish Setup…, gone once the test passes", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: (w) => (W.idle(w), W.selfTestSkipped(w)) });

    const banner = page.locator('[data-region="MW-R5"], [data-region="TD-R2"]').filter({ hasText: BANNER });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: "Run Audio Self-Test…" })).toBeVisible();
    await expect(banner.getByRole("link", { name: "Finish Setup…" }).or(banner.getByRole("button", { name: "Finish Setup…" }))).toBeVisible();

    // The self-test passes (from the sheet or Settings): the core switches detection on and the banner goes.
    await steer.change((w) => {
      w.app.setup.self_test = { type: "passed", at: Date.now() };
      w.app.setup.detection_enabled = true;
    });
    await expect(page.getByText(BANNER)).toHaveCount(0);
  });
});

test.describe("cpt-noter-flow-ui-main-window-shell-navigate", () => {
  // #1044, owner decision 21 Nov (no DESIGN story yet): choosing the section in view, by its key or its sidebar item,
  // goes to the section's root list as a new entry, so Back returns to the page that was pushed
  test("UI — other path: ⌘3 and the Calls item on a call page return to the Calls list, and Back to the page", async ({ page }) => {
    await openWindow(page, "main", { world: () => {} });
    const calls = page.getByRole("heading", { name: "Calls", level: 1 });
    const callPage = page.locator('[data-region="PC-R1"]');
    const openPast = async () => {
      await coreReady(page);
      await steerFor(page).invoke("window_navigate", { target: { type: "call_page", call_id: W.PAST_CALL, tab: "transcript" } });
      await expect(callPage).toContainText("Backend sync");
    };
    await expect(async () => {
      await page.keyboard.press("Meta+Digit3");
      await expect(calls).toBeVisible({ timeout: 1000 });
    }).toPass();
    await openPast();
    await page.keyboard.press("Meta+Digit3");
    await expect(calls).toBeVisible();
    await page.keyboard.press("Meta+BracketLeft");
    await expect(callPage).toContainText("Backend sync");
    await section(page, "Calls").click();
    await expect(calls).toBeVisible();
  });

  test("UI — keyboard only: ⌘3 opens Calls with focus on its heading, ⌘[ goes back, Back is disabled at the start", async ({ page }) => {
    await openWindow(page, "main");
    await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
    await expect(page.getByRole("button", { name: "Back" })).toBeDisabled();
    const start = await sidebar(page).locator('[aria-current="page"]').innerText();

    await page.keyboard.press("Meta+Digit3");
    await expect(section(page, "Calls")).toHaveAttribute("aria-current", "page");
    await expect(content(page).getByRole("heading").first()).toBeFocused();
    await expect(content(page)).toContainText("Calls"); // a section not shipped yet shows an empty state naming it, never a blank area

    await page.keyboard.press("Meta+BracketLeft");
    await expect(sidebar(page).locator('[aria-current="page"]')).toHaveText(start);
    await expect(page.getByRole("button", { name: "Forward" })).toBeEnabled();
  });

  test("UI — keyboard only: Tab moves through the sidebar, toolbar and page without a trap", async ({ page }) => {
    await openWindow(page, "main");
    await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      seen.add(await page.evaluate(() => document.activeElement?.closest("[data-region]")?.getAttribute("data-region") ?? ""));
    }
    expect([...seen]).toEqual(expect.arrayContaining(["MW-R2", "MW-R3"]));
  });
});

// The sidebar's live row counts from each capture state it receives; these prove the real core keeps that state's
// recorded time current. The fake core keeps a fixed `recorded_ms` (it models no recorded time), so only the real core
// is held to the clock.
test.describe("cpt-noter-seq-menu-bar-control-recording", () => {
  const REAL = process.env.NOTER_CORE === "stdio";
  const liveClock = (page: Page) => sidebar(page).locator('[data-variant="live-row"] .np-tnum');
  const liveSeconds = async (page: Page) => {
    const text = await liveClock(page).innerText();
    return text.split(":").map(Number).reduce((total, n) => total * 60 + n, 0);
  };
  /** Three seconds of the core's (real) time, while the page's own clock may stand still. */
  const coreRuns3s = async () => {
    const t0 = Date.now();
    await expect.poll(() => Date.now() - t0, { intervals: [500], timeout: 10_000 }).toBeGreaterThanOrEqual(3000);
  };

  // #1043: a capture change other than pause or resume (here Sensitive) carries the time recorded so far; the page
  // clock stands still, so only the new state can move the live row forward, and a stale one moves it back
  test("UI — other path: making the live call sensitive keeps the recording clock running", async ({ page }) => {
    await page.clock.install();
    const steer = await openWindow(page, "main", { world: () => {} });
    await expect(liveClock(page)).toBeVisible();
    await page.clock.pauseAt(Date.now() + 1000);
    const before = await liveSeconds(page);
    await coreRuns3s();
    await steer.invoke("capture_set_sensitive", { call_id: W.LIVE_CALL, sensitive: true }, "call-screen");
    if (REAL) await expect.poll(() => liveSeconds(page), { message: "the clock did not fall back to the last pause" }).toBeGreaterThanOrEqual(before + 2);
    else await expect(liveClock(page)).toBeVisible();
  });

  // #1048: a reloaded window (the WebContent watchdog) reads the time recorded up to now from its snapshot
  test("UI — error path: a reloaded window keeps the recording clock", async ({ page }) => {
    await openWindow(page, "main", { world: () => {} });
    const first = await liveSeconds(page);
    await expect.poll(() => liveSeconds(page), { timeout: 10_000 }).toBeGreaterThanOrEqual(first + 3);
    const before = await liveSeconds(page);
    await page.reload();
    await expect(liveClock(page)).toBeVisible();
    if (REAL) expect(await liveSeconds(page), "the clock did not restart from the last capture event").toBeGreaterThanOrEqual(before);
  });
});
