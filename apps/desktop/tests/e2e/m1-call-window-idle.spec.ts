import { firstRun, idle, speechModel } from "../support/world-presets";
import { openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";

test("cpt-noter-seq-floating-panel-hide-and-reopen — open the idle Call Screen, close it, and start a call on reopening", async ({ page }) => {
  const steer = await openWindow(page, "call-screen", { world: (w) => firstRun(w, { modelsReady: true }) });
  const show = () => steer.invoke("window_show_call", {}, "main");
  const idleTitle = page.getByRole("heading", { name: "Not recording" });
  await show();
  await expect(idleTitle).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => sent(page, "window_hide_call")).toHaveLength(1);
  await expect(idleTitle).toHaveCount(0);

  await show();
  await page.getByRole("button", { name: "Start Recording", exact: true }).click();
  await expect(page.getByRole("img", { name: "Recording", exact: true })).toBeVisible();
  await expect(idleTitle).toHaveCount(0);
  expect(await sent(page, "capture_start")).toEqual([{ source: "call_window", sensitive: false }]);
});

test("cpt-noter-seq-floating-panel-hide-and-reopen — a live Call Screen recovers from a failed window state read", async ({ page }) => {
  await openWindow(page, "call-screen", { fail: [{ cmd: "window_call_state", code: "internal" }] });
  await page.getByRole("button", { name: "Try Again" }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
});

for (const blocker of ["model", "disk"] as const) {
  test(`cpt-noter-seq-floating-panel-hide-and-reopen — an idle panel explains the ${blocker} blocker and opens its Settings pane`, async ({ page }) => {
    const steer = await openWindow(page, "call-screen", { world: (w) => {
      idle(w);
      if (blocker === "model") speechModel(w).state = "pending";
      else w.app.environment.disk_free_mb = 499;
    } });
    await steer.invoke("window_show_call", {}, "main");
    await expect(page.getByRole("button", { name: "Start Recording" })).toBeDisabled();
    await expect(page.locator('[data-component="cpt-noter-component-ui-empty-state"]').getByText(blocker === "model" ? /until the speech model is downloaded/ : /less than 500 MB/)).toBeVisible();
    await page.getByRole("link", { name: blocker === "model" ? "Models & Runtimes" : "Maintenance" }).click();
    await expect.poll(() => sent(page, "window_navigate")).toEqual([{ target: { type: "settings", pane: blocker === "model" ? "models_and_runtimes" : "maintenance" } }]);
  });
}
