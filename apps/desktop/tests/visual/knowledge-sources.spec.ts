// Screenshot specs of Settings › Knowledge Sources (docs/features/ui/privacy-sources.md › Acceptance): the empty state,
// the indexing, failed, expired and paused-Live rows, and the two add sheets, rendered against the fake core.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import type { SourceRow } from "../../src/core/bindings";
import { openWindow, type CorePlan } from "../e2e/support/app";

const source = (o: Partial<SourceRow>): SourceRow => ({ id: "src_1", rev: 1, kind: "folder", name: "Notes", location: "~/Documents/Notes", mode: "indexed", schedule: null, privacy: "normal", scope: { type: "all_calls" }, status: { type: "idle" }, documents: 128, last_sync_at: 1_760_600_000_000, has_token: false, ...o });
const pane = (page: Page) => page.locator('[data-region="ST-R2"]');

async function show(page: Page, sources: SourceRow[], plan: CorePlan = {}) {
  await openWindow(page, "settings", { fixedClock: true, ...plan, world: (w) => { plan.world?.(w); w.sources.sources = sources; } });
  await page.getByRole("navigation", { name: "Settings panes" }).getByRole("option").filter({ hasText: "Knowledge Sources" }).click();
  await expect(pane(page).getByRole("heading", { name: "Knowledge Sources", exact: true })).toBeVisible();
}
const shot = (page: Page, name: string) => expect(page.locator('[data-region="window"]')).toHaveScreenshot(`knowledge-sources-${name}.png`);

test.describe("Knowledge Sources states", () => {
  test("empty: No knowledge sources yet", async ({ page }) => {
    await show(page, []);
    await shot(page, "empty");
  });
  test("indexing: a folder with done of total", async ({ page }) => {
    await show(page, [source({ status: { type: "indexing", done: 9, total: 24 } })]);
    await shot(page, "indexing");
  });
  test("failed and expired rows", async ({ page }) => {
    await show(page, [source({ id: "src_2", name: "Specs", status: { type: "failed", code: "source_sync_failed", at: 1_760_600_000_000 } }), source({ id: "src_3", kind: "mcp", name: "Wiki", location: "wiki", has_token: true, status: { type: "sign_in_expired" } })]);
    await shot(page, "failed-expired");
  });
  test("live source paused outside Cloud allowed, and a Sensitive one", async ({ page }) => {
    await show(page, [source({ id: "src_4", kind: "mcp", name: "Tracker", location: "tracker", mode: "live" }), source({ id: "src_5", privacy: "sensitive", name: "HR notes" })], { world: (w) => (w.settings.privacy.mode = "local_only") });
    await shot(page, "live-paused");
  });
  test("Add Folder sheet", async ({ page }) => {
    await show(page, []);
    await pane(page).getByRole("button", { name: "Add Folder…" }).click();
    await expect(page.getByRole("dialog", { name: "Add Folder" })).toBeVisible();
    await shot(page, "add-folder");
  });
  test("Add MCP Server sheet", async ({ page }) => {
    await show(page, [source({})]);
    await pane(page).getByRole("button", { name: "Add MCP Server…" }).click();
    await expect(page.getByRole("dialog", { name: "Add MCP Server" })).toBeVisible();
    await shot(page, "add-mcp");
  });
  test("Details sheet of an MCP source with a token", async ({ page }) => {
    await show(page, [source({ id: "src_6", kind: "mcp", name: "Wiki", location: "wiki", schedule: "daily", has_token: true, documents: 42 })]);
    await pane(page).getByRole("button", { name: "Details" }).click();
    await expect(page.getByRole("dialog", { name: "Wiki" })).toBeVisible();
    await shot(page, "details");
  });
  test("Add Folder with a scope limited to call types", async ({ page }) => {
    await show(page, []);
    await pane(page).getByRole("button", { name: "Add Folder…" }).click();
    const dlg = page.getByRole("dialog", { name: "Add Folder" });
    await dlg.getByText("Only some call types").click();
    await expect(dlg.getByRole("group", { name: "Call types" })).toBeVisible();
    await shot(page, "add-folder-limited-scope");
  });
});
