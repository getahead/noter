// M2 — API keys (docs/features/ui/accounts.md, M2 part per DECOMPOSITION discrepancy 9; DESIGN.md Settings › Models & Runtimes,
// Credential row, Key sheet, First run FR-R2 Assistants). Real-core key paths of cpt-noter-seq-settings-replace-api-key (happy,
// Key rejected, Keychain locked) and cpt-noter-seq-first-run-connect-assistant (happy, API key rejected, No key and no local
// runtime). Written before the screens exist (tests first). Assumptions: the harness verifies nothing (any key is accepted), so a
// rejection is `failNext("api_key_set", "key_rejected")`; the Rejected starting row and the Switched to local footer are not
// seedable, so the row is read as Add…/Replace… and the footer is not asserted; the locked Keychain is `harness.keychain`
// on the real core (a failNext on the fake); the macOS password prompt itself is not drawn. Local Model not ready (Install
// Ollama…) and the account sign-in rows are M3 (`not_implemented`). Copy and labels are DESIGN's, never adjusted to the markup.
import type { Page } from "@playwright/test";

import { openWindow, type Steer } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import { invoke, REAL } from "./support/outputs-world";
import * as W from "../support/world-presets";

const panes = (page: Page) => page.getByRole("navigation", { name: "Settings panes" });
const pane = (page: Page) => page.locator('[data-region="ST-R2"]');
const KEY = "sk-ant-api03-test-key";
const REJECTED = "Anthropic rejected this key (invalid key)";
const keyRow = (page: Page) => pane(page).getByRole("group", { name: "Anthropic API key" });
const sheet = (page: Page) => page.getByRole("dialog", { name: /Anthropic API Key/ });
const field = (page: Page) => sheet(page).getByLabel(/API key/i);

async function openModels(page: Page): Promise<Steer> {
  const steer = await openWindow(page, "settings");
  await panes(page).getByRole("listitem").filter({ hasText: "Models & Runtimes" }).click();
  await expect(pane(page).getByRole("heading", { name: "Models & Runtimes" })).toBeVisible();
  return steer;
}

/** The Keychain refuses every access (real core) or the next key write says so (fake). */
async function lockKeychain(page: Page, steer: Steer, locked: boolean): Promise<void> {
  if (REAL) await invoke(page, "harness.keychain", { locked });
  else if (locked) await steer.failNext("api_key_set", "keychain_locked");
}

test.describe("cpt-noter-seq-settings-replace-api-key", () => {
  test("UI — happy path: Replace… opens the sheet with an empty key field, Verify accepts the key, Save closes it, the row says Configured and Stored in the Keychain", async ({ page }) => {
    await openModels(page);
    await expect(pane(page)).toContainText("Anthropic API key");
    await keyRow(page).getByRole("button", { name: /^(Replace|Add)…$/ }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(field(page)).toHaveValue("");
    await expect(field(page)).toHaveAttribute("type", "password");
    await field(page).fill(KEY); // ⌘V
    await sheet(page).getByRole("button", { name: "Verify" }).click();
    expect(await sent(page, "api_key_set")).toEqual([{ provider: "anthropic", key: KEY }]);
    await expect(sheet(page)).toContainText(/accepted|verified/i);
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect(keyRow(page)).toContainText("Configured");
    await expect(keyRow(page)).toContainText("Stored in the Keychain");
    expect(await sent(page, "accounts_get")).not.toHaveLength(0);
  });

  test("UI — happy path: the key never shows again — the row shows dots, never the key, and a closed sheet forgets the draft", async ({ page }) => {
    await openModels(page);
    await keyRow(page).getByRole("button", { name: /^(Replace|Add)…$/ }).click();
    await field(page).fill(KEY);
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await keyRow(page).getByRole("button", { name: /^(Replace|Add)…$/ }).click();
    await expect(field(page)).toHaveValue("");
    await expect(pane(page)).not.toContainText(KEY);
  });

  test("UI — error path: Key rejected — Anthropic rejected this key (invalid key) under the field with focus back in it, the right key verifies, Save, Configured", async ({ page }) => {
    const steer = await openModels(page);
    await keyRow(page).getByRole("button", { name: /^(Replace|Add)…$/ }).click();
    await field(page).fill("sk-ant-wrong");
    await steer.failNext("api_key_set", "key_rejected");
    await sheet(page).getByRole("button", { name: "Verify" }).click();
    await expect(sheet(page)).toContainText(REJECTED);
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute("aria-invalid", "true");
    expect(await sent(page, "api_key_set")).toHaveLength(1); // no retry of its own

    await field(page).fill(KEY);
    await sheet(page).getByRole("button", { name: "Verify" }).click();
    await expect.poll(async () => (await sent(page, "api_key_set")).length).toBe(2);
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await expect(keyRow(page)).toContainText("Configured");
  });

  test("UI — error path: Keychain locked — Keychain is locked at the top of the pane, Verify asks for the password, once unlocked the row says Configured and the banner is gone", async ({ page }) => {
    const steer = await openModels(page);
    await lockKeychain(page, steer, true);
    await page.reload();
    await panes(page).getByRole("listitem").filter({ hasText: "Models & Runtimes" }).click();
    await keyRow(page).getByRole("button", { name: /^(Replace|Add)…$/ }).click();
    await field(page).fill(KEY);
    await sheet(page).getByRole("button", { name: "Verify" }).click();
    await expect(pane(page)).toContainText("Keychain is locked");
    expect(await sent(page, "api_key_set")).toHaveLength(1);

    await lockKeychain(page, steer, false); // the user typed the macOS password
    await sheet(page).getByRole("button", { name: /Verify|Try Again/ }).click();
    await sheet(page).getByRole("button", { name: "Save" }).click();
    await expect(keyRow(page)).toContainText("Configured");
    await expect(pane(page)).not.toContainText("Keychain is locked");
  });

  test("UI — other path: Runtime per task — the pop-ups write the runtime of each task through settings_update", async ({ page }) => {
    await openModels(page);
    const task = pane(page).getByRole("combobox", { name: /Post-call outputs/ });
    await expect(task).toBeVisible();
    await task.selectOption({ index: 1 });
    expect((await sent(page, "settings_update")).length).toBeGreaterThan(0);
  });
});

test.describe("cpt-noter-seq-first-run-connect-assistant", () => {
  const stepBody = (page: Page) => page.locator('[data-region="FR-R2"]');
  const assistants = async (page: Page) => {
    const steer = await openWindow(page, "first-run", {
      world: (w) => {
        W.firstRun(w);
        W.permission(w, "microphone", "granted");
        W.permission(w, "system_audio", "granted");
        w.app.setup.self_test = { type: "passed", at: Date.now() };
        w.app.setup.detection_enabled = true;
        w.app.setup.steps.find((s) => s.step === "permissions")!.state = "done";
      },
    });
    for (let n = 0; n < 2; n++) await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("list", { name: "Setup steps" }).getByRole("listitem").filter({ hasText: "Assistants" })).toHaveAttribute("aria-current", "step");
    return steer;
  };
  const keyField = (page: Page) => stepBody(page).getByLabel("Anthropic API key");

  test("UI — happy path: Assistants shows both key fields and Privacy mode, Verify stores the key, Stored in the Keychain, Finish leads to Today", async ({ page }) => {
    await assistants(page);
    for (const label of ["Anthropic API key", "Codex API key", "Your Claude account", "Your ChatGPT account", "Local runtime", "Privacy mode"]) await expect(stepBody(page)).toContainText(label);
    await keyField(page).fill(KEY);
    await stepBody(page).getByRole("button", { name: "Verify" }).first().click();
    expect(await sent(page, "api_key_set")).toEqual([{ provider: "anthropic", key: KEY }]);
    await expect(stepBody(page)).toContainText("Stored in the Keychain");
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    expect(await sent(page, "setup_set_step")).toContainEqual({ step: "assistants", state: "done" });
  });

  test("UI — error path: API key rejected — the field is marked invalid with Anthropic rejected this key (invalid key) in one line, the corrected key stores and Finish stays available", async ({ page }) => {
    const steer = await assistants(page);
    await keyField(page).fill("sk-ant-wrong");
    await steer.failNext("api_key_set", "key_rejected");
    await stepBody(page).getByRole("button", { name: "Verify" }).first().click();
    await expect(keyField(page)).toHaveAttribute("aria-invalid", "true");
    await expect(stepBody(page)).toContainText(REJECTED);
    await keyField(page).fill(KEY);
    await stepBody(page).getByRole("button", { name: "Verify" }).first().click();
    await expect(stepBody(page)).toContainText("Stored in the Keychain");
    await expect(page.getByRole("button", { name: "Finish", exact: true })).toBeEnabled();
  });

  test("UI — empty path: No key and no local runtime — Not Now shows Without an assistant Noter still records and transcribes, Finish leaves recording ready", async ({ page }) => {
    await assistants(page);
    await stepBody(page).getByRole("button", { name: "Not Now" }).click();
    await expect(stepBody(page)).toContainText("Without an assistant Noter still records and transcribes; summaries wait until one is connected.");
    expect(await sent(page, "api_key_set")).toEqual([]);
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    expect(await sent(page, "setup_set_step")).toContainEqual({ step: "assistants", state: "done" });
  });
});
