// cpt-noter-seq-ask-cited-answer: retrieval and source-reading stay visible until answer text arrives.
import { openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";
import * as W from "../support/world-presets";

const REAL = process.env.NOTER_CORE === "stdio";

test("cpt-noter-seq-ask-cited-answer — Searching, then Reading, then the answer", async ({ page }) => {
  if (!REAL) {
    await page.clock.install();
    await page.clock.resume();
  }
  const steer = await openWindow(page, "main", { world: W.idle, latency: 1000, latencyFor: "ask_start" });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit2");
    await expect(page.getByRole("heading", { name: "Ask", exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass();
  if (REAL) {
    await steer.invoke("harness.llm_next", {
      skill: "ask-answer",
      after_ms: 1500,
      output: { answer_md: "Drawer events use the notification service [1].", citations: [{ n: 1, segment_ids: ["seg_1"], chunk_ids: [], quote: "notification service" }], found: true },
    });
  } else {
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 500);
  }
  const field = page.locator('[data-region="AK-R4"]').getByRole("textbox");
  await field.fill("What did we decide about drawer notifications?");
  await field.press("Enter");
  const turn = page.locator(".ak-turn").last();
  await expect(turn.getByText("Searching calls and documents…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  if (!REAL) {
    await page.clock.runFor(1250);
    await expect(async () => {
      await page.clock.runFor(20);
      await expect(turn.getByText("Reading calls and documents…")).toBeVisible({ timeout: 200 });
    }).toPass({ timeout: 20000 });
  } else {
    await expect(turn.getByText("Reading calls and documents…")).toBeVisible();
  }
  await expect(turn.getByText("Searching calls and documents…")).toHaveCount(0);
  await expect(field).toBeFocused();
  if (!REAL) await page.clock.resume();
  await expect(turn.locator(".ak-ans__p").first()).toBeVisible();
  await expect(turn.getByText("Reading calls and documents…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
});
