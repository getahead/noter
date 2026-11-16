// M3 — Privacy audit and Knowledge Sources (docs/features/ui/privacy-sources.md). Stories `cpt-noter-seq-settings-check-privacy`
// (audit rows, export, Nothing has left this Mac) and `cpt-noter-seq-settings-add-knowledge-source` (Add Folder, indexing, Details,
// Re-index, Revoke Token, Remove). Commands: audit_list, audit_export, sources_list, source_add_folder, source_add_mcp, source_update,
// source_reindex, source_remove, source_revoke_token. Written before the panes exist (tests first). The native folder and save panels and
// the scripted MCP servers (`harness.mcp_server`) exist only in the real core, so these run there only
// (tests/conformance/m3-stories-knowledge.test.ts drives the commands at the contract).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { openWindow, type Steer } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import { alerts, alertText, answerAlerts, watchAlerts } from "./support/native-alert";

// native panels and scripted MCP servers exist only in the real core: on the fake core these stories are not registered
const describeReal = process.env.NOTER_CORE === "stdio" ? test.describe : (_title: string, _body: () => void): void => {};

const pane = (page: Page) => page.locator('[data-region="ST-R2"]');
const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name });
const sheet = (page: Page, name: RegExp) => page.getByRole("dialog", { name });
const sourceRow = (page: Page, name: string) => pane(page).locator('[data-component="cpt-noter-component-ui-status-row"]').filter({ hasText: name });

async function openPane(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Settings panes" }).getByRole("listitem").filter({ hasText: name }).click();
  await expect(pane(page).getByRole("heading", { name, exact: true })).toBeVisible();
}

/** The folder the real core's open panel answers, with one note in it. */
async function knowledgeFolder(steer: Steer): Promise<void> {
  const { path } = (await steer.invoke("harness.data_dir", {})) as { path: string };
  const folder = join(path, "exports", "Knowledge folder");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "Launch plan.md"), "# Launch plan\n\n## Rollout\n\nThe gradual rollout ships to the beta ring on Friday.\n");
}

const noSources = (w: Parameters<typeof W.idle>[0]) => (W.idle(w), (w.sources.sources.length = 0));

describeReal("cpt-noter-seq-settings-check-privacy", () => {
  test("happy path: Privacy lists what left this Mac in plain words and Export writes the log through the save panel", async ({ page }) => {
    await openWindow(page, "settings", { fixedClock: true, world: (w) => W.idle(w) });
    await openPane(page, "Privacy");
    const rows = pane(page).getByRole("row");
    await expect(rows.filter({ hasText: "api.anthropic.com" })).toHaveCount(2);
    await expect(pane(page)).toContainText("Planning: VHI 8.0 drawer redesign");
    await expect(pane(page)).toContainText("Backend sync");
    await expect(pane(page)).not.toContainText("Nothing has left this Mac.");
    expect((await sent(page, "audit_list")).length).toBeGreaterThan(0);

    await button(pane(page), "Export…").click();
    await expect.poll(async () => (await sent(page, "audit_export")).length).toBe(1);
    await expect(pane(page)).toContainText(/Exported|Saved/); // success from the returned path only
  });

  test("other path: a cancelled save panel shows no success", async ({ page }) => {
    const steer = await openWindow(page, "settings", { fixedClock: true, world: (w) => W.idle(w) });
    await openPane(page, "Privacy");
    await steer.invoke("harness.cancel_next_save_panel", {});
    await button(pane(page), "Export…").click();
    await expect.poll(async () => (await sent(page, "audit_export")).length).toBe(1);
    await expect(pane(page)).not.toContainText(/Exported|Saved/);
  });

  test("empty path — Nothing has left this Mac: an empty log says so, only for the whole range", async ({ page }) => {
    await openWindow(page, "settings", { fixedClock: true, world: (w) => (W.idle(w), (w.audit.length = 0)) });
    await openPane(page, "Privacy");
    await expect(pane(page)).toContainText("Nothing has left this Mac.");
    expect((await sent(page, "audit_list")).length).toBeGreaterThan(0);
  });
});

describeReal("cpt-noter-seq-settings-add-knowledge-source", () => {
  test("happy path: no sources, Add Folder…, indexing in the row, then the finished document count", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: noSources });
    await knowledgeFolder(steer);
    await openPane(page, "Knowledge Sources");
    await expect(pane(page)).toContainText("No knowledge sources yet");

    await button(pane(page), /^Add Folder…$/).click();
    const dlg = sheet(page, /Add Folder/);
    await expect(dlg.getByRole("radio", { name: /Indexed/ })).toBeChecked(); // defaults: Indexed, Normal, all calls
    await button(dlg, "Add Source").click();
    const added = (await sent(page, "source_add_folder"))[0] as Record<string, unknown>;
    expect(added).toMatchObject({ path: null, privacy: "normal", scope: { type: "all_calls" } }); // the core's panel picks the folder
    await expect(dlg).toHaveCount(0);

    const row = sourceRow(page, "Knowledge folder");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Up to date"); // after Running, from the core's progress
    await expect(row).toContainText(/1 document/);
  });

  test("other path: Details changes the name and schedule with a revision; Re-index runs once", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: noSources });
    await steer.invoke("harness.mcp_server", {
      server: "notion",
      pages: [{ uri: "notion://roadmap", title: "Roadmap", hash: "h1", text: "# Roadmap\n\n## Milestones\n\nThe importer milestone closes in May.\n" }],
    });
    await openPane(page, "Knowledge Sources");
    await button(pane(page), "+").click();
    await page.getByRole("menuitem", { name: /Add MCP Server/ }).click();
    const form = sheet(page, /MCP/);
    await form.getByRole("textbox", { name: "Server" }).fill("notion");
    await expect(form).toContainText(/Indexed/);
    await button(form, "Add Source").click();
    expect((await sent(page, "source_add_mcp"))[0]).toMatchObject({ server: "notion", mode: "indexed", privacy: "normal", scope: { type: "all_calls" } });
    const row = sourceRow(page, "notion");
    await expect(row).toContainText("Up to date");

    await row.press("Enter"); // Return opens Details
    const details = sheet(page, /notion|Details/);
    await details.getByRole("textbox", { name: "Name" }).fill("Team wiki");
    await button(details, "Save").click();
    expect((await sent(page, "source_update"))[0]).toMatchObject({ name: "Team wiki", rev: 1 });
    await expect(sourceRow(page, "Team wiki")).toBeVisible();

    await button(sourceRow(page, "Team wiki"), /Re-index/).click();
    expect(await sent(page, "source_reindex")).toHaveLength(1);
    await expect(sourceRow(page, "Team wiki")).toContainText("Up to date");
  });

  test("other path: Revoke Token asks first (Cancel default) and the row shows Sign-in expired", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: noSources });
    await watchAlerts(page);
    await steer.invoke("harness.mcp_server", { server: "notion", pages: [{ uri: "notion://a", title: "A", hash: "h", text: "# A\n\n## B\n\ntext\n" }] });
    await steer.invoke("source_add_mcp", { server: "notion", mode: "indexed", schedule: null, privacy: "normal", scope: { type: "all_calls" } }, "settings");
    await page.reload();
    await openPane(page, "Knowledge Sources");
    const row = sourceRow(page, "notion");
    await row.press("Enter");
    const details = sheet(page, /notion|Details/);
    await button(details, "Revoke Token").click();
    expect((await alerts(page)).length).toBe(1);
    expect(await sent(page, "source_revoke_token")).toHaveLength(0);
    await answerAlerts(page, "confirm");
    await button(details, "Revoke Token").click();
    await expect.poll(async () => (await sent(page, "source_revoke_token")).length).toBe(1);
    await expect(sourceRow(page, "notion")).toContainText("Sign-in expired");
  });

  test("other path — Remove the source: the alert names it and its documents; confirming drops the row", async ({ page }) => {
    await openWindow(page, "settings", { world: (w) => W.idle(w) }); // the fixture's Frontend specs folder: 128 documents
    await watchAlerts(page);
    await openPane(page, "Knowledge Sources");
    const row = sourceRow(page, "Frontend specs");
    await expect(row).toContainText("128");
    await row.press("Enter");
    const details = sheet(page, /Frontend specs|Details/);
    await button(details, "Remove Source").click(); // Cancel is the default answer
    const text = alertText((await alerts(page))[0]!);
    expect(text).toContain("Frontend specs");
    expect(text).toContain("128");
    expect(await sent(page, "source_remove")).toHaveLength(0);
    await expect(row).toBeVisible();
    await answerAlerts(page, "confirm");
    await button(details, "Remove Source").click();
    await expect.poll(async () => (await sent(page, "source_remove")).length).toBe(1);
    await expect(row).toHaveCount(0);
    await expect(pane(page)).toContainText("No knowledge sources yet");
  });
});
