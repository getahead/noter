// Call window (cpt-noter-feature-ui-call-window) in the copilot-off layout of M1: one screenshot per state of
// surface('call') the FEATURE's definitions of done list, rendered against the fake core and a frozen
// clock. The live script is empty, so the transcript, countdown and notice bar are part of each comparison.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { freeze, NOW, settled } from "./freeze";

type Win = Partial<{ layout: "dedicated" | "floating"; collapsed: boolean; show_share_warning: boolean }>;
const DEDICATED = { width: 1280, height: 800 };
const FLOATING = { width: 420, height: 560 };

async function shot(page: Page, name: string, world: (w: World) => void = () => {}, win: Win = {}) {
  await page.setViewportSize(win.layout === "floating" ? (win.collapsed ? { width: 420, height: 56 } : FLOATING) : DEDICATED);
  await openWindow(page, "call-screen", { world: (w) => { world(w); w.live_script = []; } });
  if (Object.keys(win).length)
    await page.evaluate((p) => {
      const f = (globalThis as unknown as { __noterFake: { callWindow: object; publish(e: string): void } }).__noterFake;
      Object.assign(f.callWindow, p);
      f.publish("window:call");
    }, win);
  await expect(page.locator('[data-component="cpt-noter-component-shell-call-window"]')).toBeVisible();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settled(page);
  await expect(page).toHaveScreenshot(`${name}.png`);
}

test.beforeEach(({ page }) => freeze(page));

const live = W.LIVE_CALL;
const ended = (w: World) => W.notice(w, { type: "call_ended", stops_at: NOW + 10_000 });
const meeting = (w: World) =>
  W.notice(w, {
    type: "new_meeting",
    event: { id: "evt_anna", title: "1:1 with Anna K.", starts_at: NOW, ends_at: NOW + 30 * W.MIN } as never,
    app_name: "Microsoft Teams",
    detected_at: Date.UTC(2026, 9, 24, 14, 30),
    expires_at: NOW + 60_000,
    default_choice: "start_as_new_call",
  });
const stoppedAt = (w: World, auto: boolean) =>
  Object.assign(w.app.capture, { phase: "stopped", continue_until: NOW + 5 * W.MIN, notice: auto ? { type: "stopped_automatically", call_id: live } : null });

test.describe("cpt-noter-dod-ui-call-window-shell call window layouts", () => {
  test("copilot-off: the dedicated layout with the header chips", async ({ page }) => shot(page, "copilot-off"));
  test("unplugged: the floating layout", async ({ page }) => shot(page, "unplugged", W.laptopOnly, { layout: "floating" }));
  test("floating, first open: the share warning", async ({ page }) => shot(page, "share-warning", () => {}, { layout: "floating", show_share_warning: true }));
  test("collapsed: the strip", async ({ page }) => shot(page, "collapsed", () => {}, { layout: "floating", collapsed: true }));
  test("paused: Resume is primary", async ({ page }) => shot(page, "paused", (w) => Object.assign(w.app.capture, { phase: "paused", pause: { since: NOW - 3 * W.MIN, remind_at: null } })));
});

test.describe("cpt-noter-dod-ui-call-window-capture capture notices and the closing state", () => {
  test("call-ended", async ({ page }) => shot(page, "call-ended", ended));
  test("call-ended, floating", async ({ page }) => shot(page, "call-ended-floating", ended, { layout: "floating" }));
  test("new-meeting", async ({ page }) => shot(page, "new-meeting", meeting));
  test("nothing-heard: the waiting transcript and recovery notice", async ({ page }) => {
    await page.setViewportSize(DEDICATED);
    await openWindow(page, "call-screen", { world: (w) => {
      w.live_script = [];
      W.notice(w, { type: "nothing_heard", since: NOW - 5 * W.MIN });
      const transcript = w.transcripts.find((item) => item.call_id === live)!;
      Object.assign(transcript, { segments: [], hypotheses: [], marks: [], gaps: [] });
    } });
    await expect(page.locator('[data-component="cpt-noter-component-shell-call-window"]')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await settled(page);
    const transcript = page.locator('[data-component="cpt-noter-component-ui-transcript-view"]');
    await expect(transcript).toHaveAttribute("data-state", "waiting-for-speech");
    await expect(transcript.getByText("Waiting for speech…")).toBeInViewport();
    await expect(transcript.getByText("You", { exact: true })).toBeInViewport();
    await expect(transcript.getByText("Others", { exact: true })).toBeInViewport();
    await expect(transcript.locator('[data-component="cpt-noter-component-ui-transcript-segment-row"]')).toHaveCount(0);
    await expect(page.getByText("Nothing heard yet")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Discard Recording" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Keep Recording" })).toBeInViewport();
    await expect(page).toHaveScreenshot("nothing-heard.png");
  });
  test("closing-manual", async ({ page }) => shot(page, "closing-manual", (w) => stoppedAt(w, false)));
  test("closing-auto", async ({ page }) => shot(page, "closing-auto", (w) => stoppedAt(w, true)));
});

test.describe("cpt-noter-dod-ui-call-window-degraded degraded states", () => {
  const since = NOW;
  test("mic-only", async ({ page }) => shot(page, "mic-only", (w) => W.degrade(w, { type: "system_audio_silent", call_id: live, since, confidence: 0.9 })));
  test("mic-off", async ({ page }) => shot(page, "mic-off", (w) => W.degrade(w, { type: "microphone_off", call_id: live })));
  test("engine-stopped", async ({ page }) => shot(page, "engine-stopped", (w) => ((w.app.capture.phase = "failed"), W.degrade(w, { type: "capture_failed", call_id: live, since }))));
  test("stalled", async ({ page }) => shot(page, "stalled", (w) => W.degrade(w, { type: "transcription_stalled", call_id: live, since })));
  test("disk", async ({ page }) => shot(page, "disk", (w) => W.degrade(w, { type: "disk_low", free_mb: 2_000 })));
  test("second-source", async ({ page }) => shot(page, "second-source", (w) => W.degrade(w, { type: "second_audio_source", call_id: live, ...W.APPS.slack, since })));
  test("second-source, floating: the compact banner", async ({ page }) => shot(page, "second-source-floating", (w) => W.degrade(w, { type: "second_audio_source", call_id: live, ...W.APPS.slack, since }), { layout: "floating" }));
});
