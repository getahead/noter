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
  // The contract-batch stories separately exercise topic replacement and core-computed merge suggestions.
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
  test("UI — happy path: “websocket уведомления” shows Items and Transcripts, ↓ Space plays the span, Return opens the Call page at it", async ({ page }) => {
    await openCalls(page);
    const words = "websocket уведомления"; // the story's cross-language words, on both cores
    await search(page, words);
    await expect(page.getByText(/Best matches · keyword and meaning/)).toBeVisible();
    for (const section of ["Items", "Transcripts"]) await expect(page.getByRole("heading", { name: section })).toBeVisible();
    expect(await sent(page, "search")).toEqual([expect.objectContaining({ query: words, filter: {} })]);
    await expect(page.getByText("Websocket уведомления идут через notification service")).toBeVisible(); // the original words, not a normalized copy

    await page.keyboard.press("ArrowDown"); // the Items hit, then the first transcript match
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect.poll(async () => (await sent(page, "audio_play")).length).toBe(1);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Transcript", selected: true })).toBeVisible();
    await expect(page.locator('[data-state="highlighted"], .np-hl-evidence').first()).toContainText("notification service");
  });

  test("UI — AC2: a search with no matches says so in the live region, as results are counted there", async ({ page }) => {
    await openCalls(page);
    await search(page, "Lizenzprüfung im Installer");
    await expect(page.getByRole("status").filter({ hasText: "No matches for “Lizenzprüfung im Installer”" })).toHaveCount(1);
  });

  test("UI — AC2: a filter repeats the same final count in the existing live region without taking focus", async ({ page }) => {
    await openCalls(page);
    await search(page, "Lizenzprüfung im Installer");
    const status = page.locator('[data-live="polite"]');
    const text = "No matches for “Lizenzprüfung im Installer”";
    await expect(status).toHaveText(text);
    await status.evaluate((region) => {
      const changes: string[] = [];
      const observer = new MutationObserver(() => changes.push(region.textContent ?? ""));
      observer.observe(region, { childList: true, characterData: true, subtree: true });
      Object.assign(window, { searchAnnouncement: { region, changes } });
    });
    const filter = button(page, "Has Open Items");
    await filter.focus();
    await page.keyboard.press("Space");
    await expect.poll(async () => (await sent(page, "search")).length).toBe(2);
    await expect(status).toHaveText(text);
    await expect(filter).toBeFocused();
    await expect.poll(() => page.evaluate(() => {
      const recorded = (window as unknown as { searchAnnouncement: { region: Element; changes: string[] } }).searchAnnouncement;
      return { connected: recorded.region === document.querySelector('[data-live="polite"]'), changes: recorded.changes };
    })).toEqual({ connected: true, changes: ["", text] });
  });

  test("UI — AC4: Esc on the mouse-opened Show How Noter Searched popover puts focus back on its link", async ({ page }) => {
    await openCalls(page);
    await search(page, "notification service");
    const how = page.getByRole("link", { name: "Show How Noter Searched" });
    await how.click(); // by mouse: WebKit leaves no focused element behind
    await expect(page.getByRole("dialog", { name: "How Noter searched" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "How Noter searched" })).toHaveCount(0);
    await expect(how).toBeFocused();
  });

  test("UI — Tab, then Esc, from the Show How Noter Searched popover puts focus back on its link", async ({ page }) => {
    await openCalls(page);
    await search(page, "notification service");
    const how = page.getByRole("link", { name: "Show How Noter Searched" });
    await how.click();
    await expect(page.getByRole("dialog", { name: "How Noter searched" })).toBeVisible();
    // what the shell's window-level Esc shortcut would see (a listener on document, added after the popover's, runs just before the window's): a key nobody consumed would close the inspector or the sidebar overlay too
    await page.evaluate(() => {
      (window as unknown as { unhandledEsc: number }).unhandledEsc = 0;
      document.addEventListener("keydown", (e) => e.key === "Escape" && !e.defaultPrevented && ((window as unknown as { unhandledEsc: number }).unhandledEsc += 1));
    });
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "How Noter searched" })).toHaveCount(0);
    await expect(how).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { unhandledEsc: number }).unhandledEsc)).toBe(0);
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
    const row = table.getByRole("row", { name: /Websocket notifications/ });
    const [calls, decisions, open] = (await row.locator("td.np-tnum").allTextContents()).map(Number); // the row's own counts, which the thread header must repeat
    expect(decisions).toBeGreaterThanOrEqual(1); // the story opens the decision itm_notif
    await row.click();
    await page.keyboard.press("Enter");
    await expect.poll(() => sent(page, "topic_get")).toEqual([expect.objectContaining({ topic_id: "top_ws" })]);
    await expect(page.getByRole("heading", { name: "Websocket notifications" })).toBeVisible();
    await expect(page.getByText(new RegExp(`${calls} calls? · ${decisions} decisions? · ${open} open questions?`))).toBeVisible();
    await page.locator("[data-item-id=itm_notif]").focus(); // the decision's row
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "Transcript", selected: true })).toBeVisible();
  });

  test("UI — #1046: Open questions counts the topic's open questions only, not its other open items, in the row and the thread header", async ({ page }) => {
    let questions = 0;
    let others = 0;
    await openTopics(page, (w) => {
      W.idle(w);
      for (const i of w.items.filter((x) => x.topic?.id === "top_drawer" && x.status === "open")) i.kind === "open_question" ? questions++ : others++;
    });
    expect(others).toBeGreaterThan(0); // the topic also has open action items, which the column must not count
    const row = page.getByRole("table").getByRole("row", { name: /Drawer redesign/ });
    await expect(row.locator("td.np-tnum").nth(2)).toHaveText(String(questions));
    await row.click();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Drawer redesign" })).toBeVisible();
    await expect(page.getByText(new RegExp(`· ${questions} open questions? ·`))).toBeVisible();
  });

  test("UI — #1045: the row's › button opens the topic once, so one Back returns to Topics", async ({ page }) => {
    await openTopics(page);
    await page.getByRole("button", { name: "Open Websocket notifications" }).click();
    await expect(page.getByRole("heading", { name: "Websocket notifications" })).toBeVisible();
    await page.keyboard.press("Meta+BracketLeft");
    await expect(page.getByRole("heading", { name: "Topics", level: 1 })).toBeVisible();
  });

  test("UI — #1047: Rename… from the thread's More menu shows the new name in the thread's heading at once", async ({ page }) => {
    await openTopics(page);
    await page.getByRole("table").getByRole("row", { name: /Websocket notifications/ }).click();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Websocket notifications" })).toBeVisible();
    await button(page, "More").click();
    await page.getByRole("menuitem", { name: "Rename…" }).click();
    const pop = page.getByRole("dialog", { name: "Rename topic" });
    await pop.getByRole("textbox").fill("Websocket reconnects");
    await pop.getByRole("button", { name: "Rename" }).click();
    await expect(page.getByText("Renamed “Websocket notifications” to “Websocket reconnects”")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Websocket reconnects" })).toBeVisible();
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

  test("UI — other path: Ask About This Thread opens Ask scoped to the topic and asks what was decided and what is still open", async ({ page }) => {
    await openTopics(page);
    await page.getByRole("table").getByRole("row", { name: /Websocket notifications/ }).click();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Websocket notifications" })).toBeVisible();
    await page.getByRole("button", { name: "Ask About This Thread" }).click();
    await expect(page.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible();
    expect(await sent(page, "ask_start")).toEqual([
      expect.objectContaining({ question: "What was decided and what is still open about Websocket notifications?", scope: { preset: "topic:top_ws", topic_id: "top_ws" } }),
    ]);
  });
});

// Design fixes against the prototype of record (Main window › Topics and People, State ▾ Normal).
test.describe("cpt-noter-seq-library-follow-topic", () => {
  test("UI — design — #1085 the page title shows no focus ring after navigation", async ({ page }) => {
    await openCalls(page);
    await page.keyboard.press("Meta+Digit5");
    const title = page.getByRole("heading", { name: "Topics", level: 1 });
    await expect(title).toBeVisible();
    await expect(title).toHaveCSS("outline-style", "none");
    // the table shows its true order: newest first, so Last discussed ⌄ (owner decision, 22 Nov)
    const last = page.getByRole("columnheader", { name: "Last discussed" });
    await expect(last).toHaveAttribute("aria-sort", "descending");
    await expect(last.locator(".np-th__sort")).toBeVisible();
    await page.keyboard.press("Meta+Digit4");
    const name = page.getByRole("columnheader", { name: "Name" });
    await expect(name).toHaveAttribute("aria-sort", "ascending");
    await expect(name.locator(".np-th__sort")).toBeVisible();
  });
});

test.describe("cpt-noter-seq-library-follow-topic", () => {
  for (const [width, px] of [["Medium", 1000], ["Narrow", 700]] as const)
    test(`UI — design — thread rows at ${width}: time, review buttons, share and ⓘ stay inside the row; the call link and text truncate`, async ({ page }) => {
      await page.setViewportSize({ width: px, height: 800 });
      await openTopics(page);
      await page.getByRole("table").getByRole("row", { name: /Drawer redesign/ }).click();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Drawer redesign" })).toBeVisible();
      const rows = page.locator(".lb-throw");
      await expect(rows.first()).toBeVisible();
      await expect(page.locator(".lb-throw").getByRole("button", { name: "Accept" }).first()).toBeVisible(); // a suggested row with its review buttons
      const content = (await page.locator(".np-content").boundingBox())!;
      for (const row of await rows.all()) {
        const last = (await row.locator(":scope > *").last().boundingBox())!;
        expect(last.x + last.width).toBeLessThanOrEqual(content.x + content.width + 1); // nothing runs past the content pane
        const tag = row.locator(":scope > .np-badge").first();
        expect(await tag.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true); // the kind tag is never cut
      }
    });
});

// Design fixes against the prototype of record (Search results).
test.describe("cpt-noter-seq-library-search-calls", () => {
  test("UI — design — #1117 a transcript hit carries its timestamp chip instead of 'Open at this moment'", async ({ page }) => {
    await openCalls(page);
    await search(page, "notification service");
    await expect(page.locator('[data-component="cpt-noter-component-ui-search-result-row"]').first()).toBeVisible();
    const segments = page.locator('[data-component="cpt-noter-component-ui-search-result-row"][data-target="segment"]');
    await expect(segments.first()).toBeVisible();
    await expect(segments.first().locator('[data-component="cpt-noter-component-ui-provenance-chip"]')).toHaveText(/^\d{2}:\d{2}:\d{2}\s?↗$/);
    await expect(segments.first().getByText("Open at this moment")).toHaveCount(0);
  });
});
