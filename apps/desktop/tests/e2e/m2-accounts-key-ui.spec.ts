// M2 — the API-key part of accounts (docs/features/ui/accounts.md › Milestone notes; DECOMPOSITION discrepancy 9):
// the key rows and sheet of Settings › Models & Runtimes and the field form of first-run step 6. The stories
// themselves stay M3 in harness/milestones.toml; these tests name them so the M3 bar counts them later. The
// own-account rows, Remove… and Install Ollama… are M3 (fake-only) and are not driven here.
// Both cores: `api_key_set` verifies and stores in one step (D-3); a refusal is steered with `failNext`.
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const panes = (page: Page) => page.getByRole("navigation", { name: "Settings panes" });
const pane = (page: Page) => page.locator('[data-region="ST-R2"]');
const keyRow = (page: Page, name: string) => pane(page).locator('[data-component="cpt-noter-component-ui-credential-row"]').filter({ hasText: name });
const sheet = (page: Page) => page.getByRole("dialog", { name: /Anthropic API Key/i });
const sent = async (page: Page, name: string): Promise<unknown[]> => (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args);
// a stand-in the fake accepts (8+ characters, not containing "bad"); never a key shape, never asserted by value
const GOOD = "test-stand-in-value-0001";
/** The window sent `api_key_set` for the provider with a non-empty key, without the value reaching an assertion. */
const keySets = async (page: Page) => (await sent(page, "api_key_set")).map((a) => ({ provider: (a as { provider: string }).provider, hasKey: typeof (a as { key?: unknown }).key === "string" && (a as { key: string }).key.length > 0 }));

async function openModels(page: Page) {
  await panes(page).getByRole("listitem").filter({ hasText: "Models & Runtimes" }).click();
  await expect(pane(page).getByRole("heading", { name: "Models & Runtimes", exact: true })).toBeVisible();
}
/** **Add…** on the fixture of one core, **Replace…** on the other: the sheet is the same. */
const openSheet = async (page: Page) => {
  await keyRow(page, "Anthropic API key").getByRole("button", { name: /^(Add|Replace)…$/ }).click();
  await expect(sheet(page)).toBeVisible();
};

test.describe("cpt-noter-seq-settings-replace-api-key", () => {
  test("happy path: Replace… → paste → Verify → Save gives Configured and the Keychain line", async ({ page }) => {
    await openWindow(page, "settings");
    await openModels(page);
    await openSheet(page);
    await sheet(page).getByLabel("API key").fill(GOOD);
    await sheet(page).getByRole("button", { name: "Verify" }).click();
    await expect(sheet(page)).toContainText("Verified · Claude Code can use this key");
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await expect(sheet(page)).toHaveCount(0);
    const row = keyRow(page, "Anthropic API key");
    await expect(row).toContainText("Configured");
    await expect(row).toContainText("Stored in the Keychain");
    await expect(row).toContainText("Saved");
    expect(await keySets(page)).toEqual([{ provider: "anthropic", hasKey: true }]);
  });

  test("happy path: the key never shows again — the row shows dots, never the key, and a closed sheet forgets the draft", async ({ page }) => {
    await openWindow(page, "settings");
    await openModels(page);
    await openSheet(page);
    await sheet(page).getByLabel("API key").fill(GOOD);
    await sheet(page).getByRole("button", { name: "Cancel" }).click();
    await expect(sheet(page)).toHaveCount(0);
    expect(await sent(page, "api_key_set")).toHaveLength(0);
    await openSheet(page);
    await expect(sheet(page).getByLabel("API key")).toHaveValue("");
    await sheet(page).getByLabel("API key").fill(GOOD);
    await sheet(page).getByRole("button", { name: "Verify" }).click();
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await expect(keyRow(page, "Anthropic API key")).toContainText("••••••••");
    expect(await pane(page).textContent()).not.toContain(GOOD);
  });

  test("error path — Key rejected: the reason shows under the field, Save stays off, and a corrected key verifies", async ({ page }) => {
    const steer = await openWindow(page, "settings");
    await openModels(page);
    await openSheet(page);
    await steer.failNext("api_key_set", "key_rejected");
    const field = sheet(page).getByLabel("API key");
    await field.fill("sk-ant-bad");
    await sheet(page).getByRole("button", { name: "Verify" }).click();
    await expect(sheet(page)).toContainText("rejected this key");
    await expect(sheet(page).getByRole("button", { name: "Save" })).toBeDisabled();
    await field.fill(GOOD);
    await sheet(page).getByRole("button", { name: "Verify" }).click();
    await expect(sheet(page)).toContainText("Verified");
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await expect(keyRow(page, "Anthropic API key")).toContainText("Configured");
    expect(await sent(page, "api_key_set")).toHaveLength(2);
  });

  test("error path — Keychain locked: the sheet says so, the pane shows the banner, Try Again reads the accounts again", async ({ page }) => {
    const steer = await openWindow(page, "settings");
    await openModels(page);
    await openSheet(page);
    await steer.failNext("api_key_set", "keychain_locked");
    await sheet(page).getByLabel("API key").fill(GOOD);
    await sheet(page).getByRole("button", { name: "Verify" }).click();
    await expect(sheet(page)).toContainText("Unlock the Keychain");
    await sheet(page).getByRole("button", { name: "Cancel" }).click();
    await expect(pane(page)).toContainText("Keychain is locked");
    const reads = (await sent(page, "accounts_get")).length;
    await pane(page).getByRole("button", { name: "Try Again" }).click();
    await expect(pane(page)).not.toContainText("Keychain is locked");
    expect((await sent(page, "accounts_get")).length).toBeGreaterThan(reads);
  });

  test("Runtime per task saves the runtimes section; a runtime that is not connected stays listed, disabled", async ({ page }) => {
    await openWindow(page, "settings");
    await openModels(page);
    const popup = pane(page).getByRole("combobox", { name: "Post-call analysis" });
    await expect(popup.locator("option", { hasText: "not connected" }).first()).toBeDisabled();
    await popup.selectOption("local");
    await expect.poll(async () => (await sent(page, "settings_update")).length).toBe(1);
    expect((await sent(page, "settings_update"))[0]).toMatchObject({ section: { section: "runtimes", value: { post_call: "local" } } });
  });
});

test.describe("cpt-noter-seq-first-run-connect-assistant", () => {
  const atAssistants = (w: Parameters<typeof W.firstRun>[0]) => {
    W.firstRun(w);
    w.app.setup.steps.forEach((s) => (s.state = s.step === "assistants" ? "todo" : "done"));
    w.app.accounts.keys.forEach((k) => (k.status = { type: "not_set" }));
  };
  const step = (page: Page) => page.locator('[data-region="FR-R2"]');
  const keyField = (page: Page) => step(page).getByLabel("Anthropic API key", { exact: true });

  test("happy path: Verify stores the key, the field shows the Keychain line, Finish opens Today", async ({ page }) => {
    await openWindow(page, "first-run", { world: atAssistants });
    await expect(step(page).getByRole("heading", { name: "Assistants" })).toBeVisible();
    await keyField(page).fill(GOOD);
    await step(page).getByRole("button", { name: "Verify" }).first().click();
    await expect(step(page).locator('[data-component="cpt-noter-component-ui-credential-row"]').filter({ hasText: "Anthropic API key" })).toContainText("Stored in the Keychain");
    await expect(step(page)).not.toContainText("Without an assistant");
    expect(await keySets(page)).toEqual([{ provider: "anthropic", hasKey: true }]);
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await expect.poll(async () => (await sent(page, "setup_set_step")).some((a) => (a as { step: string }).step === "assistants")).toBe(true);
  });

  test("empty path — No key and no local runtime: Not Now folds the offer, the explanation stays, Finish still leads on", async ({ page }) => {
    await openWindow(page, "first-run", { world: (w) => (atAssistants(w), (w.app.accounts.local.running = false), (w.app.accounts.local.cli.installed = false)) });
    await expect(step(page)).toContainText("none found");
    await step(page).getByRole("button", { name: "Not Now" }).click();
    await expect(step(page).getByRole("button", { name: "Install Ollama…" })).toHaveCount(0);
    await expect(step(page)).toContainText("Without an assistant Noter still records and transcribes");
    await expect(page.getByRole("button", { name: "Finish", exact: true })).toBeEnabled();
  });

  test("error path — API key rejected: the field is invalid with the reason in one line; the corrected key verifies", async ({ page }) => {
    const steer = await openWindow(page, "first-run", { world: atAssistants });
    await steer.failNext("api_key_set", "key_rejected");
    await keyField(page).fill("sk-ant-bad");
    await step(page).getByRole("button", { name: "Verify" }).first().click();
    await expect(step(page)).toContainText("rejected this key");
    await expect(keyField(page)).toHaveAttribute("aria-invalid", "true");
    await keyField(page).fill(GOOD);
    await step(page).getByRole("button", { name: "Verify" }).first().click();
    await expect(step(page)).toContainText("Stored in the Keychain");
  });
});
