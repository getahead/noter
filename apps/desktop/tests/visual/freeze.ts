// What moves a screenshot between two renders of the same page, held still: the page's clock (elapsed time,
// countdowns, "Stopped at hh:mm") and the fake core's random audio levels (the level meters).
import type { Page } from "@playwright/test";

/** 6 Nov 2026, 11:00 in the config's Europe/Berlin: the page's clock, and the base of every time the world is seeded with. */
export const NOW = Date.UTC(2026, 10, 6, 10, 0);

/** Freeze the page before it opens: `Date.now()` is always `NOW` (timers still run) and every meter level is the same. */
export async function freeze(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  // the fake core's levels_subscribe is the app's only Math.random: two draws a tick, counted for settled()
  await page.addInitScript(() => {
    const g = globalThis as unknown as { __noterLevelDraws: number };
    g.__noterLevelDraws = 0;
    Math.random = () => (g.__noterLevelDraws++, 0.5);
  });
}

/** Wait until the page is still: its fonts are in (no text captured mid-swap) and every levels subscription has had its
 *  first tick, which the fake core sends 100 ms after the window subscribes (before it, a meter is silent). */
export async function settled(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForFunction(() => {
    const g = globalThis as unknown as { __noterCalls?: { name: string }[]; __noterLevelDraws?: number };
    const subscriptions = (g.__noterCalls ?? []).filter((c) => c.name === "levels_subscribe").length;
    // two draws a tick, two ticks a subscription: enough even when one subscription opened a tick after another
    return (g.__noterLevelDraws ?? 0) >= 4 * subscriptions;
  });
}
