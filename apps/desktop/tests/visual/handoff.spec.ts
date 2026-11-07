// HD-R1–HD-R7 and the prompt editor. Only the screenshot bot writes the baselines.
import { expect, test } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import { navigate } from "../e2e/support/call-page";
import * as H from "../e2e/support/handoff-world";

for (const state of ["ready", "others", "no-mapping", "sensitive", "edited", "diff", "codex", "failed"] as const) {
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
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(page.locator('[data-region="MW-R4"]')).toHaveScreenshot(`handoff-${state}.png`);
  });
}
