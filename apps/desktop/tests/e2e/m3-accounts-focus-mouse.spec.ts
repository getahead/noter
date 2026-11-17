// M3 — focus after a surface closes when it was opened with the mouse (docs/features/ui/accounts.md, DESIGN › Focus order):
// WebKit does not focus a button on click, so every path below must hand focus back to the control that opened it
// (or to the row that replaced it), never to the body. Default-button closes and a cancelled Remove Mapping alert.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import { openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";
import { watchAlerts } from "./support/native-alert";

const pane = (page: Page) => page.locator('[data-region="ST-R2"]');
const open = async (page: Page, name: string) => {
  await openWindow(page, "settings");
  await page.getByRole("navigation", { name: "Settings panes" }).getByRole("listitem").filter({ hasText: name }).click();
};
const focused = (page: Page) => page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? ""}`.trim());

test.describe("cpt-noter-seq-settings-replace-api-key — focus with the mouse", () => {
  test("happy path: Save on the key sheet returns focus to the row's Add… or Replace… button", async ({ page }) => {
    await open(page, "Models & Runtimes");
    const row = pane(page).locator('[data-component="cpt-noter-component-ui-credential-row"]').filter({ hasText: "Anthropic API key" });
    await row.getByRole("button", { name: /^(Add|Replace)…$/ }).click();
    const sheet = page.getByRole("dialog", { name: /Anthropic API Key/i });
    await sheet.getByLabel("API key").fill("test-stand-in-value-0001");
    await sheet.getByRole("button", { name: "Verify" }).click();
    await expect(sheet).toContainText("Verified");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Replace…" })).toBeFocused();
  });
});

test.describe("cpt-noter-seq-call-page-hand-off-item — focus with the mouse", () => {
  test("happy path: Add Mapping closes on its default button and Cancel on Remove Mapping keeps focus on the button", async ({ page }) => {
    await watchAlerts(page);
    await open(page, "Repositories");
    await pane(page).getByRole("button", { name: "Add Mapping…" }).click();
    const sheet = page.getByRole("dialog", { name: "Add Mapping", exact: true });
    await sheet.getByRole("textbox", { name: "Jira project or component" }).fill("FOCUSMAP");
    await sheet.getByRole("textbox", { name: "Folder", exact: true }).fill(mkdtempSync(join(tmpdir(), "noter-focus-")));
    await sheet.getByRole("button", { name: "Add Mapping", exact: true }).click();
    const row = pane(page).getByRole("row").filter({ hasText: "FOCUSMAP" });
    await expect(row).toBeVisible();
    await expect(pane(page).getByRole("button", { name: "Add Mapping…" })).toBeFocused();
    await row.click();
    await pane(page).getByRole("button", { name: "Remove Mapping", exact: true }).click(); // the alert answers Cancel
    await expect(pane(page).getByRole("button", { name: "Remove Mapping", exact: true })).toBeFocused();
  });
});

test.describe("cpt-noter-flow-ui-settings-change-setting (glossary) — focus with the mouse", () => {
  test("happy path: Add Term and Edit then Esc leave focus on their buttons", async ({ page }) => {
    await open(page, "Audio & Transcription");
    const glossary = pane(page).getByRole("table", { name: "Glossary" });
    await pane(page).getByRole("button", { name: "Add Term" }).click();
    await page.getByRole("textbox", { name: "Term" }).fill("Focusterm");
    await pane(page).getByRole("button", { name: "Add", exact: true }).click();
    const row = glossary.getByRole("row").filter({ hasText: "Focusterm" });
    await expect(row).toBeVisible();
    expect(await focused(page)).toContain("Add Term");
    await row.click();
    await pane(page).getByRole("button", { name: "Edit Term", exact: true }).click();
    await page.getByRole("textbox", { name: "Term" }).press("Escape");
    await expect(page.getByRole("textbox", { name: "Term" })).toHaveCount(0);
    expect(await focused(page)).toContain("Edit Term");
  });
});
