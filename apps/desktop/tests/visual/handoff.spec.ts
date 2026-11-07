// HD-R1–HD-R7 and the prompt editor. Only the screenshot bot writes the baselines.
import { expect, test } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import { navigate } from "../e2e/support/call-page";
import * as H from "../e2e/support/handoff-world";

for (const state of ["ready", "others", "no-mapping", "sensitive", "edited", "diff", "codex", "failed", "generating", "no-handler", "open-failed"] as const) {
  test(`Handoff drawer — ${state}`, async ({ page }) => {
    let callId = "";
    const steer = await openWindow(page, "main", {
      world: (w) => {
        H.place(w);
        if (state !== "others") H.own(w);
        if (state === "no-mapping") H.unmap(w);
        if (state === "sensitive") H.sensitive(w);
        callId = H.callOf(w);
      },
    });
    await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
    await navigate(page, "summary", callId);
    if (state === "no-handler") {
      // A visual fixture for a valid core LaunchPlan; no product or harness contract is changed.
      await page.evaluate(() => {
        const fake = (globalThis as unknown as { __noterFake: { invoke(cmd: string, args: unknown): Promise<unknown> } }).__noterFake;
        const invoke = fake.invoke.bind(fake);
        fake.invoke = async (cmd, args) => {
          const value = await invoke(cmd, args);
          return cmd === "handoff_get" ? { ...(value as object), launch: { path: "none", needs_automation: false, automation_denied: false } } : value;
        };
      });
    }
    const row = page.locator('[data-component="cpt-noter-component-ui-action-item-row"]').filter({ hasText: "Replay buffer" }).first();
    await row.getByRole("button", { name: "Handoff" }).click();
    const drawer = page.locator('[data-region="HD"]');
    await expect(drawer.getByRole("textbox")).toBeVisible();
    if (state === "edited" || state === "diff") {
      await drawer.getByRole("textbox").fill("Fix the replay buffer overflow and add a regression test.");
      if (state === "diff") await drawer.getByRole("button", { name: "Diff", exact: true }).click();
    }
    if (state === "codex") {
      await drawer.getByRole("radio", { name: "Codex" }).click();
      await expect(drawer.getByRole("button", { name: "Open in Codex" })).toBeVisible();
    }
    if (state === "failed") {
      await steer.failNext("handoff_generate", "runtime_unavailable");
      await drawer.getByRole("button", { name: "Regenerate" }).click();
      await expect(drawer).toContainText("Couldn't write the prompt");
    }
    if (state === "open-failed") {
      await steer.failNext("handoff_open", "automation_denied");
      await drawer.getByRole("button", { name: "Open in Claude Code" }).click();
      await expect(drawer).toContainText("Couldn't open Claude Code");
    }
    if (state === "generating") {
      await page.clock.install();
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000)); // from the page: the runner's own time can be behind it
      await drawer.getByRole("button", { name: "Regenerate" }).click();
      await expect(drawer).toContainText("Writing the handoff prompt…");
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page.locator('[data-region="MW-R4"]')).toHaveScreenshot(`handoff-${state}.png`);
  });
}
