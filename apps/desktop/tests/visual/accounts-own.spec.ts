// The own-account rows and sheets (cpt-noter-component-ui-credential-row account-login, cpt-noter-component-screen-dialogs
// sign-in) over the fake core: signed in, signed out by the provider, the sign-out sheet.
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
    await settled(page);
    await expect(s.target(page)).toHaveScreenshot(`accounts-own-${s.id}-light.png`);
  });
}
