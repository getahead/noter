// M2 — History (docs/features/ui/history-undo.md). Stories: `cpt-noter-seq-call-page-review-outputs` (No changes yet,
// Export the call's change log) and `cpt-noter-seq-call-page-check-evidence` (Item History). Commands: history_list,
// history_export, item_review. Runs on the fake and the real core; the partial strip is a fake-world visual (the UI cannot
// seed an edited-later batch in the real core).
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { hold } from "../visual/hold";
import { calls, openWindow, type CorePlan } from "./support/app";
import * as O from "./support/outputs-world";
import { navigate as navigateCall, sent as sentCommands } from "./support/call-page";
import { expect, test } from "./support/fixtures";

const TIMELINE = '[data-component="cpt-noter-component-ui-history-timeline"]';
const INSPECTOR = '[data-component="cpt-noter-component-ui-item-inspector"]';
const CHANGE = '[data-component="cpt-noter-component-ui-change-row"]';
const ROW = '[data-component="cpt-noter-component-ui-action-item-row"], [data-component="cpt-noter-component-ui-output-item-row"]';
const toolbar = (page: Page) => page.locator('[data-region="PC-R1"]');

/** The written outputs with a suggested decision, then Backend sync the way the core opens it (`window_navigate`) on `tab`. */
async function openCall(page: Page, tab: "summary" | "history", plan: Pick<CorePlan, "latency" | "latencyFor"> & { seedHistory?: boolean } = {}) {
  const { seedHistory = false, ...openPlan } = plan;
  await openWindow(page, "main", {
    ...openPlan,
    world: (w) => {
      O.written(w);
      if (seedHistory) w.changes.push(
        { id: "chg_history_you", batch_id: null, batch_size: 1, at: Date.now(), actor: { type: "you" }, entity: { id: W.PAST_CALL, kind: "call", label: O.TITLE }, field: "title", before: "Old title", after: "Backend sync", summary: "Renamed the call", reason: null, evidence: [], confidence: null, status: "applied", undoable: true, redoable: false },
        { id: "chg_history_job", batch_id: null, batch_size: 1, at: Date.now(), actor: { type: "job", job_id: "job_evidence", name: "Evidence" }, entity: { id: W.PAST_CALL, kind: "call", label: O.TITLE }, field: "title", before: "Earlier title", after: "Backend sync", summary: "Updated the call", reason: null, evidence: [], confidence: null, status: "applied", undoable: true, redoable: false },
      );
      for (const i of O.outputsOf(w).sections.flatMap((s) => s.items)) if (i.id === "itm_d1") Object.assign(i, { review: "suggested", created_by: "llm" });
      O.outputsOf(w).review_waiting = 1;
    },
  });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit3");
    await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await navigateCall(page, tab);
  await expect(toolbar(page)).toContainText(O.TITLE);
}

test.describe("cpt-noter-seq-call-page-review-outputs", () => {
  test("cpt-noter-seq-call-page-review-outputs — actor and job filters reload history with the selected values", async ({ page }) => {
    await openCall(page, "history", { seedHistory: true });
    const history = page.locator(TIMELINE);
    await history.getByRole("radio", { name: "You", exact: true }).click();
    await expect.poll(async () => (await sentCommands(page, "history_list")).at(-1)?.actor).toBe("you");
    await history.getByRole("radio", { name: "Jobs", exact: true }).click();
    await expect.poll(async () => (await sentCommands(page, "history_list")).at(-1)?.actor).toBe("jobs");
    await history.getByRole("combobox", { name: "Job" }).selectOption("job_evidence");
    await expect.poll(async () => (await sentCommands(page, "history_list")).at(-1)?.job_id).toBe("job_evidence");
  });

  test("UI — paging and refresh — History reads older pages and call changes while it is open", async ({ page }) => {
    await openCall(page, "history");
    await page.evaluate(async (callId) => {
      const g = globalThis as unknown as {
        __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> };
        __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> };
      };
      const invoke = (name: string, args: unknown) => g.__noterFake
        ? g.__noterFake.invoke(name, args)
        : g.__TAURI_INTERNALS__!.invoke(name, { args });
      const page = await invoke("calls_list", { filter: {}, sort: "newest", page: {} }) as { rows: { id: string; rev: number }[] };
      let call = page.rows.find((row) => row.id === callId)!;
      for (let i = 0; i < 101; i++) {
        const changed = await invoke("call_update", { call_id: callId, rev: call.rev, title: `History revision ${i}` }) as { call: typeof call };
        call = changed.call;
      }
    }, W.PAST_CALL);
    await expect(page.locator(CHANGE)).toHaveCount(101, { timeout: 15_000 });
  });

  test("UI — empty path — No changes yet: a call nobody changed shows the empty History", async ({ page }) => {
    await openCall(page, "history");
    await expect(page.locator(TIMELINE)).toBeVisible();
    await expect(page.getByText("No changes yet")).toBeVisible();
    expect((await calls(page)).filter((c) => c.kind === "invoke" && c.name === "history_list").length).toBeGreaterThan(0);
  });

  test("UI — Other — Export the call's change log: Export Log sends the call scope and reports where it went", async ({ page }) => {
    await openCall(page, "history");
    await page.getByRole("button", { name: "Export Log…" }).click();
    const sheet = page.getByRole("dialog", { name: /Export Log/ });
    await expect(sheet).toContainText("Whole call");
    await sheet.getByRole("button", { name: "Export…" }).click();
    const sent = (await calls(page)).filter((c) => c.kind === "invoke" && c.name === "history_export").map((c) => c.args as Record<string, unknown>);
    expect(sent).toEqual([expect.objectContaining({ scope: { type: "call", call_id: W.PAST_CALL }, format: "markdown" })]);
    await expect(page.getByText(/Exported log to /)).toBeVisible();
  });

  test("UI — Other — Return while the export runs does not start a second one", async ({ page }) => {
    const real = process.env.NOTER_CORE === "stdio"; // only the fake can park one command; the real core answers after a latency
    await openCall(page, "history", real ? { latency: 8_000, latencyFor: "history_export" } : {});
    const release = real ? undefined : await hold(page, "history_export");
    await page.getByRole("button", { name: "Export Log…" }).click();
    const sheet = page.getByRole("dialog", { name: /Export Log/ });
    await page.keyboard.press("Enter");
    await expect(sheet).toHaveAttribute("data-state", "busy");
    await page.keyboard.press("Enter");
    await release?.();
    await expect(page.getByText(/Exported log to /)).toBeVisible({ timeout: 15_000 });
    const sent = (await calls(page)).filter((c) => c.kind === "invoke" && c.name === "history_export");
    expect(sent).toHaveLength(1);
  });
});

test.describe("cpt-noter-seq-call-page-check-evidence", () => {
  test("UI — Other — Item History: an accepted decision lists its change in the inspector's History, with no export control", async ({ page }) => {
    await openCall(page, "summary");
    await page.locator(ROW).filter({ hasText: "Ship drawer events behind a flag" }).getByRole("button", { name: "Edit" }).click();
    const inspector = page.locator(INSPECTOR);
    await inspector.getByRole("button", { name: "Accept" }).click();
    await inspector.getByRole("tab", { name: "History" }).click();
    await expect(inspector.locator(CHANGE).first()).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Export Log…" })).toHaveCount(0);
  });
});
