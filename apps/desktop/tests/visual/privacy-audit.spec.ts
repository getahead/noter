// Screenshot specs of Settings › Privacy › What left this Mac when it opens on one call (the Call info link) and
// while more pages remain (docs/features/ui/privacy-sources.md › Acceptance), rendered against the fake core.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import type { AuditEntry } from "../../src/core/bindings";
import { coreReady, openWindow } from "../e2e/support/app";

const CALL = { id: "call_backend", title: "Backend sync", started_at: 1_760_600_000_000, call_type: "standup" };
const entry = (i: number, call: typeof CALL | null): AuditEntry => ({ id: `aud_${i}`, kind: "run", llm_run_id: null, at: 1_760_600_000_000 + i * 60_000, call, runtime: null, destination: "api.anthropic.com", what: "full_transcript", bytes_out: 1800 + i, redacted: false });
const pane = (page: Page) => page.locator('[data-region="ST-R2"]');

async function show(page: Page, rows: AuditEntry[], call?: string) {
  await openWindow(page, "settings", { fixedClock: true, world: (w) => (w.audit = rows) });
  await coreReady(page);
  await page.getByRole("navigation", { name: "Settings panes" }).getByRole("option").filter({ hasText: "Privacy" }).click();
  if (call) {
    await page.evaluate((id) => (globalThis as unknown as { __noterFake: { invoke: (c: string, a: unknown) => unknown } }).__noterFake.invoke("window_navigate", { target: { type: "settings", pane: "privacy", call_id: id } }), call);
  }
  await expect(pane(page).getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
}
const group = (page: Page) => pane(page).locator(".st-group", { hasText: "What left this Mac" });

test.describe("Privacy audit states", () => {
  test("opened on a call: only that call's rows, the filter and Export…", async ({ page }) => {
    await show(page, [entry(1, CALL), entry(2, null), entry(3, CALL)], CALL.id);
    await expect(pane(page)).toContainText("Call: Backend sync");
    await expect(group(page)).toHaveScreenshot("privacy-audit-call.png");
  });

  test("opened on a call with no rows: the call-filtered empty state", async ({ page }) => {
    await show(page, [entry(1, null)], CALL.id);
    await expect(pane(page)).toContainText("No requests match this call.");
    await expect(group(page)).toHaveScreenshot("privacy-audit-call-empty.png");
  });

  test("more pages remain: the footer shows the core's total next to Load More and Export…", async ({ page }) => {
    await show(page, Array.from({ length: 120 }, (_, i) => entry(i, null)));
    const foot = pane(page).locator(".st-audit__foot");
    await expect(foot).toContainText("of 120 entries so far");
    await expect(foot).toHaveScreenshot("privacy-audit-total.png");
  });
});
