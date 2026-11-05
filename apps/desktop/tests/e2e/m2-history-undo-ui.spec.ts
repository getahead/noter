// M2 — History, change log and undo (docs/features/ui/history-undo.md, DESIGN.md › Screen — Call page PC-R8, Item inspector II-R2).
// The feature owns no story: it serves `cpt-noter-seq-call-page-review-outputs` (No changes yet, Export the call's change log),
// `cpt-noter-seq-call-page-check-evidence` (Item History) and the undo paths of `cpt-noter-seq-today-tick-item` and
// `cpt-noter-seq-call-page-review-suggested-items` (those two stories' own files drive the strip from their screens).
// Written before the feature exists (tests first): they fail until history-undo lands. They drive the real UI over the selected core
// (NOTER_CORE=stdio runs them against noter-core-harness) and read the commands the window sent: history_list, change_undo,
// change_redo, history_export. Markup follows the prototype: PC-R8 holds `cpt-noter-component-ui-history-timeline`, rows are
// `cpt-noter-component-ui-change-row` with `data-state` (applied | undone), the strip is `cpt-noter-component-ui-undo-strip`.
// Native, not here: the macOS save panel of Export Log… (the core owns it; XCUITest/manual checklist).
import type { Locator, Page } from "@playwright/test";

import type { ChangeRow } from "../../src/core/bindings";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const TITLE = "Backend sync";
const TIMELINE = '[data-component="cpt-noter-component-ui-history-timeline"]';
const ROW = '[data-component="cpt-noter-component-ui-change-row"]';
const STRIP = '[data-component="cpt-noter-component-ui-undo-strip"]';
const toolbar = (page: Page) => page.locator('[data-region="PC-R1"]');
const timeline = (page: Page) => page.locator(TIMELINE);
const rowOf = (page: Page, text: string | RegExp) => page.locator(ROW).filter({ hasText: text });
const strip = (page: Page) => page.locator(STRIP);
const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name });
const filter = (page: Page, name: string) => timeline(page).getByRole("radio", { name }).or(button(timeline(page), name)).first();
const sent = async (page: Page, name: string): Promise<unknown[]> =>
  (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args);

const T0 = 1_792_000_000_000;
/** A change of the call's own record (title, tag, speaker name…) by the user, undoable. */
function change(id: string, over: Partial<ChangeRow> = {}): ChangeRow {
  return {
    id,
    at: T0,
    actor: { type: "you" },
    entity: { id: W.PAST_CALL, kind: "call", label: TITLE },
    field: "title",
    before: "Sync",
    after: TITLE,
    summary: `Renamed the call to “${TITLE}”`,
    reason: null,
    confidence: "high",
    evidence: [],
    batch_id: null,
    batch_size: 1,
    status: "applied",
    undoable: true,
    redoable: false,
    ...over,
  } as ChangeRow;
}
/** The Backend sync call's history: a user rename and tag, a job's batch of 37 and one undone change. */
const withChanges = (w: World) => {
  W.idle(w);
  w.changes = [
    change("chg_rename"),
    change("chg_tag", { at: T0 - 60_000, field: "tags", before: null, after: "release", summary: "Added the tag “release”" }),
    change("chg_batch", {
      at: T0 - 120_000,
      actor: { type: "job", job_id: "job_reconcile", name: "Reconcile terms and references" },
      batch_id: "bat_shaman",
      batch_size: 37,
      summary: "Applied term “shaman” to 37 segments",
    }),
    change("chg_undone", { at: T0 - 180_000, status: "undone", undoable: false, redoable: true, summary: "Set the call type to Planning" }),
  ];
};
const noChanges = (w: World) => (W.idle(w), (w.changes = []));

/** Library › Calls (⌘3), then the call's page the way the core opens it (a `window_navigate` → `nav:request`) on `tab`. */
export async function openCallPage(page: Page, world: (w: World) => void, tab: "history" | "summary", fail: Array<{ cmd: "history_list"; code: "change_log_unreadable" }> = []) {
  const steer = await openWindow(page, "main", { world, fail });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit3");
    await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
  await page.evaluate(
    async ([callId, view]) => {
      const args = { target: { type: "call_page", call_id: callId, tab: view } };
      const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
      await (g.__noterFake ? g.__noterFake.invoke("window_navigate", args) : g.__TAURI_INTERNALS__!.invoke("window_navigate", { args }));
    },
    [W.PAST_CALL, tab],
  );
  await expect(toolbar(page)).toContainText(TITLE);
  return steer;
}
const openHistory = (page: Page, world: (w: World) => void, fail: Array<{ cmd: "history_list"; code: "change_log_unreadable" }> = []) => openCallPage(page, world, "history", fail);

test.describe("cpt-noter-seq-call-page-review-outputs", () => {
  test("UI — empty path: History of a call with no changes reads No changes yet, with Export Log… still offered", async ({ page }) => {
    await openHistory(page, noChanges);
    await expect(timeline(page)).toBeVisible();
    await expect(timeline(page).getByText("No changes yet")).toBeVisible();
    await expect(page.locator(ROW)).toHaveCount(0);
    expect(await sent(page, "history_list")).toContainEqual(expect.objectContaining({ target: { type: "call", call_id: W.PAST_CALL }, actor: "all" }));
    await expect(button(page, "Export Log…")).toBeVisible();
  });

  test("UI — Other — Export the call's change log: Export Log…, Whole call, JSON, Export… → Exported log to <path>", async ({ page }) => {
    await openHistory(page, withChanges);
    await button(page, "Export Log…").click();
    const sheet = page.getByRole("dialog", { name: /Export Log/ });
    await expect(sheet).toContainText(TITLE);
    await expect(sheet).toContainText("Whole call");
    await expect(sheet.getByRole("radio", { name: /Markdown/ })).toBeChecked(); // the default
    await sheet.getByRole("radio", { name: /JSON/ }).check();
    await button(sheet, /^Export/).click();
    await expect(page.getByRole("status").filter({ hasText: /Exported log to .*\.json/ })).toBeVisible();
    expect(await sent(page, "history_export")).toEqual([{ scope: { type: "call", call_id: W.PAST_CALL }, format: "json" }]);
    await expect(sheet).toBeHidden();
  });

  test("UI — error path: Cancel in the sheet sends nothing and shows no exported status", async ({ page }) => {
    await openHistory(page, withChanges);
    await button(page, "Export Log…").click();
    await button(page.getByRole("dialog", { name: /Export Log/ }), "Cancel").click();
    await expect(page.getByRole("dialog", { name: /Export Log/ })).toBeHidden();
    await expect(page.getByText(/Exported log to/)).toHaveCount(0);
    expect(await sent(page, "history_export")).toHaveLength(0);
  });

  test("UI — error path: a failed export keeps the sheet and the chosen format, Try Again exports", async ({ page }) => {
    const steer = await openHistory(page, withChanges);
    await button(page, "Export Log…").click();
    const sheet = page.getByRole("dialog", { name: /Export Log/ });
    await sheet.getByRole("radio", { name: /JSON/ }).check();
    await steer.failNext("history_export", "internal");
    await button(sheet, /^Export/).click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("radio", { name: /JSON/ })).toBeChecked();
    await expect(page.getByText(/Exported log to/)).toHaveCount(0);
    await button(sheet, "Try Again").click();
    await expect(page.getByRole("status").filter({ hasText: /Exported log to .*\.json/ })).toBeVisible();
    expect(await sent(page, "history_export")).toHaveLength(2);
  });
});

test.describe("cpt-noter-seq-call-page-check-evidence", () => {
  test("UI — Other — Edit an item in the Item inspector: History lists the item's changes with an actor pop-up only, no job pop-up, no Export Log…", async ({ page }) => {
    await openCallPage(
      page,
      (w) => {
        W.idle(w);
        w.changes = [change("chg_item", { entity: { id: "itm_token", kind: "item", label: "Rotate the staging Jira token" }, field: "status", summary: "Closed “Rotate the staging Jira token”" })];
      },
      "summary",
    );
    await button(page, /Rotate the staging Jira token.*(info|details)|Show details/i).first().click(); // the row's info button
    const inspector = page.locator('[data-component="cpt-noter-component-ui-item-inspector"]');
    await inspector.getByRole("tab", { name: "History" }).click();
    expect(await sent(page, "history_list")).toContainEqual(expect.objectContaining({ target: { type: "item", item_id: "itm_token" }, actor: "all" }));
    await expect(inspector.locator(ROW)).toHaveCount(1);
    await expect(inspector.getByRole("combobox", { name: /All/ }).or(inspector.getByRole("button", { name: /^All/ }))).toBeVisible(); // actor pop-up
    await expect(inspector.getByRole("button", { name: /All jobs/ })).toHaveCount(0);
    await expect(inspector.getByRole("button", { name: "Export Log…" })).toHaveCount(0);
  });
});

test.describe("cpt-noter-flow-ui-history-undo-read (call History, PC-R8)", () => {
  test("UI — happy path: newest first under date groups, rows with actor, description and batch count, undone rows marked", async ({ page }) => {
    await openHistory(page, withChanges);
    const rows = page.locator(ROW);
    await expect(rows).toHaveCount(4);
    await expect(rows.first()).toContainText("Renamed the call");
    await expect(rowOf(page, "Applied term “shaman”")).toContainText(/37/);
    await expect(rowOf(page, "Applied term “shaman”")).toContainText("Reconcile terms and references");
    await expect(rowOf(page, "Set the call type")).toHaveAttribute("data-state", "undone");
    await expect(timeline(page).getByRole("heading").first()).toBeVisible(); // a date group heading
  });

  test("UI — filters: You and Jobs re-read the first page for the actor and announce one count; All restores", async ({ page }) => {
    await openHistory(page, withChanges);
    await filter(page, "You").click();
    await expect.poll(() => sent(page, "history_list")).toContainEqual(expect.objectContaining({ actor: "you" }));
    await expect(page.getByRole("status").filter({ hasText: /3 changes/ })).toBeVisible();
    await expect(page.locator(ROW)).toHaveCount(3);
    await filter(page, "Jobs").click();
    await expect.poll(() => sent(page, "history_list")).toContainEqual(expect.objectContaining({ actor: "jobs" }));
    await expect(page.locator(ROW)).toHaveCount(1);
    await filter(page, "All").click();
    await expect(page.locator(ROW)).toHaveCount(4);
  });

  test("UI — filtered empty: Models names the filter and keeps All available", async ({ page }) => {
    await openHistory(page, withChanges);
    await filter(page, "Models").click();
    await expect(timeline(page)).toContainText(/Models/);
    await expect(page.locator(ROW)).toHaveCount(0);
    await expect(filter(page, "All")).toBeEnabled();
  });

  test("UI — error path: change_log_unreadable reads Couldn’t read the history of this call., Try Again repeats the read only", async ({ page }) => {
    await openHistory(page, withChanges, [{ cmd: "history_list", code: "change_log_unreadable" }]);
    await expect(timeline(page)).toContainText("Couldn’t read the history of this call.");
    await button(timeline(page), "Try Again").click();
    await expect(page.locator(ROW)).toHaveCount(4);
    expect(await sent(page, "history_list")).toHaveLength(2);
  });

  test("UI — diff: Diff on a row with before and after marks inserted and deleted words", async ({ page }) => {
    await openHistory(page, withChanges);
    const row = rowOf(page, "Renamed the call");
    await button(row, "Diff").click();
    await expect(row.locator("ins, [data-diff='insert']").first()).toBeVisible();
    await expect(row.locator("del, [data-diff='delete']").first()).toBeVisible();
  });

  test("UI — batch: Show 37 changes discloses at most 50 members, only rows the core returns", async ({ page }) => {
    await openHistory(page, withChanges);
    await button(rowOf(page, "Applied term “shaman”"), /Show 37 changes/).click();
    expect(await page.locator(ROW).count()).toBeLessThanOrEqual(4 + 50);
  });
});

test.describe("cpt-noter-flow-ui-history-undo-reverse (rows, strip, redo)", () => {
  test("UI — happy path: Undo on a row sends the change id, the strip reads Undone · Redo, the row keeps Redo after the strip is dismissed", async ({ page }) => {
    await openHistory(page, withChanges);
    const row = rowOf(page, "Renamed the call");
    await button(row, "Undo").click();
    expect(await sent(page, "change_undo")).toEqual([{ target: { type: "change", change_id: "chg_rename" } }]);
    await expect(strip(page)).toContainText(/Undone/);
    await expect(button(strip(page), "Redo")).toBeVisible();
    await expect(row).toHaveAttribute("data-state", "undone");
    await button(strip(page), /Dismiss|Close|×/).click();
    await expect(strip(page)).toBeHidden();
    await expect(button(row, "Redo")).toBeVisible(); // dismissing a strip never expires History actions
  });

  test("UI — Redo on the strip applies the same change again and History is re-read from the core", async ({ page }) => {
    await openHistory(page, withChanges);
    await button(rowOf(page, "Renamed the call"), "Undo").click();
    await button(strip(page), "Redo").click();
    expect(await sent(page, "change_redo")).toEqual([{ target: { type: "change", change_id: "chg_rename" } }]);
    await expect.poll(async () => (await sent(page, "history_list")).length).toBeGreaterThan(1);
    await expect(rowOf(page, "Renamed the call").first()).toHaveAttribute("data-state", "applied");
  });

  test("UI — Redo on an undone row sends change_redo for that row", async ({ page }) => {
    await openHistory(page, withChanges);
    await button(rowOf(page, "Set the call type"), "Redo").click();
    expect(await sent(page, "change_redo")).toEqual([{ target: { type: "change", change_id: "chg_undone" } }]);
  });

  test("UI — batch: Undo on the batch row targets the batch id, never a row index, and the strip names the returned count", async ({ page }) => {
    await openHistory(page, withChanges);
    await button(rowOf(page, "Applied term “shaman”"), "Undo").click();
    expect(await sent(page, "change_undo")).toEqual([{ target: { type: "batch", batch_id: "bat_shaman" } }]);
    await expect(strip(page)).toContainText(/Undone 37 changes/);
  });

  test("UI — keyboard: U on the focused row undoes it, Esc on the strip hides it, ⇧⌘Z redoes the same change", async ({ page }) => {
    await openHistory(page, withChanges);
    await rowOf(page, "Renamed the call").focus();
    await page.keyboard.press("u");
    await expect.poll(() => sent(page, "change_undo")).toHaveLength(1);
    await expect(strip(page)).toBeVisible();
    await strip(page).focus();
    await page.keyboard.press("Escape");
    await expect(strip(page)).toBeHidden();
    await page.keyboard.press("Shift+Meta+z");
    await expect.poll(() => sent(page, "change_redo")).toHaveLength(1);
  });

  test("UI — the strip leaves after 10 s without taking focus, History keeps Redo", async ({ page }) => {
    await openHistory(page, withChanges);
    const row = rowOf(page, "Renamed the call");
    await button(row, "Undo").click();
    await expect(strip(page)).toBeVisible();
    await expect(strip(page)).toBeHidden({ timeout: 14_000 });
    await expect(button(row, "Redo")).toBeVisible();
  });

  test("UI — hover pauses the strip's expiry; leaving restarts it", async ({ page }) => {
    await openHistory(page, withChanges);
    await button(rowOf(page, "Renamed the call"), "Undo").click();
    await strip(page).hover();
    await page.waitForTimeout(11_000);
    await expect(strip(page)).toBeVisible(); // paused past the 10 s
    await page.mouse.move(0, 0);
    await expect(strip(page)).toBeHidden({ timeout: 14_000 });
  });

  test("UI — error path: edited_later keeps the records, names the error and refreshes History without a success message", async ({ page }) => {
    const steer = await openHistory(page, withChanges);
    await steer.failNext("change_undo", "edited_later");
    const row = rowOf(page, "Renamed the call");
    await button(row, "Undo").click();
    await expect(page.getByText(/edited (it )?later/i).first()).toBeVisible();
    await expect(strip(page).getByText(/^Undone/)).toHaveCount(0);
    await expect(row).toHaveAttribute("data-state", "applied");
    await expect.poll(async () => (await sent(page, "history_list")).length).toBeGreaterThan(1);
  });

  test("UI — error path: already_undone and not_undoable leave the records intact and refresh the row actions", async ({ page }) => {
    const steer = await openHistory(page, withChanges);
    await steer.failNext("change_undo", "already_undone");
    await button(rowOf(page, "Added the tag"), "Undo").click();
    await expect(strip(page).getByText(/^Undone/)).toHaveCount(0);
    await expect.poll(async () => (await sent(page, "history_list")).length).toBeGreaterThan(1);
    await steer.failNext("change_undo", "not_undoable");
    await button(rowOf(page, "Renamed the call"), "Undo").click();
    await expect(strip(page).getByText(/^Undone/)).toHaveCount(0);
  });

  test("UI — a second click while the command is working sends one change_undo", async ({ page }) => {
    await openHistory(page, withChanges);
    await button(rowOf(page, "Renamed the call"), "Undo").dblclick();
    await expect.poll(() => sent(page, "change_undo")).toHaveLength(1);
  });
});
