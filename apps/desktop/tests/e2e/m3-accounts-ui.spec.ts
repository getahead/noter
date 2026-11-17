// M3 — own-account sign-in and key removal (docs/features/ui/accounts.md). Stories `cpt-noter-seq-settings-sign-in-account`,
// `cpt-noter-seq-first-run-connect-assistant` (the account and no-assistant paths; the key paths are m2-accounts-key-ui) and the
// Remove… part of `cpt-noter-seq-settings-replace-api-key`. Commands: account_signin_prepare, account_signin_start, account_signin_cancel,
// account_use_existing, account_bind_agents, account_test, account_sign_out, api_key_remove, cli_install. Written before the sheets exist
// (tests first). The scripted account CLIs (`harness.account_cli`) exist only in the real core, so these run there only
// (tests/conformance/m3-stories-credentials.test.ts drives the same steps at the contract). Never assert a code or key by value
// beyond the scripted stand-in below.
import type { Locator, Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { openWindow, type Steer } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import { alerts, alertText, answerAlerts, watchAlerts } from "./support/native-alert";

// scripted account CLIs exist only in the real core: on the fake core these stories are not registered
const describeReal = process.env.NOTER_CORE === "stdio" ? test.describe : (_title: string, _body: () => void): void => {};

const CODE = "ONE-TIME-CODE-9137";
const ANN = { email: "ann@example.com", plan: "Max" };
const BOB = { email: "bob@example.com", plan: "Plus" };

const pane = (page: Page) => page.locator('[data-region="ST-R2"]');
const stepBody = (page: Page) => page.locator('[data-region="FR-R2"]');
const sheet = (page: Page, name: RegExp) => page.getByRole("dialog", { name });
const row = (page: Page, name: string) => page.locator('[data-component="cpt-noter-component-ui-credential-row"]').filter({ hasText: name });
const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name });

const claudeCli = (steer: Steer, fields: Record<string, unknown> = {}) =>
  steer.invoke("harness.account_cli", { tool: "claude_code", installed: true, path: "/bin/claude_code", version: "2.1.296", login_identity: ANN, login: { code: CODE }, ...fields });
const codexCli = (steer: Steer, fields: Record<string, unknown> = {}) =>
  steer.invoke("harness.account_cli", { tool: "codex", installed: true, path: "/bin/codex", version: "0.163.0", login_identity: BOB, login: { url: "https://chatgpt.com/device" }, ...fields });

async function openModels(page: Page) {
  await page.getByRole("navigation", { name: "Settings panes" }).getByRole("listitem").filter({ hasText: "Models & Runtimes" }).click();
  await expect(pane(page).getByRole("heading", { name: "Models & Runtimes", exact: true })).toBeVisible();
}

/** Sign in with Claude through the sheet to the Check step. */
async function claudeToCheck(page: Page) {
  await button(row(page, "Your Claude account"), /Sign In/).click();
  const dlg = sheet(page, /Sign in with your Claude account/);
  await dlg.getByRole("checkbox").check();
  await button(dlg, "Continue in Browser").click();
  return dlg;
}

describeReal("cpt-noter-seq-settings-sign-in-account", () => {
  test("happy path: Sign In with Claude — Prepare, personal-use box, Continue in Browser, Check, Use for N Agents", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await claudeCli(steer);
    await openModels(page);
    await expect(row(page, "Your Claude account")).toContainText("Not signed in");
    await button(row(page, "Your Claude account"), /Sign In/).click();

    const dlg = sheet(page, /Sign in with your Claude account/);
    await expect(dlg).toBeVisible();
    expect(await sent(page, "account_signin_prepare")).toEqual([{ provider: "claude" }]);
    const next = button(dlg, "Continue in Browser");
    await expect(next).toBeDisabled(); // the personal-use confirmation is required for Claude
    await dlg.getByRole("checkbox").check();
    await next.click();
    expect(await sent(page, "account_signin_start")).toEqual([{ provider: "claude", personal_use_confirmed: true }]);

    await expect(dlg).toContainText(CODE); // the returned code only
    await expect(button(dlg, /Copy Code/)).toBeVisible();
    await expect(dlg).toContainText("ann@example.com"); // Check: identity and plan from the core
    await expect(dlg).toContainText("Max");
    await button(dlg, /^Use for \d+ Agents?$/).click();
    expect((await sent(page, "account_bind_agents")).at(-1)).toMatchObject({ provider: "claude" });
    await expect(dlg).toHaveCount(0);
    await expect(row(page, "Your Claude account")).toContainText("Signed in");
    await expect(row(page, "Your Claude account")).toContainText("ann@example.com");
    await expect(row(page, "Your ChatGPT account")).toContainText("Not signed in"); // independent of the other provider
  });

  test("other path: Claude Code already signed in — Use This Account goes straight to Check, no browser", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await claudeCli(steer, { identity: ANN });
    await openModels(page);
    await button(row(page, "Your Claude account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your Claude account/);
    await expect(dlg).toContainText("Use ann@example.com");
    await button(dlg, "Use This Account").click();
    expect(await sent(page, "account_use_existing")).toHaveLength(1);
    expect(await sent(page, "account_signin_start")).toHaveLength(0);
    await expect(dlg).toContainText("ann@example.com");
  });

  test("error path — Codex not installed: Install Codex keeps Continue in Browser disabled until the tool is found", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await codexCli(steer, { installed: false, path: null, version: null });
    await openModels(page);
    await button(row(page, "Your ChatGPT account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your ChatGPT account/);
    await expect(dlg).toContainText(/Codex isn't installed/);
    await expect(button(dlg, "Continue in Browser")).toBeDisabled();
    await button(dlg, /^Install Codex/).click();
    expect(await sent(page, "cli_install")).toHaveLength(1);
  });

  test("other path: Esc hides the waiting sheet, the row keeps Finishing in your browser…, Cancel ends the session", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await codexCli(steer, { login: { url: "https://chatgpt.com/device", hold: true } });
    await openModels(page);
    await button(row(page, "Your ChatGPT account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your ChatGPT account/);
    await button(dlg, "Continue in Browser").click();
    await expect(dlg).toContainText("chatgpt.com/device");
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
    const chatgpt = row(page, "Your ChatGPT account");
    await expect(chatgpt).toContainText("Finishing in your browser…");
    expect(await sent(page, "account_signin_cancel")).toHaveLength(0); // hiding does not cancel
    await button(chatgpt, "Show").click();
    await expect(dlg).toBeVisible();
    await button(dlg, "Cancel").click();
    expect(await sent(page, "account_signin_cancel")).toHaveLength(1);
    await expect(chatgpt).toContainText("Not signed in");
  });

  test("happy path: Test shows the latency, Sign Out names the effect and only confirmation signs out", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await claudeCli(steer);
    await openModels(page);
    const dlg = await claudeToCheck(page);
    await button(dlg, /^Use for \d+ Agents?$/).click();
    const claude = row(page, "Your Claude account");
    await expect(claude).toContainText("Signed in");

    await button(claude, "Test").click();
    await expect(claude).toContainText(/Answered in/);
    expect(await sent(page, "account_test")).toHaveLength(1);

    await button(claude, "Sign Out…").click(); // a sheet in the alert's place: the native alert has no checkbox
    const out = sheet(page, /Sign out of your Claude account in Noter\?/);
    await expect(out).toContainText("Also sign out of Claude Code on this Mac");
    await button(out, "Cancel").click();
    expect(await sent(page, "account_sign_out")).toHaveLength(0);
    await button(claude, "Sign Out…").click();
    await button(out, "Sign Out").click();
    await expect.poll(async () => (await sent(page, "account_sign_out")).length).toBe(1);
    expect((await sent(page, "account_sign_out"))[0]).toEqual({ provider: "claude", also_in_cli: false });
    await expect(claude).toContainText("Not signed in");
  });
});

describeReal("cpt-noter-seq-first-run-connect-assistant", () => {
  const assistantsOpen = (w: Parameters<typeof W.firstRun>[0]) => {
    W.firstRun(w);
    for (const s of w.app.setup.steps) if (s.step !== "assistants") s.state = "done";
  };

  test("other path: sign in with your own account — the account counts as connected at Finish", async ({ page }) => {
    const steer = await openWindow(page, "first-run", { world: assistantsOpen });
    await claudeCli(steer);
    await expect(stepBody(page)).toContainText("Your Claude account");
    await expect(stepBody(page)).toContainText("Your ChatGPT account");
    const dlg = await claudeToCheck(page);
    await button(dlg, /^(Use for \d+ Agents?|Done|Not Now)$/).first().click();
    await expect(row(page, "Your Claude account")).toContainText("Signed in");
    await button(page, "Finish").click();
    expect(await sent(page, "setup_set_step")).toContainEqual({ step: "assistants", state: "done" });
  });

  test("empty path — no key and no local runtime: Not Now explains and Finish still works", async ({ page }) => {
    await openWindow(page, "first-run", { world: assistantsOpen });
    await button(stepBody(page), "Not Now").click();
    await expect(stepBody(page)).toContainText("Without an assistant Noter still records and transcribes; summaries wait until one is connected.");
    await button(page, "Finish").click();
    expect(await sent(page, "setup_set_step")).toContainEqual({ step: "assistants", state: "skipped" });
  });
});

describeReal("cpt-noter-seq-settings-replace-api-key", () => {
  test("other path: Remove… asks first (Cancel default), then api_key_remove empties the row", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await watchAlerts(page);
    await steer.invoke("api_key_set", { provider: "anthropic", key: "test-stand-in-value-0001" }, "settings");
    await page.reload();
    await openModels(page);
    const key = row(page, "Anthropic API key");
    await expect(key).toContainText("Configured");
    await button(key, "Remove…").click();
    expect((await alerts(page)).length).toBe(1);
    expect(await sent(page, "api_key_remove")).toHaveLength(0);
    await answerAlerts(page, "confirm");
    await button(key, "Remove…").click();
    await expect.poll(async () => (await sent(page, "api_key_remove")).length).toBe(1);
    expect((await sent(page, "api_key_remove"))[0]).toEqual({ provider: "anthropic" });
    await expect(key).not.toContainText("Configured");
  });
});
