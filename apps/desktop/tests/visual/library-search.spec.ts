// Library › Search results (cpt-noter-dod-ui-library-search-topics-search): results, weak matches, only weak, no
// matches, keyword-only, failed, the cross-language tag and the # tag suggestions, against the fake core. The fake's
// `search` is shaped in the page the way handoff.spec.ts shapes `handoff_get` (a visual fixture, no contract change).
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import * as W from "../support/world-presets";
import { settled } from "./freeze";

const WIDTHS = { wide: 1400, narrow: 700 } as const;
type Hit = { strength?: "strong" | "weak"; cross_language?: boolean };
type Shape = { mode?: unknown; only_weak?: boolean; weak?: boolean; cross?: boolean; none?: boolean; fail?: boolean };
type Fake = { invoke(cmd: string, args: unknown): Promise<unknown> };

/** Rewrites what the fake's `search` answers, after the fake computed it. */
async function shapeSearch(page: Page, s: Shape) {
  await page.evaluate((shape: Shape) => {
    const fake = (globalThis as unknown as { __noterFake: Fake }).__noterFake;
    const invoke = fake.invoke.bind(fake);
    fake.invoke = async (cmd, args) => {
      if (cmd === "search" && shape.fail) throw Object.assign(new Error("search failed"), { code: "internal" });
      const v = (await invoke(cmd, args)) as { calls: Hit[]; items: Hit[]; documents: unknown[]; mode: unknown; only_weak: boolean; topics: unknown[] };
      if (cmd !== "search") return v;
      if (shape.none) return { ...v, calls: [], items: [], documents: [], topics: [] };
      const weaken = (h: Hit, i: number): Hit => ({ ...h, strength: shape.only_weak || (shape.weak && i > 0) ? "weak" : h.strength, cross_language: shape.cross ? i === 0 : h.cross_language });
      return { ...v, calls: v.calls.map(weaken), items: v.items.map(weaken), mode: shape.mode ?? v.mode, only_weak: !!shape.only_weak };
    };
  }, s);
}

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await openWindow(page, "main", { world: (w) => (W.idle(w), (w.app.setup.self_test = { type: "passed", at: 1 })) });
  await page.waitForFunction(() => typeof (globalThis as unknown as { __noterFake?: Fake }).__noterFake?.invoke === "function");
}
/** At Wide the field is always there; below that a Search button opens it. */
async function focusSearch(page: Page) {
  const field = page.getByRole("searchbox", { name: /Search/ });
  await expect(field.or(page.getByRole("button", { name: "Search", exact: true })).first()).toBeVisible();
  if (!(await field.isVisible())) await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(field).toBeVisible();
}
async function search(page: Page, width: number, shape: Shape, words = "drawer") {
  await open(page, width);
  await shapeSearch(page, shape);
  await focusSearch(page);
  const field = page.getByRole("searchbox", { name: /Search/ });
  await field.fill(words);
  await field.press("Enter");
  await expect(page.getByRole("heading", { name: "Search results" }).first()).toBeVisible();
}
const shot = async (page: Page, name: string, width: string) => {
  await page.mouse.move(0, 0);
  await settled(page);
  await expect(page).toHaveScreenshot(`${name}-${width}.png`);
};

for (const [width, px] of Object.entries(WIDTHS)) {
  test.describe(`cpt-noter-dod-ui-library-search-topics-search Search results at ${width}`, () => {
    test("results: items and transcripts", async ({ page }) => {
      await search(page, px, {});
      await shot(page, "search-results", width);
    });
    test("weak matches under the divider", async ({ page }) => {
      await search(page, px, { weak: true });
      await expect(page.getByText("Weaker matches")).toBeVisible();
      await shot(page, "search-weak", width);
    });
    test("only weak matches", async ({ page }) => {
      await search(page, px, { only_weak: true });
      await expect(page.getByText(/Only weak matches for/)).toBeVisible();
      await shot(page, "search-only-weak", width);
    });
    test("no matches", async ({ page }) => {
      await search(page, px, { none: true }, "zzyzx");
      await expect(page.getByText(/No matches for/)).toBeVisible();
      await shot(page, "search-none", width);
    });
    test("keyword only while the index is rebuilt", async ({ page }) => {
      await search(page, px, { mode: { type: "keyword_only", rebuild_progress: 0.64 } });
      await expect(page.getByText("Searching by keyword only while the index rebuilds · 64%")).toBeVisible();
      await shot(page, "search-keyword-only", width);
    });
    test("cross-language match tag", async ({ page }) => {
      await search(page, px, { cross: true });
      await expect(page.getByText("Cross-language match").first()).toBeVisible();
      await shot(page, "search-cross-language", width);
    });
    test("search failed", async ({ page }) => {
      await open(page, px);
      await shapeSearch(page, { fail: true });
      await focusSearch(page);
      const field = page.getByRole("searchbox", { name: /Search/ });
      await field.fill("drawer");
      await field.press("Enter");
      await expect(page.getByText("Couldn’t search your calls")).toBeVisible();
      await shot(page, "search-failed", width);
    });
  });
}

test("cpt-noter-dod-ui-library-search-topics-search # in the search field lists the tags", async ({ page }) => {
  await open(page, WIDTHS.wide);
  await focusSearch(page);
  await page.getByRole("searchbox", { name: /Search/ }).fill("#");
  await shot(page, "search-tag-suggest", "wide");
});
