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
});
