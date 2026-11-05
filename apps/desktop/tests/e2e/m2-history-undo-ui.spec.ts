// M2 — History, change log and undo (docs/features/ui/history-undo.md, DESIGN.md › Screen — Call page PC-R8, Item inspector II-R2).
// The feature owns no story: it serves `cpt-noter-seq-call-page-review-outputs` (No changes yet, Export the call's change log),
// `cpt-noter-seq-call-page-check-evidence` (Item History) and the undo paths of `cpt-noter-seq-today-tick-item` and
// `cpt-noter-seq-call-page-review-suggested-items` (those two stories' own files drive the strip from their screens).
// Written before the feature exists (tests first): they fail until history-undo lands. They drive the real UI over the selected core
// (NOTER_CORE=stdio runs them against noter-core-harness) and read the commands the window sent: history_list, change_undo,
// change_redo, history_export. The real core serves a call's History only from its own commands, so `seedHistory` issues them
// (rename, sensitivity, undo). Job/model rows and batches are `world.changes` seeds: they wait for the Unblocker's seeded
// `changes` for call_backend (_team/handoff-ui-m2-e2e-1.md), which is why those tests are grouped under `Unblocker seed`. Markup follows the prototype: PC-R8 holds `cpt-noter-component-ui-history-timeline`, rows are
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
/** Commands the window sent after the seed (the seed's own commands are not the screen's). */
const sent = async (page: Page, name: string): Promise<unknown[]> => {
  const all = await calls(page);
  return all.slice(all.map((c) => c.name).lastIndexOf("__seeded") + 1).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args);
};

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
const noChanges = W.idle; // the real core has no call History until a command writes one (world_set refuses `changes`)
const RENAME = /Renamed|title/i; // the core words its own summary; the row names the field
const SENSITIVE = /sensitive|privacy/i;

/** One command from the open window, whichever core it runs on (the fake or the stdio bridge). */
async function issue<T = unknown>(page: Page, cmd: string, args: unknown): Promise<T> {
  return (await page.evaluate(
    async ([c, a]) => {
      const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
      return g.__noterFake ? g.__noterFake.invoke(c as string, a) : g.__TAURI_INTERNALS__!.invoke(c as string, { args: a });
    },
    [cmd, args] as const,
  )) as T;
}
/** The call's History from its own commands: two renames and a sensitivity change, the last one undone. */
async function seedHistory(page: Page) {
  const get = () => issue<{ call: { rev: number } }>(page, "call_get", { call_id: W.PAST_CALL });
  for (const title of ["Backend sync (draft)", "Backend sync"]) await issue(page, "call_update", { call_id: W.PAST_CALL, rev: (await get()).call.rev, title });
  await issue(page, "capture_set_sensitive", { call_id: W.PAST_CALL, sensitive: true });
  const rows = await issue<{ rows: ChangeRow[] }>(page, "history_list", { target: { type: "call", call_id: W.PAST_CALL }, actor: "all", job_id: null, page: {} });
  await issue(page, "change_undo", { target: { type: "change", change_id: rows.rows.find((r) => r.field === "privacy_class")!.id } });
  await page.evaluate(() => void (globalThis as unknown as { __noterCalls: unknown[] }).__noterCalls.push({ kind: "listen", name: "__seeded" }));
}

/** Library › Calls (⌘3), then the call's page the way the core opens it (a `window_navigate` → `nav:request`) on `tab`. */
export async function openCallPage(page: Page, world: (w: World) => void, tab: "history" | "summary", fail: Array<{ cmd: "history_list"; code: "change_log_unreadable" }> = [], seed?: (page: Page) => Promise<void>) {
  const steer = await openWindow(page, "main", { world, fail: seed ? [] : fail });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit3");
    await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
  await seed?.(page);
  for (const f of seed ? fail : []) await steer.failNext(f.cmd, f.code);
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
/** History of the call over the real core's own rows: 2 renames and the undone sensitivity change. */
const openSeeded = (page: Page, fail: Array<{ cmd: "history_list"; code: "change_log_unreadable" }> = []) => openCallPage(page, W.idle, "history", fail, seedHistory);

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
    await openSeeded(page);
    await button(page, "Export Log…").click();
    const sheet = page.getByRole("dialog", { name: /Export Log/ });
    await expect(sheet).toContainText(TITLE);
    await expect(sheet).toContainText("Whole call");
    await expect(sheet.getByRole("radio", { name: /Markdown/ })).toBeChecked(); // the default
    await sheet.getByRole("radio", { name: /JSON/ }).check({ force: true }); // the radio is 1 px under its dot (np-radio__dot): force, as the primitive is built
    await button(sheet, /^Export/).click();
    await expect(page.getByRole("status").filter({ hasText: /Exported log to .*\.json/ })).toBeVisible();
    expect(await sent(page, "history_export")).toEqual([{ scope: { type: "call", call_id: W.PAST_CALL }, format: "json" }]);
    await expect(sheet).toBeHidden();
  });

  test("UI — error path: Cancel in the sheet sends nothing and shows no exported status", async ({ page }) => {
    await openSeeded(page);
    await button(page, "Export Log…").click();
    await button(page.getByRole("dialog", { name: /Export Log/ }), "Cancel").click();
    await expect(page.getByRole("dialog", { name: /Export Log/ })).toBeHidden();
    await expect(page.getByText(/Exported log to/)).toHaveCount(0);
    expect(await sent(page, "history_export")).toHaveLength(0);
  });

  test("UI — error path: a failed export keeps the sheet and the chosen format, Try Again exports", async ({ page }) => {
    const steer = await openSeeded(page);
    await button(page, "Export Log…").click();
    const sheet = page.getByRole("dialog", { name: /Export Log/ });
    await sheet.getByRole("radio", { name: /JSON/ }).check({ force: true }); // the radio is 1 px under its dot (np-radio__dot): force, as the primitive is built
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
    await openCallPage(page, W.idle, "summary", [], async (p) => {
      const item = await issue<{ item: { rev: number } }>(p, "item_get", { item_id: "itm_token" });
      await issue(p, "item_edit", { item_id: "itm_token", rev: item.item.rev, patch: { is_engineering: true } });
      await p.evaluate(() => void (globalThis as unknown as { __noterCalls: unknown[] }).__noterCalls.push({ kind: "listen", name: "__seeded" }));
    });
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
  test("UI — happy path: newest first under date groups, rows with actor and description, undone rows marked", async ({ page }) => {
    await openSeeded(page);
    const rows = page.locator(ROW);
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText(SENSITIVE); // newest first
    await expect(rowOf(page, SENSITIVE)).toHaveAttribute("data-state", "undone");
    await expect(rowOf(page, RENAME).first()).toContainText(/you/i);
    await expect(timeline(page).getByRole("heading").first()).toBeVisible(); // a date group heading
  });

  test("UI — filters: You re-reads the first page for the actor and announces one count, Jobs names the empty filter, All restores", async ({ page }) => {
    await openSeeded(page);
    await filter(page, "You").click();
    await expect.poll(() => sent(page, "history_list")).toContainEqual(expect.objectContaining({ actor: "you" }));
    await expect(page.getByRole("status").filter({ hasText: /3 changes/ })).toBeVisible();
    await expect(page.locator(ROW)).toHaveCount(3);
    await filter(page, "Jobs").click();
    await expect.poll(() => sent(page, "history_list")).toContainEqual(expect.objectContaining({ actor: "jobs" }));
    await expect(page.locator(ROW)).toHaveCount(0);
    await filter(page, "All").click();
    await expect(page.locator(ROW)).toHaveCount(3);
  });

  test("UI — filtered empty: Models names the filter and keeps All available", async ({ page }) => {
    await openSeeded(page);
    await filter(page, "Models").click();
    await expect(timeline(page)).toContainText(/Models/);
    await expect(page.locator(ROW)).toHaveCount(0);
    await expect(filter(page, "All")).toBeEnabled();
  });

  test("UI — error path: change_log_unreadable reads Couldn’t read the history of this call., Try Again repeats the read only", async ({ page }) => {
    await openSeeded(page, [{ cmd: "history_list", code: "change_log_unreadable" }]);
    await expect(timeline(page)).toContainText("Couldn’t read the history of this call.");
    await button(timeline(page), "Try Again").click();
    await expect(page.locator(ROW)).toHaveCount(3);
    expect(await sent(page, "history_list")).toHaveLength(2);
  });

  test("UI — diff: Diff on a row with before and after marks inserted and deleted words", async ({ page }) => {
    await openSeeded(page);
    const row = rowOf(page, RENAME).first();
    await button(row, "Diff").click();
    await expect(row.locator("ins, [data-diff='insert']").first()).toBeVisible();
    await expect(row.locator("del, [data-diff='delete']").first()).toBeVisible();
  });
});

// Job, model and batch rows are not creatable from the UI or any command: they wait for the Unblocker's seeded `changes`
// for call_backend (one job batch, one model run, one edited-later batch) and fail until then (handoff-ui-m2-e2e-1.md).
test.describe("cpt-noter-flow-ui-history-undo-read — Unblocker seed (job and batch rows)", () => {
  test("UI — a job's batch row shows the actor, the description and the batch count; Jobs lists only it", async ({ page }) => {
    await openHistory(page, withChanges);
    await expect(rowOf(page, "Applied term “shaman”")).toContainText(/37/);
    await expect(rowOf(page, "Applied term “shaman”")).toContainText("Reconcile terms and references");
    await filter(page, "Jobs").click();
    await expect(page.locator(ROW)).toHaveCount(1);
  });

  test("UI — batch: the row shows batch · 37 and nothing expands (the contract carries no member rows)", async ({ page }) => {
    await openHistory(page, withChanges);
    await expect(rowOf(page, "Applied term “shaman”")).toContainText(/37/);
    await expect(button(rowOf(page, "Applied term “shaman”"), /Show 37 changes/)).toHaveCount(0);
    expect(await page.locator(ROW).count()).toBe(4);
  });
});

test.describe("cpt-noter-flow-ui-history-undo-reverse (rows, strip, redo)", () => {
  test("UI — happy path: Undo on a row restores the title through the core, the strip reads Undone · Redo, the row keeps Redo after the strip is dismissed", async ({ page }) => {
    await openSeeded(page);
    const row = rowOf(page, RENAME).first();
    await button(row, "Undo").click();
    expect(await sent(page, "change_undo")).toEqual([{ target: { type: "change", change_id: expect.any(String) } }]);
    await expect(strip(page)).toContainText(/Undone/);
    await expect(button(strip(page), "Redo")).toBeVisible();
    await expect(row).toHaveAttribute("data-state", "undone");
    expect((await issue<{ call: { title: string } }>(page, "call_get", { call_id: W.PAST_CALL })).call.title).toBe("Backend sync (draft)"); // restored, not only flagged
    await button(strip(page), /Dismiss|Close|×/).click();
    await expect(strip(page)).toBeHidden();
    await expect(button(row, "Redo")).toBeVisible(); // dismissing a strip never expires History actions
  });

  test("UI — Redo on the strip applies the same change again and History is re-read from the core", async ({ page }) => {
    await openSeeded(page);
    await button(rowOf(page, RENAME).first(), "Undo").click();
    await button(strip(page), "Redo").click();
    expect(await sent(page, "change_redo")).toEqual([{ target: { type: "change", change_id: expect.any(String) } }]);
    await expect.poll(async () => (await sent(page, "history_list")).length).toBeGreaterThan(1);
    // the core's own rows after a redo: trust the re-read flags (an undo/redo bug on the core is the Unblocker's, m2-history-undo.md)
    await expect(button(rowOf(page, RENAME).first(), "Undo")).toBeVisible();
  });

  test("UI — Redo on an undone row sends change_redo for that row", async ({ page }) => {
    await openSeeded(page);
    await button(rowOf(page, SENSITIVE), "Redo").click();
    expect(await sent(page, "change_redo")).toEqual([{ target: { type: "change", change_id: expect.any(String) } }]);
  });

  test("UI — keyboard: U on the focused row undoes it, Esc on the strip hides it, ⇧⌘Z redoes the same change", async ({ page }) => {
    await openSeeded(page);
    await rowOf(page, RENAME).first().focus();
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
    await openSeeded(page);
    const row = rowOf(page, RENAME).first();
    await button(row, "Undo").click();
    await expect(strip(page)).toBeVisible();
    await expect(strip(page)).toBeHidden({ timeout: 14_000 });
    await expect(button(row, "Redo")).toBeVisible();
  });

  test("UI — hover pauses the strip's expiry; leaving restarts it", async ({ page }) => {
    await openSeeded(page);
    await button(rowOf(page, RENAME).first(), "Undo").click();
    await strip(page).hover();
    await page.waitForTimeout(11_000);
    await expect(strip(page)).toBeVisible(); // paused past the 10 s
    await page.mouse.move(0, 0);
    await expect(strip(page)).toBeHidden({ timeout: 14_000 });
  });

  test("UI — error path: edited_later keeps the records, names the error and refreshes History without a success message", async ({ page }) => {
    const steer = await openSeeded(page);
    await steer.failNext("change_undo", "edited_later");
    const row = rowOf(page, RENAME).first();
    await button(row, "Undo").click();
    await expect(page.getByText(/edited (it )?later/i).first()).toBeVisible();
    await expect(strip(page).getByText(/^Undone/)).toHaveCount(0);
    await expect(row).toHaveAttribute("data-state", "applied");
    await expect.poll(async () => (await sent(page, "history_list")).length).toBeGreaterThan(1);
  });

  test("UI — error path: already_undone and not_undoable leave the records intact and refresh the row actions", async ({ page }) => {
    const steer = await openSeeded(page);
    await steer.failNext("change_undo", "already_undone");
    await button(rowOf(page, RENAME).first(), "Undo").click();
    await expect(strip(page).getByText(/^Undone/)).toHaveCount(0);
    await expect.poll(async () => (await sent(page, "history_list")).length).toBeGreaterThan(1);
    await steer.failNext("change_undo", "not_undoable");
    await button(rowOf(page, RENAME).first(), "Undo").click();
    await expect(strip(page).getByText(/^Undone/)).toHaveCount(0);
  });

  test("UI — a second click while the command is working sends one change_undo", async ({ page }) => {
    await openSeeded(page);
    await button(rowOf(page, RENAME).first(), "Undo").dblclick();
    await expect.poll(() => sent(page, "change_undo")).toHaveLength(1);
  });
});

// Needs the seeded job batch (Unblocker): Undo on a batch row targets the batch id and the strip names the returned count.
test.describe("cpt-noter-flow-ui-history-undo-reverse — Unblocker seed (batch)", () => {
  test("UI — batch: Undo on the batch row targets the batch id, never a row index, and the strip names the returned count", async ({ page }) => {
    await openHistory(page, withChanges);
    await button(rowOf(page, "Applied term “shaman”"), "Undo").click();
    expect(await sent(page, "change_undo")).toEqual([{ target: { type: "batch", batch_id: expect.any(String) } }]);
    await expect(strip(page)).toContainText(/Undone \d+ changes/);
  });
});
