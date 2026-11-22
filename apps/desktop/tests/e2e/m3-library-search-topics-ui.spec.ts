// M3 — Library: filter and tag calls (docs/features/ui/library-search-topics.md; DESIGN.md story cpt-noter-seq-library-filter-calls).
// Real-core flows; copy is DESIGN's. The world fixture is smaller than DESIGN's (2 calls, one person per call): counts are read from
// the core's own rows, never DESIGN's 8 / 31. The search and topic stories are in m3-library-search-ui.spec.ts.
import type { Page } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";

const ROW = '[data-component="cpt-noter-component-ui-call-row"][data-variant="table-row"]';
const button = (page: Page, name: string | RegExp) => page.getByRole("button", { name });

async function openMain(page: Page, key: string, heading: string, world: (w: World) => void = W.idle) {
  const steer = await openWindow(page, "main", { world });
  await expect(async () => {
    await page.keyboard.press(key);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  return steer;
}
const openCalls = (page: Page, world?: (w: World) => void) => openMain(page, "Meta+Digit3", "Calls", world);

test.describe("cpt-noter-seq-library-filter-calls", () => {
  test("UI — happy path: People Anna K. plus Has Open Items reads calls_list with that filter and counts the matches; two selected rows count as selected", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    await openCalls(page);
    await button(page, /^People/).click();
    await page.getByRole("checkbox", { name: "Anna Kuznetsova" }).check({ force: true }); // the People pop-up lists one checkbox per person
    await button(page, "Has Open Items").click();
    await expect.poll(async () => (await sent(page, "calls_list")).at(-1)).toMatchObject({ filter: { people: ["per_anna"], has_open_items: true } });
    await expect(page.getByText(/\d+ calls? match/).first()).toBeVisible(); // the header and its live region both say it
    // the world has one call with Anna: the bar's Clear brings both calls back to select two of them
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    const rows = page.locator(ROW);
    await rows.first().click();
    await rows.nth(1).click({ modifiers: ["Meta"] });
    await expect(page.getByText(/2 selected/).first()).toBeVisible();
    await button(page, "Export…").click();
    await expect(page.getByRole("dialog")).toContainText(/Summary and items/);
  });

  // #1053: a call still recording has nothing to export yet; Export… says so instead of opening a sheet the core refuses
  test("UI — other path: Export… stays disabled while only calls still recording are selected, with the reason", async ({ page }) => {
    await openCalls(page, () => {}); // the fixture world: the planning call is still recording
    const rows = page.locator(ROW);
    await rows.filter({ hasText: W.LIVE_TITLE }).click();
    const exportButton = button(page, "Export…");
    await expect(exportButton).toBeDisabled();
    await expect(exportButton).toHaveAccessibleDescription("Nothing to export yet: the selected calls are still recording");
    await page.keyboard.press("Meta+KeyE");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await rows.filter({ hasNotText: W.LIVE_TITLE }).first().click({ modifiers: ["Meta"] });
    await expect(exportButton).toBeEnabled(); // a finished call in the selection can be exported
  });

  test("UI — empty path: filters that match nothing show No calls match these filters, Clear Filters brings every call back", async ({ page }) => {
    await openCalls(page);
    await button(page, /^People/).click();
    await page.getByRole("checkbox", { name: "Lena Krüger" }).check({ force: true }); // Lena is on no call
    await expect(page.getByText("No calls match these filters")).toBeVisible();
    await button(page, "Clear Filters").first().click(); // the filter bar's, and the empty state's
    await expect(page.locator(ROW)).toHaveCount(2);
  });

  test("UI — empty path: Tags says No tags yet while no call has one, and lists the tags in use otherwise", async ({ page }) => {
    await openCalls(page, (w) => {
      W.idle(w);
      for (const c of [...w.calls, ...w.call_details.map((d) => d.call)]) c.tags = [];
    });
    await button(page, /^Tags/).click();
    await expect(page.getByText(/No tags yet\. Add tags in a call.s Call info\./)).toBeVisible();
  });

  test("UI — #1054: Add Tag… with “release, hotfix” adds both tags in one call_tags_set, the strip names both and one Undo takes both back", async ({ page }) => {
    await openCalls(page);
    const rows = page.locator(ROW);
    await rows.first().click();
    await rows.nth(1).click({ modifiers: ["Meta"] });
    await rows.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add Tag…" }).click();
    const pop = page.getByRole("dialog", { name: "Add tag to 2 calls" });
    await pop.getByRole("searchbox", { name: "Add tag…" }).fill("release, hotfix");
    await page.keyboard.press("Enter");
    expect(await sent(page, "call_tags_set")).toEqual([expect.objectContaining({ add: ["release", "hotfix"] })]);
    await expect(page.getByText("Tagged 2 calls “release”, “hotfix”")).toBeVisible();
    // a row shows its first tags and folds the rest into a "+N" chip named by them
    const tagged = (tag: string) => rows.filter({ has: page.getByText(tag, { exact: true }).or(page.getByTitle(tag, { exact: true })) });
    await expect(tagged("release")).toHaveCount(2);
    await expect(tagged("hotfix")).toHaveCount(2);
    await button(page, "Undo").click();
    expect(await sent(page, "change_undo")).toHaveLength(1);
    await expect(tagged("release")).toHaveCount(0);
    await expect(tagged("hotfix")).toHaveCount(0);
  });

  test("UI — #1055: the Type column names call types as DESIGN writes them (Cross-team), the same as the Type filter", async ({ page }) => {
    await openCalls(page);
    await expect(page.locator(ROW).filter({ hasText: "Backend sync" }).locator(".lb-crow__type")).toHaveText("Cross-team");
    await button(page, /^Type/).click();
    await expect(page.getByRole("checkbox", { name: "Cross-team" })).toBeAttached();
    await expect(page.getByRole("checkbox", { name: "1:1" })).toBeAttached();
  });

  test("UI — other path: Add Tag… on two selected calls tags both with one call_tags_set, shows Tagged 2 calls “release” · Undo, # offers release and filters to the tagged calls", async ({ page }) => {
    await openCalls(page);
    const rows = page.locator(ROW);
    await rows.first().click();
    await rows.nth(1).click({ modifiers: ["Meta"] });
    await rows.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Add Tag…" }).click();
    const pop = page.getByRole("dialog", { name: "Add tag to 2 calls" });
    await pop.getByRole("searchbox", { name: "Add tag…" }).fill("release");
    await page.keyboard.press("Enter");
    expect(await sent(page, "call_tags_set")).toEqual([expect.objectContaining({ add: ["release"] })]);
    await expect(page.getByText("Tagged 2 calls “release”")).toBeVisible();
    await expect(rows.filter({ hasText: "release" })).toHaveCount(2);

    await button(page, "Undo").click();
    expect(await sent(page, "change_undo")).toHaveLength(1);
    await expect(rows.filter({ hasText: "release" })).toHaveCount(0);
  });
});

// Design fixes against the prototype of record (docs/prototype/clickable, Main window › Calls, State ▾ Normal).
test.describe("cpt-noter-seq-library-filter-calls", () => {
  const openFixed = async (page: Page) => {
    await openWindow(page, "main", { world: W.idle, fixedClock: true });
    await expect(async () => {
      await page.keyboard.press("Meta+Digit3");
      await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible({ timeout: 1000 });
    }).toPass();
  };
  test("UI — design — #1077 the counts are the toolbar subtitle, with no header in the content", async ({ page }) => {
    await openFixed(page);
    await expect(page.locator('[data-region="LC-R1"]')).toHaveCount(1);
    await expect(page.locator('[data-region="LC-R1"] .np-toolbar__sub')).toHaveText(/^\d+ calls? · /);
    await expect(page.locator(".np-content .lb-head")).toHaveCount(0);
  });
  test("UI — design — #1078 the filter bar is the 36-pt bar under the toolbar with capsule ˅ buttons and a disabled Clear", async ({ page }) => {
    await openFixed(page);
    const bar = page.locator('[data-region="LC-R2"]');
    const content = await page.locator(".np-content").boundingBox();
    const box = await bar.boundingBox();
    expect(Math.round(box!.y - content!.y)).toBe(0);
    expect(Math.round(box!.height)).toBe(36);
    await expect(bar).toHaveCSS("border-bottom-width", "1px");
    const people = bar.getByRole("button", { name: /^People/ });
    expect(parseFloat(await people.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(10);
    await expect(people.locator("svg path")).toHaveAttribute("d", "M4 6l4 4 4-4"); // the single ˅ (chevronDown)
    await expect(people.locator("svg")).toHaveCSS("margin-left", "0px"); // only the button's 6-pt gap before the ˅, as in the prototype
    await expect(bar.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();
  });
  test("UI — design — #1079 the month header of the current year reads the month alone", async ({ page }) => {
    await openFixed(page);
    await expect(page.locator(".lb-month th").first()).toHaveText(/^[A-Z][a-z]+$/);
  });
});
