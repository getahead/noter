// Settings mappings use the same core repository list as the handoff drawer.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import { alerts, answerAlerts, watchAlerts } from "./support/native-alert";

test.describe("cpt-noter-seq-call-page-hand-off-item — repository settings", () => {
  test("UI — happy path: add, change default tool, edit and confirmed removal persist; cancelled removal keeps the row", async ({ page }) => {
    await watchAlerts(page);
    await openWindow(page, "settings");
    await page.getByRole("navigation", { name: "Settings panes" }).getByRole("listitem").filter({ hasText: "Repositories" }).click();
    const pane = page.locator('[data-region="ST-R2"]');
    await pane.getByRole("button", { name: "Add Mapping…" }).click();
    const sheet = page.getByRole("dialog", { name: "Add Mapping", exact: true });
    await sheet.getByRole("textbox", { name: "Jira project or component" }).fill("REPOTEST");
    const folder = mkdtempSync(join(tmpdir(), "noter-settings-repo-"));
    await sheet.getByRole("textbox", { name: "Folder", exact: true }).fill(folder);
    await sheet.getByRole("button", { name: "Add Mapping", exact: true }).click();
    const row = pane.getByRole("row").filter({ hasText: "REPOTEST" });
    await expect(row).toContainText(folder);
    await row.getByRole("combobox", { name: "Default tool" }).selectOption("codex");
    await expect.poll(() => sent(page, "repo_upsert")).toContainEqual(expect.objectContaining({ key: "REPOTEST", default_tool: "codex" }));
    await row.click();
    await pane.getByRole("button", { name: "Edit Mapping…" }).click();
    const edit = page.getByRole("dialog", { name: "Edit Mapping", exact: true });
    await edit.getByRole("textbox", { name: "Jira project or component" }).fill("REPOEDIT");
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    const edited = pane.getByRole("row").filter({ hasText: "REPOEDIT" });
    await expect(edited).toBeVisible();
    await edited.click();
    await pane.getByRole("button", { name: "Remove Mapping", exact: true }).click();
    await expect.poll(async () => (await alerts(page)).length).toBe(1);
    expect(await sent(page, "repo_remove")).toHaveLength(0);
    await expect(edited).toBeVisible();
    await answerAlerts(page, "confirm");
    await pane.getByRole("button", { name: "Remove Mapping", exact: true }).click();
    await expect(edited).toHaveCount(0);
    expect(await sent(page, "repo_remove")).toHaveLength(1);
  });

  test("UI — error path: a refused folder save keeps the draft for correction", async ({ page }) => {
    const steer = await openWindow(page, "settings");
    await page.getByRole("navigation", { name: "Settings panes" }).getByRole("listitem").filter({ hasText: "Repositories" }).click();
    await page.getByRole("button", { name: "Add Mapping…" }).click();
    const sheet = page.getByRole("dialog", { name: "Add Mapping", exact: true });
    await sheet.getByRole("textbox", { name: "Jira project or component" }).fill("REPOFAIL");
    await sheet.getByRole("textbox", { name: "Folder", exact: true }).fill("/missing/noter-folder");
    await steer.failNext("repo_upsert", "repo_path_missing");
    await sheet.getByRole("button", { name: "Add Mapping", exact: true }).click();
    await expect(sheet).toContainText("That folder is missing");
    await expect(sheet.getByRole("textbox", { name: "Folder", exact: true })).toHaveValue("/missing/noter-folder");
    await sheet.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(sheet).toHaveCount(0);
  });
});
