// Screenshot specs of the call page frame (docs/features/ui/call-page-frame.md › Definitions of Done): the Transcript
// view, Call info with the audio kept and deleted, the first-call notification banner and the loading skeleton,
// rendered against the fake core. The page opens the way the core opens it, with a `nav:request`.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";

type Fake = { invoke: (cmd: string, args: unknown) => Promise<unknown>; latency: number };
const ready = (page: Page) => expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
const quiet = (more: (w: World) => void = () => {}) => (w: World) => {
  W.idle(w);
  w.app.setup.self_test = { type: "passed", at: 1 };
  more(w);
};
const patch = (w: World, fn: (c: World["calls"][number]) => void) => {
  fn(w.calls.find((c) => c.id === W.PAST_CALL)!);
  fn(w.call_details.find((d) => d.call.id === W.PAST_CALL)!.call);
};

async function open(page: Page, world: (w: World) => void, latency = 0) {
  await openWindow(page, "main", { world });
  await ready(page);
  await page.waitForFunction(() => (globalThis as unknown as { __noterFake?: Fake }).__noterFake);
  await page.evaluate(
    ([id, ms]) => {
      const fake = (globalThis as unknown as { __noterFake: Fake }).__noterFake;
      fake.latency = ms as number;
      return fake.invoke("window_navigate", { target: { type: "call_page", call_id: id, tab: "transcript" } });
    },
    [W.PAST_CALL, latency],
  );
}
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.describe("cpt-noter-dod-ui-call-page-frame-frame call page", () => {
  test("transcript view with Call info, audio kept", async ({ page }) => {
    await open(page, quiet());
    await expect(page.locator('[data-region="PC-R5"]')).toBeVisible();
    await expect(page.locator('[data-region="MW-R4"]')).toContainText("Kept until");
    await shot(page, "transcript-audio-kept");
  });

  test("Call info: audio deleted, transcript kept", async ({ page }) => {
    await open(page, quiet((w) => patch(w, (c) => ((c.audio_deleted = true), (c.audio_kept_until = null)))));
    await expect(page.locator('[data-region="MW-R4"]')).toContainText("transcript kept");
    await shot(page, "audio-deleted");
  });

  test("loading: skeleton rows after 300 ms", async ({ page }) => {
    await open(page, quiet(), 4000);
    await expect(page.getByRole("status", { name: "Loading the call" })).toBeVisible();
    await shot(page, "loading");
  });
});

test.describe("cpt-noter-dod-ui-call-page-frame-actions call page", () => {
  test("first recorded call: the notification banner", async ({ page }) => {
    await open(page, quiet((w) => (w.call_details.find((d) => d.call.id === W.PAST_CALL)!.first_recorded_call = true)));
    await expect(page.locator('[data-region="PC-R2"]')).toContainText("Get a notification when a summary is ready.");
    await shot(page, "first-call-banner");
  });

  test("the ⋯ menu with Call Type open", async ({ page }) => {
    await open(page, quiet());
    await page.locator('[data-region="PC-R1"]').getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Call Type" }).hover();
    await expect(page.getByRole("menuitem").filter({ hasText: /standup/i })).toBeVisible();
    await shot(page, "more-menu-call-type");
  });
});
