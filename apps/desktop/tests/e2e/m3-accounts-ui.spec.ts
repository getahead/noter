// M3 — own-account sign-in and key removal (docs/features/ui/accounts.md). Stories `cpt-noter-seq-settings-sign-in-account`,
// `cpt-noter-seq-first-run-connect-assistant` (the account and no-assistant paths; the key paths are m2-accounts-key-ui) and the
// Remove… part of `cpt-noter-seq-settings-replace-api-key`. Commands: account_signin_prepare, account_signin_start, account_signin_cancel, account_signin_code,
// account_use_existing, account_bind_agents, account_test, account_sign_out, api_key_remove, cli_install. Written before the sheets exist
// (tests first). The scripted account CLIs (`harness.account_cli`) exist only in the real core, so these run there only
// (tests/conformance/m3-stories-credentials.test.ts drives the same steps at the contract). Never assert a code or key by value
// beyond the scripted stand-in below.
import type { Locator, Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { openWindow, type Steer } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import { alerts, answerAlerts, watchAlerts } from "./support/native-alert";

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
  steer.invoke("harness.account_cli", { tool: "claude_code", installed: true, path: "/bin/claude_code", version: "2.1.296", login_identity: ANN, login: { code: CODE, hold: true }, ...fields });
const codexCli = (steer: Steer, fields: Record<string, unknown> = {}) =>
  steer.invoke("harness.account_cli", { tool: "codex", installed: true, path: "/bin/codex", version: "0.163.0", login_identity: BOB, login: { url: "https://chatgpt.com/device" }, ...fields });

async function openModels(page: Page) {
  await page.getByRole("navigation", { name: "Settings panes" }).getByRole("option").filter({ hasText: "Models & Runtimes" }).click();
  await expect(pane(page).getByRole("heading", { name: "Models & Runtimes", exact: true })).toBeVisible();
}

/** Sign in with Claude through the sheet to the Check step. */
async function claudeToCheck(page: Page, steer: Steer) {
  await button(row(page, "Your Claude account"), /Sign In/).click();
  const dlg = sheet(page, /Sign in with your Claude account/);
  await dlg.getByRole("checkbox").click({ force: true });
  await button(dlg, "Continue in Browser").click();
  await steer.invoke("harness.account_cli_release", { provider: "claude" });
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
    await dlg.getByRole("checkbox").click({ force: true });
    await next.click();
    expect(await sent(page, "account_signin_start")).toEqual([{ provider: "claude", personal_use_confirmed: true }]);

    await expect(dlg).toContainText(CODE); // the returned code only
    await expect(button(dlg, /Copy Code/)).toBeVisible();
    await steer.invoke("harness.account_cli_release", { provider: "claude" });
    await expect(dlg).toContainText("ann@example.com"); // Check: identity and plan from the core
    await expect(dlg).toContainText("Max");
    await button(dlg, /^(Use for \d+ Agents?|Done)$/).click();
    expect((await sent(page, "account_bind_agents")).at(-1)).toMatchObject({ provider: "claude" });
    await expect(dlg).toHaveCount(0);
    await expect(row(page, "Your Claude account")).toContainText("Signed in");
    await expect(row(page, "Your Claude account")).toContainText("ann@example.com");
    await expect(row(page, "Your ChatGPT account")).toContainText("Not signed in"); // independent of the other provider
  });

  test("other path: the page shows a code — pasted into Send Code, the login finishes and Check follows (#1136)", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await claudeCli(steer, { login: { hold: true } });
    await openModels(page);
    await button(row(page, "Your Claude account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your Claude account/);
    await dlg.getByRole("checkbox").click({ force: true });
    await button(dlg, "Continue in Browser").click();
    await expect(dlg).toContainText("If the page shows a code, paste it here");
    await dlg.getByRole("textbox", { name: "Code from the page" }).fill("PASTED-CODE-1");
    await button(dlg, "Send Code").click();
    const [pasted] = await sent(page, "account_signin_code");
    expect(pasted).toMatchObject({ code: "PASTED-CODE-1" });
    await expect(dlg).toContainText("ann@example.com"); // the held login finished on the code
  });

  test("other path: Claude Code already signed in — Use This Account goes straight to Check, no browser", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await claudeCli(steer, { identity: ANN });
    await openModels(page);
    await button(row(page, "Your Claude account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your Claude account/);
    await expect(dlg).toContainText("Use ann@example.com");
    await dlg.getByRole("checkbox").click({ force: true }); // the personal-use guard covers the existing account too
    await button(dlg, "Use This Account").click();
    // #1000: the ticked box goes with the request, and the core's answer moves the sheet on to Use
    expect(await sent(page, "account_use_existing")).toEqual([{ provider: "claude", personal_use_confirmed: true }]);
    expect(await sent(page, "account_signin_start")).toHaveLength(0);
    await expect(dlg).toContainText("Connected to your Claude account");
    await expect(dlg).toContainText("ann@example.com");
  });

  test("error path — Codex not installed: Install Codex keeps Continue in Browser disabled until the tool is found", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await codexCli(steer, { installed: false, path: null, version: null });
    await openModels(page);
    await button(row(page, "Your ChatGPT account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your ChatGPT account/);
    await expect(dlg).toContainText(/Codex isn[’']t installed/);
    await expect(button(dlg, "Continue in Browser")).toBeDisabled();
    await button(dlg, /^Install Codex/).click();
    expect(await sent(page, "cli_install")).toHaveLength(1);
  });

  test("error path — a failed install shows the install error and offers Install again", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await steer.invoke("harness.account_cli", { tool: "codex", installed: false, install: { fail: "offline" } });
    await openModels(page);
    await button(row(page, "Your ChatGPT account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your ChatGPT account/);
    await button(dlg, /^Install Codex/).click();
    await expect(dlg).toContainText(/didn[’']t finish/);
    await expect(button(dlg, /^Install Codex/)).toBeVisible();
    await expect(button(dlg, "Continue in Browser")).toBeDisabled();
  });

  test("error path — an unsupported Codex shows the unsupported copy, not a generic error", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await steer.invoke("harness.account_cli", { tool: "codex", installed: true, supported: false });
    await openModels(page);
    await button(row(page, "Your ChatGPT account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your ChatGPT account/);
    await expect(dlg).toContainText(/This version of Codex isn[’']t supported/);
    await expect(dlg).not.toContainText("Something went wrong");
    await expect(button(dlg, "Continue in Browser")).toBeDisabled();
  });

  // ET 22 Nov: the owner's Codex 0.171.0 was refused with copy that named no version and said "Update"
  test("error path — an unsupported Codex names its version and offers the API key, not an update", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await codexCli(steer, { version: "0.171.0", supported: false });
    await openModels(page);
    await button(row(page, "Your ChatGPT account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your ChatGPT account/);
    await expect(dlg).toContainText(/Codex 0\.171\.0 isn[’']t supported yet/);
    await expect(dlg).toContainText("versions it was tested with");
    await expect(dlg).not.toContainText("Update Codex");
    await expect(button(dlg, "Continue in Browser")).toBeDisabled();
  });

  // ET 22 Nov: a refused plan says whose plan and which; since #1218 the accepted plans are Pro, Max or Team
  test("error path — Use This Account on a Free plan names the account, its plan and the accepted plans, with the API key instead", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await claudeCli(steer, { identity: { email: "ann@example.com", plan: "free" } });
    await openModels(page);
    await button(row(page, "Your Claude account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your Claude account/);
    await dlg.getByRole("checkbox", { name: "Personal use" }).click({ force: true });
    await button(dlg, "Use This Account").click();
    await expect(dlg.getByRole("alert")).toContainText("ann@example.com has no Claude Pro, Max or Team plan");
    await expect(dlg.getByRole("alert")).toContainText("free");
    await expect(button(dlg, "Use an API Key Instead")).toBeVisible();
    await expect(row(page, "Your Claude account")).toContainText("Not signed in");
  });

  // Owner decision, 23 Nov (#1218): a Claude Team plan is accepted; the Personal use box is the required confirmation
  test("other path: Use This Account on a Team plan connects once Personal use is ticked", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await claudeCli(steer, { identity: { email: "ann@example.com", plan: "team" } });
    await openModels(page);
    await expect(row(page, "Your Claude account")).toContainText("Use your Claude Pro, Max or Team plan through Claude Code. Personal use only.");
    await button(row(page, "Your Claude account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your Claude account/);
    await expect(dlg).toContainText("Pro, Max or Team plan");
    const personal = dlg.getByRole("checkbox", { name: "Personal use" });
    await expect(personal).not.toBeChecked();
    await expect(button(dlg, "Use This Account")).toBeDisabled(); // the box is required
    await personal.click({ force: true });
    await button(dlg, "Use This Account").click();
    expect(await sent(page, "account_use_existing")).toEqual([{ provider: "claude", personal_use_confirmed: true }]);
    await expect(dlg).toContainText("Connected to your Claude account");
    await expect(dlg).toContainText("ann@example.com");
  });

  test("other path: Esc hides the waiting sheet, the row keeps Finishing in your browser…, Cancel ends the session", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await codexCli(steer, { login: { url: "https://chatgpt.com/device", hold: true } });
    await openModels(page);
    await button(row(page, "Your ChatGPT account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your ChatGPT account/);
    await button(dlg, "Continue in Browser").click();
    await expect(dlg).toContainText("Waiting for your browser…");
    await expect(dlg.getByText("Open the Page Again")).toBeVisible();
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
    const dlg = await claudeToCheck(page, steer);
    await button(dlg, /^(Use for \d+ Agents?|Done)$/).click();
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

  // issue 1220: a sheet never exceeds its window; the body scrolls, the title and buttons stay in view
  test("other path: a sheet that fits its window draws no scroll hairline", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await claudeCli(steer, { identity: ANN });
    await openModels(page);
    await button(row(page, "Your Claude account"), /Sign In/).click();
    const body = sheet(page, /Sign in with your Claude account/).locator(".np-sheet__body");
    await expect(body).toBeVisible();
    await expect(body).not.toHaveClass(/\bis-overflow\b/);
    await expect(body).toHaveCSS("border-bottom-width", "0px");
  });

  // DESIGN 3522: the Settings window opens at 820×620 and can shrink to 700×480
  for (const [width, height] of [[820, 620], [700, 480]] as const)
  test(`other path: at ${width}×${height} the Claude sheet's title and buttons are fully visible and clickable`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await claudeCli(steer, { identity: ANN }); // an existing account makes the Prepare step its tallest
    await openModels(page);
    await button(row(page, "Your Claude account"), /Sign In/).click();
    const dlg = sheet(page, /Sign in with your Claude account/);
    await expect(dlg).toBeVisible();
    for (const name of ["Cancel", "Use This Account"]) await expect(button(dlg, name)).toBeInViewport({ ratio: 1 });
    await expect(dlg.getByText(/Sign in with your Claude account/).first()).toBeInViewport({ ratio: 1 });
    const box = await dlg.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    // a capped body shows that it scrolls: a 1 px hairline above the buttons (designer, PR 1224)
    const body = dlg.locator(".np-sheet__body");
    await expect(body).toHaveClass(/\bis-overflow\b/);
    await expect(body).toHaveCSS("border-bottom-width", "1px");
    await expect(body).not.toHaveClass(/\bis-scrolled\b/);
    await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(body).toHaveClass(/\bis-scrolled\b/); // and under the title once scrolled
    await expect(dlg).toContainText("Each Claude plan seat is for one person. Heavy automated use may be throttled. To share Noter across a team, use an API key.");
    await dlg.getByRole("checkbox").click({ force: true });
    await button(dlg, "Use This Account").click(); // reachable without scrolling the window
    await expect(dlg).toContainText("Connected to your Claude account");
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
    const dlg = await claudeToCheck(page, steer);
    await button(dlg, /^(Use for \d+ Agents?|Done|Not Now)$/).first().click();
    await expect(row(page, "Your Claude account")).toContainText("Signed in");
    await button(page, "Finish").click();
    expect(await sent(page, "setup_set_step")).toContainEqual({ step: "assistants", state: "done" });
  });

  // ET 22 Nov: the same refusals in the wizard's Assistants step, both providers
  test("error path: Assistants — a Free plan and an unsupported Codex each say why on the sheet", async ({ page }) => {
    const steer = await openWindow(page, "first-run", { world: assistantsOpen });
    await claudeCli(steer, { identity: { email: "ann@example.com", plan: "free" } });
    await codexCli(steer, { version: "0.171.0", supported: false });
    await button(row(page, "Your Claude account"), /Sign In/).click();
    const claude = sheet(page, /Sign in with your Claude account/);
    await claude.getByRole("checkbox", { name: "Personal use" }).click({ force: true });
    await button(claude, "Use This Account").click();
    await expect(claude.getByRole("alert")).toContainText("ann@example.com has no Claude Pro, Max or Team plan");
    await button(claude, "Cancel").click();
    await button(row(page, "Your ChatGPT account"), /Sign In/).click();
    await expect(sheet(page, /Sign in with your ChatGPT account/)).toContainText(/Codex 0\.171\.0 isn[’']t supported yet/);
  });

  // #1218: the wizard's Assistants step accepts a Team plan behind the same Personal use box
  test("other path: Assistants — a Claude Team plan connects once Personal use is ticked", async ({ page }) => {
    const steer = await openWindow(page, "first-run", { world: assistantsOpen });
    await claudeCli(steer, { identity: { email: "ann@example.com", plan: "team" } });
    await button(row(page, "Your Claude account"), /Sign In/).click();
    const claude = sheet(page, /Sign in with your Claude account/);
    await expect(button(claude, "Use This Account")).toBeDisabled();
    await claude.getByRole("checkbox", { name: "Personal use" }).click({ force: true });
    await button(claude, "Use This Account").click();
    await expect(claude).toContainText("Connected to your Claude account");
  });

  test("other path: Install Ollama… installs the local runtime through cli_install and the offer goes away", async ({ page }) => {
    const steer = await openWindow(page, "first-run", { world: assistantsOpen });
    await steer.invoke("harness.account_cli", { tool: "ollama", installed: false, install: { delay_ms: 300, version: "0.9.0" } }); // hides the local runtime until installed
    await page.reload();
    const install = button(stepBody(page), "Install Ollama…");
    await expect(install).toBeVisible();
    await install.click();
    await expect.poll(async () => (await sent(page, "cli_install")).length).toBe(1);
    expect((await sent(page, "cli_install"))[0]).toEqual({ tool: "ollama" });
    await expect(install).toHaveCount(0); // the core's accounts view now has the runtime
    const { calls } = (await steer.invoke("harness.account_cli_log", {})) as { calls: string[] };
    expect(calls).toContain("install:Ollama");
  });
});

describeReal("cpt-noter-seq-settings-replace-api-key", () => {
  test("other path: Remove… asks first (Cancel default), then api_key_remove empties the row", async ({ page }) => {
    await watchAlerts(page); // before the window opens: the init script runs on navigation
    const steer = await openWindow(page, "settings", { world: (w) => W.idle(w) });
    await steer.invoke("api_key_set", { provider: "anthropic", key: "test-stand-in-value-0001" }, "settings");
    await openModels(page);
    const key = row(page, "Anthropic API key");
    await expect(key).toContainText("Configured");
    await button(key, "Remove…").click();
    await expect.poll(async () => (await alerts(page)).length).toBe(1);
    expect(await sent(page, "api_key_remove")).toHaveLength(0);
    await answerAlerts(page, "confirm");
    await button(key, "Remove…").click();
    await expect.poll(async () => (await sent(page, "api_key_remove")).length).toBe(1);
    expect((await sent(page, "api_key_remove"))[0]).toEqual({ provider: "anthropic" });
    await expect(key).not.toContainText("Configured");
  });
});
