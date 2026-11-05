// Screenshot specs of History and the undo strip (docs/features/ui/history-undo.md › Definitions of Done): the call
// History ready (single, batch, model run, undone rows), empty, filtered empty and error, the diff view (changes, none,
// folded) and the strip working and switched, rendered against the fake world. Baselines come from the
// update-screenshots workflow only. A partial strip needs a fake `change_undo` that skips edited-later rows (contract lane).
import { expect, test, type Page } from "@playwright/test";

import type { ChangeRow } from "../../src/core/bindings";
import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";

type Fake = { invoke: (cmd: string, args: unknown) => Promise<unknown>; latency: number };
const T0 = 1_792_000_000_000;
const change = (id: string, over: Partial<ChangeRow> = {}): ChangeRow =>
  ({
    id,
    at: T0,
    actor: { type: "you" },
    entity: { id: W.PAST_CALL, kind: "call", label: "Backend sync" },
    field: "title",
    before: "Sync",
    after: "Backend sync",
    summary: "Renamed the call to “Backend sync”",
    reason: null,
    confidence: "high",
    evidence: [],
    batch_id: null,
    batch_size: 1,
    status: "applied",
    undoable: true,
    redoable: false,
    ...over,
  }) as ChangeRow;
const lines = (n: number) => Array.from({ length: n }, (_, i) => `Decision ${i + 1}: keep the staging token for the release`).join("\n");
const rows = (): ChangeRow[] => [
  change("chg_rename"),
  change("chg_notes", { at: T0 - 30_000, field: "notes", before: `${lines(8)}\nShip on Friday`, after: `${lines(8)}\nShip on Monday`, summary: "Edited the notes" }),
  change("chg_same", { at: T0 - 45_000, field: "type", before: "Planning", after: "Planning", summary: "Set the call type to Planning" }),
  change("chg_batch", { at: T0 - 60_000, actor: { type: "job", job_id: "job_reconcile", name: "Reconcile terms and references" }, batch_id: "bat_shaman", batch_size: 37, field: null, before: null, after: null, summary: "Applied term “shaman” to 37 segments" }),
  change("chg_model", { at: T0 - 90_000, actor: { type: "model", llm_run_id: "run_1", runtime: "claude_account", model: "sonnet" }, entity: { id: W.PAST_CALL, kind: "call", label: "Backend sync" }, field: null, before: null, after: null, summary: "Regenerated the summary" }),
  change("chg_undone", { at: T0 - 150_000, status: "undone", undoable: false, redoable: true, summary: "Set the call type to Standup" }),
];
const quiet = (changes: ChangeRow[]) => (w: World) => {
  W.idle(w);
  w.app.setup.self_test = { type: "passed", at: 1 };
  w.changes = changes;
};
const ready = (page: Page) => expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
const TIMELINE = '[data-component="cpt-noter-component-ui-history-timeline"]';

async function open(page: Page, changes: ChangeRow[], fail: Array<{ cmd: "history_list"; code: "change_log_unreadable" }> = []) {
  await openWindow(page, "main", { world: quiet(changes), fail });
  await ready(page);
  await page.waitForFunction(() => (globalThis as unknown as { __noterFake?: Fake }).__noterFake);
  await page.evaluate((id) => (globalThis as unknown as { __noterFake: Fake }).__noterFake.invoke("window_navigate", { target: { type: "call_page", call_id: id, tab: "history" } }), W.PAST_CALL);
  await expect(page.locator(TIMELINE)).toBeVisible();
}
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.describe("cpt-noter-dod-ui-history-undo-timeline call History", () => {
  test("ready: single, batch, model run and undone rows", async ({ page }) => {
    await open(page, rows());
    await expect(page.locator('[data-component="cpt-noter-component-ui-change-row"]')).toHaveCount(6);
    await shot(page, "history-ready");
  });

  test("empty: No changes yet", async ({ page }) => {
    await open(page, []);
    await expect(page.getByText("No changes yet")).toBeVisible();
    await shot(page, "history-empty");
  });

  test("filtered empty: Models names the filter", async ({ page }) => {
    await open(page, rows().filter((r) => r.actor.type !== "model"));
    await page.locator(TIMELINE).getByRole("radio", { name: "Models" }).click();
    await expect(page.getByText("No changes by Models")).toBeVisible();
    await shot(page, "history-filtered-empty");
  });

  test("error: change_log_unreadable with Try Again", async ({ page }) => {
    await open(page, rows(), [{ cmd: "history_list", code: "change_log_unreadable" }]);
    await expect(page.getByText("Couldn’t read the history of this call.")).toBeVisible();
    await shot(page, "history-error");
  });

  test("diff: changes, no differences, folded lines", async ({ page }) => {
    await open(page, rows());
    const row = (text: string) => page.locator('[data-component="cpt-noter-component-ui-change-row"]').filter({ hasText: text });
    await row("Renamed the call").getByRole("button", { name: "Diff" }).click();
    await row("Edited the notes").getByRole("button", { name: "Diff" }).click();
    await row("Set the call type to Planning").getByRole("button", { name: "Diff" }).click();
    await expect(page.getByText("No differences")).toBeVisible();
    await expect(page.getByText(/unchanged lines/)).toBeVisible();
    await shot(page, "history-diff");
  });
});

test.describe("cpt-noter-dod-ui-history-undo-undo undo strip", () => {
  test("working: the strip keeps its message with a spinner while the core answers", async ({ page }) => {
    await open(page, rows());
    await page.evaluate(() => ((globalThis as unknown as { __noterFake: Fake }).__noterFake.latency = 4000));
    await page.locator('[data-component="cpt-noter-component-ui-change-row"]').filter({ hasText: "Renamed the call" }).getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('[data-component="cpt-noter-component-ui-undo-strip"]')).toHaveAttribute("data-state", "working");
    await shot(page, "strip-working");
  });

  test("switched: Undone 1 change with Redo", async ({ page }) => {
    await open(page, rows());
    await page.locator('[data-component="cpt-noter-component-ui-change-row"]').filter({ hasText: "Renamed the call" }).getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('[data-component="cpt-noter-component-ui-undo-strip"]')).toHaveAttribute("data-state", "switched");
    await expect(page.getByRole("button", { name: "Redo" }).first()).toBeVisible();
    await shot(page, "strip-switched");
  });
});
