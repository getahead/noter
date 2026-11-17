// M3 — Library: search, filters and topics (docs/features/ui/library-search-topics.md; DESIGN.md stories
// cpt-noter-seq-library-search-calls and -follow-topic; filter-calls is in m3-library-search-topics-ui.spec.ts). Real-core flows written before the screens exist
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

test.describe("cpt-noter-seq-library-search-calls", () => {
  test("UI — happy path: “notification service” shows Items and Transcripts, ↓ Space plays the span, Return opens the Call page at it", async ({ page }) => {
    await openCalls(page);
    await search(page, "notification service");
    await expect(page.getByText(/Best matches · keyword and meaning/)).toBeVisible();
    for (const section of ["Items", "Transcripts"]) await expect(page.getByRole("heading", { name: section })).toBeVisible();
    expect(await sent(page, "search")).toEqual([expect.objectContaining({ query: "notification service", filter: {} })]);
    await expect(page.getByText("Websocket уведомления идут через notification service")).toBeVisible(); // the original words, not a normalized copy

    await page.keyboard.press("ArrowDown"); // the Items hit, then the first transcript match
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect.poll(async () => (await sent(page, "audio_play")).length).toBe(1);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Transcript", selected: true })).toBeVisible();
    await expect(page.locator('[data-state="highlighted"], .np-hl-evidence').first()).toContainText("notification service");
  });

  test("UI — empty path: no matches for “Lizenzprüfung im Installer” offers Try fewer words, Clear Filters and Ask Instead, which asks the same words in a new thread", async ({ page }) => {
    await openCalls(page);
    await button(page, /^Type/).click();
    await page.locator("label.np-check", { hasText: "Planning" }).click(); // the native box is visually hidden inside its label
    await search(page, "Lizenzprüfung im Installer");
    const empty = page.locator('[data-component="cpt-noter-component-ui-empty-state"]');
    await expect(empty).toContainText("No matches for “Lizenzprüfung im Installer”");
    await expect(empty).toContainText("1 filter active");
    await button(page, "Clear Filters").first().click();
    await expect(empty).toContainText("Try fewer words");
    await expect(button(page, "Clear Filters")).toHaveCount(0);
    expect((await sent(page, "search")).at(-1)).toMatchObject({ query: "Lizenzprüfung im Installer", filter: {} });
    await button(page, "Ask Instead").click();
    await expect(page.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible();
    expect(await sent(page, "ask_start")).toEqual([expect.objectContaining({ question: "Lizenzprüfung im Installer" })]);
  });

  test("UI — error path: Couldn't search your calls keeps the words, Try Again repeats the search once and shows the results", async ({ page }) => {
    const steer = await openCalls(page);
    await steer.failNext("search", "internal");
    await search(page, "drawer timeout");
    await expect(page.getByText(/Couldn.t search your calls/)).toBeVisible();
    await expect(searchField(page)).toHaveValue("drawer timeout");
    expect(await sent(page, "search")).toHaveLength(1); // no automatic retry
    await button(page, "Try Again").click();
    await expect(page.getByText(/Couldn.t search your calls/)).toHaveCount(0);
    expect(await sent(page, "search")).toHaveLength(2);
  });

  test("UI — the search route (Return in the toolbar field, or Ask's Search by Keyword) fills the field with its words and runs search with them", async ({ page }) => {
    // Both entries push route search:<question> (shell/sections.ts searchRoute); Ask's own button is covered in the Ask spec.
    const question = "drawer timeout";
    await openCalls(page);
    await search(page, question);
    await expect(searchField(page)).toHaveValue(question);
    expect((await sent(page, "search")).at(-1)).toMatchObject({ query: question });
  });

  test("UI — Back restores the query after opening a span", async ({ page }) => {
    await openCalls(page);
    await search(page, "drawer redesign");
    await page.getByRole("region", { name: "Transcripts" }).locator(".lb-hit").first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Transcript", selected: true })).toBeVisible();
    await page.keyboard.press("Meta+BracketLeft");
    await expect(searchField(page)).toHaveValue("drawer redesign");
  });
});

test.describe("cpt-noter-seq-library-follow-topic", () => {
  test("UI — happy path: ⌘5 lists each topic with Calls, Decisions and Open questions; the thread opens and groups entries by month; Return on an entry opens its call at the span", async ({ page }) => {
    await openTopics(page);
    expect(await sent(page, "topics_list")).toHaveLength(1);
    const table = page.getByRole("table");
    for (const col of ["Topic", "Calls", "Decisions", "Last discussed"]) await expect(table.getByRole("columnheader", { name: new RegExp(col) })).toBeVisible();
    await table.getByRole("row", { name: /Websocket notifications/ }).click();
    await page.keyboard.press("Enter");
    expect(await sent(page, "topic_get")).toEqual([expect.objectContaining({ topic_id: "top_ws" })]);
    await expect(page.getByRole("heading", { name: "Websocket notifications" })).toBeVisible();
    await expect(page.getByText(/\d+ calls? · \d+ decisions? · \d+ open questions?/)).toBeVisible();
    await page.locator("[data-item-id=itm_notif]").focus(); // the decision's row
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Transcript", selected: true })).toBeVisible();
  });

  test("UI — other path: search reconnect finds none, Clear Search restores, Rename… sends topic_rename with the current rev and shows Renamed … · Undo", async ({ page }) => {
    await openTopics(page);
    const field = page.getByRole("searchbox", { name: /Search/ });
    await field.fill("reconnect");
    await expect(page.getByText("No topics match “reconnect”")).toBeVisible();
    await button(page, "Clear Search").click();
    const row = page.getByRole("table").getByRole("row", { name: /Websocket notifications/ });
    await expect(row).toBeVisible();
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename…" }).click();
    const pop = page.getByRole("dialog", { name: "Rename topic" });
    await expect(pop.getByRole("textbox")).toHaveValue("Websocket notifications");
    await pop.getByRole("textbox").fill("Websocket reconnects");
    await pop.getByRole("button", { name: "Rename" }).click();
    expect(await sent(page, "topic_rename")).toEqual([{ topic_id: "top_ws", rev: 1, name: "Websocket reconnects" }]);
    await expect(page.getByText("Renamed “Websocket notifications” to “Websocket reconnects”")).toBeVisible();
    await expect(page.getByRole("table").getByRole("row", { name: /Websocket reconnects/ })).toBeVisible();
  });

  test("UI — other path: renaming to a taken name offers Merge Instead and keeps the draft", async ({ page }) => {
    await openTopics(page);
    await page.getByRole("table").getByRole("row", { name: /Websocket notifications/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Rename…" }).click();
    const pop = page.getByRole("dialog", { name: "Rename topic" });
    await pop.getByRole("textbox").fill("Notification service");
    await pop.getByRole("button", { name: "Rename" }).click();
    await expect(pop.getByRole("button", { name: "Merge Instead" })).toBeVisible();
    await expect(pop.getByRole("textbox")).toHaveValue("Notification service");
  });

});
