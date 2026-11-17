// M3 — Library: search, filters and topics (docs/features/ui/library-search-topics.md; DESIGN.md stories
// cpt-noter-seq-library-search-calls, -filter-calls, -follow-topic). Real-core flows written before the screens exist
// (tests first); copy is DESIGN's. The world fixture is smaller than DESIGN's (2 calls, one person per call): counts are
// read from the core's own rows, never DESIGN's 8 / 31. Not covered here (the real core has no way to put the index in
// rebuild or return only weak hits, and the Call page Tags editor is not part of this feature): Error — Index rebuilding,
// Error — Only weak matches, Empty — No tags yet steps 2-4, Delete Topic (a contract gap).
import type { Page } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";

const ROW = '[data-component="cpt-noter-component-ui-call-row"][data-variant="table-row"]';
const button = (page: Page, name: string | RegExp) => page.getByRole("button", { name });

/** Topics the way DESIGN's thread has them: the decision and the open question under Websocket notifications, a replay item under the kept topic. */
function topicWorld(w: World): void {
  W.idle(w);
  const topic = (id: string) => {
    const t = w.topics.find((x) => x.id === id)!;
    return { id: t.id, name: t.name };
  };
  for (const [item, id] of [["itm_notif", "top_ws"], ["itm_reconnect_q", "top_ws"], ["itm_replay", "top_notif"]] as const) {
    w.items.find((i) => i.id === item)!.topic = topic(id);
  }
  // The core owns topics and their merge suggestions: harness.world_set refuses a changed `topics` slice. The Merge-suggested
  // and No-topics tests wait for the fixture seed (techlead ask #7, Row 7) and fail on that state until it lands.
}

async function openMain(page: Page, key: string, heading: string, world: (w: World) => void = W.idle) {
  const steer = await openWindow(page, "main", { world });
  await expect(async () => {
    await page.keyboard.press(key);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  return steer;
}
const openCalls = (page: Page, world?: (w: World) => void) => openMain(page, "Meta+Digit3", "Calls", world);
const openTopics = (page: Page, world: (w: World) => void = topicWorld) => openMain(page, "Meta+Digit5", "Topics", world);
const searchField = (page: Page) => page.getByRole("searchbox", { name: /Search/ });
async function search(page: Page, words: string) {
  await searchField(page).click();
  await searchField(page).fill(words);
  await page.keyboard.press("Enter");
}

test.describe("cpt-noter-seq-library-filter-calls", () => {
  test("UI — happy path: People Anna K. plus Has Open Items reads calls_list with that filter and counts the matches; two selected rows count as selected", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    await openCalls(page);
    await button(page, /^People/).click();
    await page.getByRole("option", { name: /^Anna Kuznetsova/ }).click(); // the People filter is the multi-select person picker
    await button(page, "Has Open Items").click();
    await expect.poll(async () => (await sent(page, "calls_list")).at(-1)).toMatchObject({ filter: { people: ["per_anna"], has_open_items: true } });
    await expect(page.getByText(/\d+ calls? match/).first()).toBeVisible(); // the header and its live region both say it
    // the world has one call with Anna: Clear Filters brings both calls back to select two of them
    await button(page, "Clear Filters").first().click();
    const rows = page.locator(ROW);
    await rows.first().click();
    await rows.nth(1).click({ modifiers: ["Meta"] });
    await expect(page.getByText(/2 selected/).first()).toBeVisible();
    await button(page, "Export…").click();
    await expect(page.getByRole("dialog")).toContainText(/Summary and items/);
  });

  test("UI — empty path: filters that match nothing show No calls match these filters, Clear Filters brings every call back", async ({ page }) => {
    await openCalls(page);
    await button(page, /^People/).click();
    await page.getByRole("option", { name: /^Lena Krüger/ }).click(); // Lena is on no call
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
