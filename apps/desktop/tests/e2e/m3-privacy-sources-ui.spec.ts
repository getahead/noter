// M3 — Privacy audit and Knowledge Sources (docs/features/ui/privacy-sources.md). Stories `cpt-noter-seq-settings-check-privacy`
// (audit rows, export, Nothing has left this Mac) and `cpt-noter-seq-settings-add-knowledge-source` (Add Folder, indexing, Details,
// Re-index, Revoke Token, Remove). Commands: audit_list, audit_export, sources_list, source_add_folder, source_add_mcp, source_update,
// source_reindex, source_remove, source_revoke_token. Written before the panes exist (tests first). The native folder and save panels and
// the scripted MCP servers (`harness.mcp_server`) exist only in the real core, so these run there only
// (tests/conformance/m3-stories-knowledge.test.ts drives the commands at the contract).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";

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
  await page.getByRole("navigation", { name: "Settings panes" }).getByRole("option").filter({ hasText: name }).click();
  await expect(pane(page).getByRole("heading", { name, exact: true })).toBeVisible();
}

/** The folder the real core's open panel answers, with one note in it. */
async function knowledgeFolder(steer: Steer): Promise<void> {
  const { path } = (await steer.invoke("harness.data_dir", {})) as { path: string };
  const folder = join(path, "exports", "Knowledge folder");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "Launch plan.md"), "# Launch plan\n\n## Rollout\n\nThe gradual rollout ships to the beta ring on Friday.\n");
}

/** The core starts with no audit rows and no sources: a Claude-account run puts a row in the log (harness.llm_run). */
async function auditRows(steer: Steer, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await steer.invoke("harness.llm_run", { skill: "ask-answer" });
}

/** The knowledge folder as a source, indexed (the core's open panel picks it), and the window reloaded onto it. */
async function folderSource(page: Page, steer: Steer): Promise<void> {
  await knowledgeFolder(steer);
  const added = (await steer.invoke("source_add_folder", { path: null, privacy: "normal", scope: { type: "all_calls" } }, "settings")) as { id: string };
  await documentsOf(steer, added.id, 1);
  await page.reload();
}

/** The source's first sync has finished with `n` documents (the window reloads onto a settled core). */
const documentsOf = (steer: Steer, id: string, n: number) =>
  expect
    .poll(async () => ((await steer.invoke("sources_list", {}, "settings")) as { sources: Array<{ id: string; documents: number; last_sync_at: number | null }> }).sources.find((s) => s.id === id)?.last_sync_at, { timeout: 15000 })
    .not.toBeNull()
    .then(async () => expect(((await steer.invoke("sources_list", {}, "settings")) as { sources: Array<{ id: string; documents: number }> }).sources.find((s) => s.id === id)?.documents).toBe(n));

describeReal("cpt-noter-seq-settings-check-privacy", () => {
  test("happy path: Privacy lists what left this Mac in plain words and Export writes the log through the save panel", async ({ page }) => {
    const steer = await openWindow(page, "settings", { fixedClock: true });
    await auditRows(steer, 2);
    await page.reload();
    await openPane(page, "Privacy");
    const rows = pane(page).getByRole("row");
    await expect(rows.filter({ hasText: "api.anthropic.com" })).toHaveCount(2);
    await expect(pane(page)).not.toContainText("Nothing has left this Mac.");
    expect((await sent(page, "audit_list")).length).toBeGreaterThan(0);

    await button(pane(page), "Export…").click();
    await expect.poll(async () => (await sent(page, "audit_export")).length).toBe(1);
    await expect(pane(page)).toContainText(/Exported|Saved/); // success from the returned path only
  });

  test("other path — #1100: verifying an API key is listed as a Key or account check, not as summary text", async ({ page }) => {
    await openWindow(page, "settings", { fixedClock: true });
    await openPane(page, "Models & Runtimes");
    await pane(page).locator('[data-component="cpt-noter-component-ui-credential-row"]').filter({ hasText: "Anthropic API key" }).getByRole("button", { name: /^(Add|Replace)…$/ }).click();
    const keySheet = sheet(page, /Anthropic API Key/i);
    await keySheet.getByLabel("API key").fill("test-stand-in-value-0001"); // a stand-in, never a key shape
    await button(keySheet, "Verify").click();
    await expect(keySheet).toContainText("Verified · Claude Code can use this key");
    await button(keySheet, "Save").click();
    await expect(keySheet).toHaveCount(0);
    await openPane(page, "Privacy");
    const check = pane(page).getByRole("row").filter({ hasText: "api.anthropic.com" });
    await expect(check.first()).toContainText("Key or account check");
    await expect(check.filter({ hasText: "Summary text" })).toHaveCount(0);
  });

  test("other path: a cancelled save panel shows no success", async ({ page }) => {
    const steer = await openWindow(page, "settings", { fixedClock: true });
    await auditRows(steer, 1);
    await page.reload();
    await openPane(page, "Privacy");
    await steer.invoke("harness.cancel_next_save_panel", {});
    await button(pane(page), "Export…").click();
    await expect.poll(async () => (await sent(page, "audit_export")).length).toBe(1);
    await expect(pane(page)).not.toContainText(/Exported|Saved/);
  });

  test("empty path — Nothing has left this Mac: an empty log says so, only for the whole range", async ({ page }) => {
    await openWindow(page, "settings", { fixedClock: true });
    await openPane(page, "Privacy");
    await expect(pane(page)).toContainText("Nothing has left this Mac.");
    expect((await sent(page, "audit_list")).length).toBeGreaterThan(0);
  });
});

describeReal("cpt-noter-seq-settings-add-knowledge-source", () => {
  test("happy path: no sources, Add Folder…, indexing in the row, then the finished document count", async ({ page }) => {
    const steer = await openWindow(page, "settings", {});
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
    const steer = await openWindow(page, "settings", {});
    await steer.invoke("harness.mcp_server", {
      server: "notion",
      pages: [{ uri: "notion://roadmap", title: "Roadmap", hash: "h1", text: "# Roadmap\n\n## Milestones\n\nThe importer milestone closes in May.\n" }],
    });
    await openPane(page, "Knowledge Sources");
    await button(pane(page), /^Add MCP Server…$/).click();
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
    await watchAlerts(page); // before openWindow: it wraps the Tauri internals the window installs
    const steer = await openWindow(page, "settings", {});
    await steer.invoke("harness.mcp_server", { server: "notion", pages: [{ uri: "notion://a", title: "A", hash: "h", text: "# A\n\n## B\n\ntext\n" }] });
    const added = (await steer.invoke("source_add_mcp", { server: "notion", mode: "indexed", schedule: null, privacy: "normal", scope: { type: "all_calls" } }, "settings")) as { id: string };
    await documentsOf(steer, added.id, 1);
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
    await watchAlerts(page); // before openWindow: it wraps the Tauri internals the window installs
    const steer = await openWindow(page, "settings", {});
    await folderSource(page, steer); // one document
    await openPane(page, "Knowledge Sources");
    const row = sourceRow(page, "Knowledge folder");
    await expect(row).toContainText("1 document");
    await row.press("Enter");
    const details = sheet(page, /Knowledge folder|Details/);
    await button(details, "Remove Source").click(); // Cancel is the default answer
    const text = alertText((await alerts(page))[0]!);
    expect(text).toContain("Knowledge folder");
    expect(text).toContain("1");
    expect(await sent(page, "source_remove")).toHaveLength(0);
    await expect(row).toBeVisible();
    await answerAlerts(page, "confirm");
    await button(details, "Remove Source").click();
    await expect.poll(async () => (await sent(page, "source_remove")).length).toBe(1);
    await expect(row).toHaveCount(0);
    await expect(pane(page)).toContainText("No knowledge sources yet");
  });

  test("other path: a source limited to a call type and a person sends that scope, and the settings window lists the people", async ({ page }) => {
    const steer = await openWindow(page, "settings", {});
    await steer.invoke("person_create", { display_name: "Anna Kuz" }, "main");
    await steer.invoke("harness.mcp_server", { server: "notion", pages: [{ uri: "notion://a", title: "A", hash: "h", text: "# A\n\n## B\n\ntext\n" }] });
    await page.reload();
    await openPane(page, "Knowledge Sources");
    await button(pane(page), /^Add MCP Server…$/).click();
    const form = sheet(page, /MCP/);
    await form.getByRole("textbox", { name: "Server" }).fill("notion");
    await form.getByText("Only some call types").click();
    await form.getByRole("group", { name: "Call types" }).locator("label").first().click();
    await form.getByPlaceholder("Name…").fill("Anna");
    await form.getByRole("option", { name: /Anna Kuz/ }).first().click();
    await form.locator(".np-sheet__title").click(); // the picker keeps its list open after a pick; leaving it closes the list
    await button(form, "Add Source").click();
    const scope = ((await sent(page, "source_add_mcp"))[0] as { scope: { type: string; call_types: string[]; people: string[] } }).scope;
    expect(scope.type).toBe("limited");
    expect(scope.call_types).toHaveLength(1);
    expect(scope.people).toHaveLength(1);
  });
});
