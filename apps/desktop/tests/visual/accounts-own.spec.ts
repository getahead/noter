// The own-account rows and sheets (cpt-noter-component-ui-credential-row account-login, cpt-noter-component-screen-dialogs
// sign-in) over the fake core: signed in, signed out by the provider, the sign-in sheet at Prepare for each provider
// and with the CLI missing, the later steps (Sign in, Check, Use), a failed sign-in and the row while it waits, and the
// sign-out sheet. The fake core's own steps move with its clock, so the later steps park the session it started and
// emit the progress the render needs.
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { openWindow } from "../e2e/support/app";
import { freeze, settled } from "./freeze";

test.beforeEach(({ page }) => freeze(page));
test.use({ viewport: { width: 760, height: 640 } });

const accountOf = (w: World, provider: "claude" | "chatgpt") => w.app.accounts.accounts.find((a) => a.provider === provider)!;
const signedIn = (w: World) => {
  W.idle(w);
  accountOf(w, "claude").status = { type: "signed_in", identity: { email: "mikhail@example.com", plan: "Max" }, since: 1 };
  accountOf(w, "claude").agents = [{ id: "agt_pm", name: "Product manager", badge: "agent" }];
};
const row = (page: Page, name: string) => page.locator('[data-component="cpt-noter-component-ui-credential-row"]').filter({ hasText: name });
type Fake = { world: World; setWorld(f: (w: World) => void): void; emit(e: string, p: unknown): void };
/** Sign in with ChatGPT up to the waiting step, then park the fake's own step timers (they answer only to the session
 *  the account names) and return the session id, so the render decides what the core "says" next. */
async function waiting(page: Page): Promise<string> {
  await row(page, "Your ChatGPT account").getByRole("button", { name: /Sign In/ }).click();
  const dlg = page.getByRole("dialog", { name: /Sign in with your ChatGPT account/ });
  await dlg.getByRole("button", { name: "Continue in Browser" }).click();
  await expect(dlg).toContainText("ABCD-EFGH");
  return page.evaluate(() => {
    const f = (globalThis as unknown as { __noterFake: Fake }).__noterFake;
    let id = "";
    f.setWorld((w) => {
      const a = w.app.accounts.accounts.find((x) => x.provider === "chatgpt")!;
      if (a.status.type === "signing_in") id = a.status.session_id;
      a.status = { type: "signing_in", session_id: "sis_parked" };
    });
    return id;
  });
}
const progress = (page: Page, id: string, step: string, error: string | null = null) =>
  page.evaluate(([i, st, er]) => (globalThis as unknown as { __noterFake: Fake }).__noterFake.emit("signin:progress", { session_id: i, provider: "chatgpt", step: st, identity: st === "waiting_for_browser" ? null : { email: "you@example.com", plan: "Plus" }, error: er }), [id, step, error] as const);
const chatgptDialog = (page: Page) => page.getByRole("dialog", { name: /Sign in with your ChatGPT account/ });
const codexReady = (w: World) => (W.idle(w), Object.assign(accountOf(w, "chatgpt").cli, { installed: true, path: "/opt/homebrew/bin/codex", version: "0.163.0", supported: true }));
const states: { id: string; world: (w: World) => void; ready: (page: Page) => Promise<void>; target: (page: Page) => ReturnType<Page["locator"]> }[] = [
  {
    id: "signed-in",
    world: signedIn,
    ready: async (page) => void (await expect(row(page, "Your Claude account")).toContainText("Signed in")),
    target: (page) => row(page, "Your Claude account"),
  },
  {
    id: "expired",
    world: (w) => (W.idle(w), (accountOf(w, "chatgpt").status = { type: "signed_out_by_provider", at: 1 })),
    ready: async (page) => void (await expect(row(page, "Your ChatGPT account")).toContainText("Signed out by ChatGPT")),
    target: (page) => row(page, "Your ChatGPT account"),
  },
  {
    id: "prepare-claude",
    world: (w) => W.idle(w),
    ready: async (page) => {
      await row(page, "Your Claude account").getByRole("button", { name: /Sign In/ }).click();
      await expect(page.getByRole("dialog", { name: /Sign in with your Claude account/ })).toContainText(/Use This Account|Continue in Browser/);
    },
    target: (page) => page.getByRole("dialog"),
  },
  {
    id: "prepare-chatgpt-cli-missing",
    world: (w) => (W.idle(w), Object.assign(accountOf(w, "chatgpt").cli, { installed: false, path: null, version: null })),
    ready: async (page) => {
      await row(page, "Your ChatGPT account").getByRole("button", { name: /Sign In/ }).click();
      await expect(page.getByRole("dialog", { name: /Sign in with your ChatGPT account/ })).toContainText("isn’t installed");
    },
    target: (page) => page.getByRole("dialog"),
  },
  {
    id: "signin-waiting",
    world: codexReady,
    ready: async (page) => void (await waiting(page)),
    target: chatgptDialog,
  },
  {
    id: "signin-check",
    world: codexReady,
    ready: async (page) => {
      await progress(page, await waiting(page), "checking_plan");
      await expect(chatgptDialog(page)).toContainText(/Checking|test request|plan/i);
    },
    target: chatgptDialog,
  },
  {
    id: "signin-use",
    world: codexReady,
    ready: async (page) => {
      const id = await waiting(page);
      await page.evaluate(() => (globalThis as unknown as { __noterFake: Fake }).__noterFake.setWorld((w) => (w.app.accounts.accounts.find((x) => x.provider === "chatgpt")!.status = { type: "signed_in", identity: { email: "you@example.com", plan: "Plus" }, since: 1 })));
      await progress(page, id, "done");
      await expect(chatgptDialog(page)).toContainText(/Connected to your ChatGPT account/);
    },
    target: chatgptDialog,
  },
  {
    id: "signin-timed-out",
    world: codexReady,
    ready: async (page) => {
      await progress(page, await waiting(page), "waiting_for_browser", "sign_in_timed_out");
      await expect(chatgptDialog(page)).toContainText("The sign-in timed out");
    },
    target: chatgptDialog,
  },
  {
    id: "signin-finishing-row",
    world: codexReady,
    ready: async (page) => {
      await waiting(page);
      await page.keyboard.press("Escape");
      await expect(row(page, "Your ChatGPT account")).toContainText("Finishing in your browser");
    },
    target: (page) => row(page, "Your ChatGPT account"),
  },
  {
    id: "sign-out",
    world: signedIn,
    ready: async (page) => {
      await row(page, "Your Claude account").getByRole("button", { name: "Sign Out…" }).click();
      await expect(page.getByRole("dialog", { name: /Sign out of your Claude account/ })).toBeVisible();
    },
    target: (page) => page.getByRole("dialog"),
  },
];

for (const s of states) {
  test(`renders ${s.id}`, async ({ page }) => {
    await openWindow(page, "settings", { world: s.world });
    await page.getByRole("navigation", { name: "Settings panes" }).getByRole("listitem").filter({ hasText: "Models & Runtimes" }).click();
    await s.ready(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // the pointer stays where the last click was (Continue in Browser sits over the row's Cancel): park it, or a hover pill flips the shot (#962)
    await page.mouse.move(0, 0);
    await settled(page);
    await expect(s.target(page)).toHaveScreenshot(`accounts-own-${s.id}-light.png`);
  });
}
