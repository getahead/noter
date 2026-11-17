// M3 — focus after a surface closes when it was opened with the mouse (docs/features/ui/accounts.md, DESIGN › Focus order):
// WebKit does not focus a button on click, so every path below must hand focus back to the control that opened it
// (or to the row that replaced it), never to the body. Default-button closes and a cancelled Remove Mapping alert.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
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

test.describe("cpt-noter-flow-ui-settings-change-setting (repositories) — focus with the mouse", () => {
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

test.describe("cpt-noter-seq-settings-sign-in-account — focus with the mouse", () => {
  for (const provider of ["ChatGPT", "Claude"]) {
    test(`happy path: confirming Sign Out puts focus on the ${provider} row's Sign In button`, async ({ page }) => {
      const steer = await openWindow(page, "settings", {
        world: (w) => {
          W.idle(w);
          for (const a of w.app.accounts.accounts) Object.assign(a.cli, { installed: true, path: `/bin/${a.cli.tool}`, version: "1.0.0", supported: true });
        },
      });
      if (process.env.NOTER_CORE === "stdio") { // the real core needs its account CLIs scripted
        await steer.invoke("harness.account_cli", { tool: provider === "Claude" ? "claude_code" : "codex", installed: true, path: "/bin/cli", version: "2.1.296", login_identity: { email: "ann@example.com", plan: provider === "Claude" ? "Max" : "Plus" }, login: { url: "https://example.com/device", code: "ONE-TIME-CODE-9137" } });
      }
      await page.getByRole("navigation", { name: "Settings panes" }).getByRole("listitem").filter({ hasText: "Models & Runtimes" }).click();
      const row = pane(page).locator('[data-component="cpt-noter-component-ui-credential-row"]').filter({ hasText: `Your ${provider} account` });
      await row.getByRole("button", { name: /Sign In/ }).click();
      const dlg = page.getByRole("dialog", { name: new RegExp(`Sign in with your ${provider} account`) });
      if (provider === "Claude") await dlg.getByRole("checkbox").check({ force: true });
      await dlg.getByRole("button", { name: /^(Continue in Browser|Use This Account)$/ }).click();
      await dlg.getByRole("button", { name: /^(Use for \d+ Agents?|Done)$/ }).click();
      await expect(row).toContainText("Signed in");
      await row.getByRole("button", { name: "Sign Out…" }).click();
      await page.getByRole("dialog", { name: /Sign out of your/ }).getByRole("button", { name: "Sign Out", exact: true }).click();
      await expect(row).toContainText("Not signed in");
      await expect(row.getByRole("button", { name: /^Sign In/ })).toBeFocused();
    });
  }
});
