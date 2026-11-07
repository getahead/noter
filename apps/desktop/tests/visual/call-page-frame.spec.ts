// Screenshot specs of the call page frame (docs/features/ui/call-page-frame.md › Definitions of Done): the Transcript
// view, Call info with the audio kept and deleted, the first-call notification banner and the loading skeleton,
// rendered against the fake core. The page opens the way the core opens it, with a `nav:request`.
// Baselines come from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import { hold } from "./hold";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";

type Fake = { invoke: (cmd: string, args: unknown) => Promise<unknown>; latency: number };
/** The Backend sync transcript long enough to fill PC-R5 (as live-transcript.spec.ts lengthens the live one). */
const fuller = (w: World) => {
  const t = w.transcripts.find((x) => x.call_id === W.PAST_CALL)!;
  const last = t.segments.at(-1)!;
  for (let i = 0; i < 24; i++) t.segments.push({ ...last, id: `seg_more_${i}`, t0_ms: last.t0_ms + (i + 1) * 8000, t1_ms: last.t1_ms + (i + 1) * 8000 });
};
const ROW = '[data-component="cpt-noter-component-ui-transcript-segment-row"]';
/** PC-R5 once the header has its audio line and the stored transcript its rows. */
const stored = async (page: Page, line: string | RegExp) => {
  await expect(page.locator('[data-region="PC-R5"] .pc-tr__head')).toContainText(line);
  await expect(page.locator(`[data-region="PC-R5"] ${ROW}`).first()).toBeVisible();
};
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

async function open(page: Page, world: (w: World) => void, holdCmd?: string) {
  await openWindow(page, "main", { world });
  await ready(page);
  if (holdCmd) await hold(page, holdCmd);
  await page.waitForFunction(() => (globalThis as unknown as { __noterFake?: Fake }).__noterFake);
  await page.evaluate((id) => (globalThis as unknown as { __noterFake: Fake }).__noterFake.invoke("window_navigate", { target: { type: "call_page", call_id: id, tab: "transcript" } }), W.PAST_CALL);
}
const shot = async (page: Page, name: string, timeout?: number) => {
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`, { timeout });
};

test.describe("cpt-noter-dod-ui-call-page-frame-frame call page", () => {
  test("transcript view with Call info, audio kept", async ({ page }) => {
    // The virtualised transcript measures its rows after fonts load; keep its scroll instant and dates fixed.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.setFixedTime(new Date("2026-11-06T12:00:00Z"));
    await open(page, quiet(fuller));
    await stored(page, /audio kept until/);
    await expect(page.locator('[data-region="MW-R4"]')).toContainText("Kept until");
    await expect(page.getByRole("combobox", { name: "Tags", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    // Linux WebKit's first capture can consume the default 5 s before the second stability capture starts.
    await shot(page, "transcript-audio-kept", 15_000);
  });

  test("Call info: audio deleted, transcript kept", async ({ page }) => {
    await open(page, quiet((w) => (fuller(w), patch(w, (c) => ((c.audio_deleted = true), (c.audio_kept_until = null))))));
    await stored(page, "Audio deleted · transcript kept");
    await expect(page.locator('[data-region="MW-R4"]')).toContainText("transcript kept");
    await shot(page, "audio-deleted");
  });

  test("loading: skeleton rows after 300 ms", async ({ page }) => {
    await open(page, quiet(), "call_get");
    // only call_get is parked: the skeleton shows 300 ms after the page asks and holds until it answers
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
    await expect(page.getByRole("menuitemcheckbox", { name: /standup/i })).toBeVisible();
    await shot(page, "more-menu-call-type");
  });
});
