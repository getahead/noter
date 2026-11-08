// First-run self-test readiness shared by E2E and screenshots (issue #392).
import { expect, type Page } from "@playwright/test";

import { calls, type Steer } from "./app";

const FAKE = process.env.NOTER_CORE !== "stdio";
const permissionRow = (page: Page, name: string) => page.locator('[data-component="cpt-noter-component-ui-permission-check-row"]').filter({ hasText: name });

/** Complete the real system-audio probe and wait for the fake's initial meter layout. */
export async function confirmSystemAudio(page: Page): Promise<void> {
  const sys = permissionRow(page, "System audio recording");
  const open = sys.getByRole("button", { name: "Open System Settings…" });
  await expect(sys).toContainText(/Granted|not allowed/);
  if (await open.count()) {
    await open.click();
    await page.evaluate(() => void dispatchEvent(new Event("focus")));
  }
  await expect(sys).toContainText("Granted", { timeout: 15_000 });
  // This meter inserts a row and moves Run Test; wait before placing the pointer.
  if (FAKE) await expect(permissionRow(page, "Microphone").getByRole("meter", { name: "Microphone level" })).toBeVisible();
}

/** Start through the UI and wait for the core's response, rather than its command log entry. */
export async function startSelfTest(page: Page, { manual }: { manual?: Steer } = {}): Promise<void> {
  await confirmSystemAudio(page);
  if (manual) await manual.holdNextSelfTest();
  const sentRuns = async () => (await calls(page)).filter((c) => c.name === "self_test_run").length;
  const before = await sentRuns();
  const run = page.getByRole("button", { name: "Run Test", exact: true });
  await expect(run).toBeEnabled();
  // One press from the keyboard: a mouse click goes to coordinates, and the row above (the microphone meter on the real core) can shift the button after the click's stability check, so the click hits nothing.
  await run.press("Enter");
  await expect.poll(sentRuns).toBe(before + 1);
  await expect.poll(async () => (await calls(page)).filter((c) => c.name === "self_test_run" && c.completed).length).toBe(before + 1);
}
