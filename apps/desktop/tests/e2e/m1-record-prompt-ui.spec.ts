// M1 — Record prompt (docs/features/ui/record-prompt.md, DESIGN.md › Screen — Record prompt, RP-R1, RP-R3).
// The UI half of the record-prompt stories: m1-record-prompt.spec.ts proves each path at the contract;
// these drive the panel (window "record-prompt") over the selected core and check what the user sees and
// which commands it sends. Written before the panel exists (tests first): they fail until the feature
// lands, and its PR carries them. Markup follows the prototype (`C.recordPrompt`): the panel is
// `data-component="cpt-noter-component-ui-record-prompt"` with `data-variant` and `data-state`, RP-R1 holds
// the title and source line, RP-R3 the buttons, and **Not Now ▾** is a pull-down whose items are menuitems.
// The panel never takes focus, clicks act in place, ⌃⌥⌘R is a global hotkey (the core's), and VoiceOver
// reads the native announcements: all of that is XCUITest's (see NATIVE at each test).
import type { Page } from "@playwright/test";

import type { CaptureNotice } from "../../src/core/bindings";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const panel = (page: Page) => page.locator('[data-component="cpt-noter-component-ui-record-prompt"]');
const r1 = (page: Page) => page.locator('[data-region="RP-R1"]');
const r3 = (page: Page) => page.locator('[data-region="RP-R3"]');
const button = (page: Page, name: string) => r3(page).getByRole("button", { name, exact: true });
const notNow = (page: Page) => r3(page).getByRole("button", { name: /^Not Now/ });
/** Arguments of every `name` command the window sent, in order. */
const sent = async (page: Page, name: string): Promise<Array<Record<string, unknown>>> =>
  (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => (c.args ?? {}) as Record<string, unknown>);
/** The window has read its first snapshot, so an absent panel is an answer and not a slow start. */
const settled = (page: Page) => expect.poll(async () => (await calls(page)).some((c) => c.name === "app_snapshot")).toBe(true);

/** A call app uses the microphone and nothing is being recorded. */
const detected = (app: { app_name: string; bundle_id: string }, blocked: "disk_full" | "model_missing" | null = null) => (w: World) => {
  W.idle(w);
  W.detect(w, app, blocked);
};
const live = (n: CaptureNotice) => (w: World) => W.notice(w, n);
const callEnded = (): CaptureNotice => ({ type: "call_ended", stops_at: Date.now() + 10_000 });
const newMeeting = (): CaptureNotice => ({
  type: "new_meeting",
  event: { id: "evt_anna", title: "1:1 with Anna K.", starts_at: Date.now(), ends_at: Date.now() + 30 * W.MIN },
  app_name: "Microsoft Teams",
  detected_at: Date.now(),
  expires_at: Date.now() + 60_000,
  default_choice: "start_as_new_call",
});
const TEAMS = `det_${W.APPS.teams.bundle_id}`;

test.describe("cpt-noter-seq-record-prompt-start-recording", () => {
  test("UI — happy path: Record this call? names the app, announces itself, Record starts capture and the panel closes", async ({ page }) => {
    await openWindow(page, "record-prompt", { world: detected(W.APPS.teams) });

    await expect(panel(page)).toHaveAttribute("data-variant", "default");
    await expect(panel(page)).toHaveAttribute("data-state", "default");
    await expect(r1(page)).toContainText("Record this call?");
    await expect(r1(page)).toContainText("Microsoft Teams is using the microphone");
    await expect(button(page, "Record")).toContainText("⌃⌥⌘R");
    await expect(button(page, "Record as Sensitive")).toBeEnabled();
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true); // never takes focus; the hotkey and click-in-place are NATIVE: test_cpt_noter_seq_record_prompt_start_recording__hotkey_keeps_focus
    expect(await sent(page, "window_announce")).toContainEqual({ text: "Noter: Record this call? Press Control-Option-Command-R to record.", politeness: "polite" });
    // the core fits the panel window to the panel (window_fit), 360 to 440 pt wide, so Record lies inside it
    await expect.poll(async () => (await sent(page, "window_fit")).length).toBeGreaterThan(0);
    const box = (await panel(page).boundingBox())!;
    expect((await sent(page, "window_fit")).at(-1)).toEqual({ width: Math.ceil(box.width), height: Math.ceil(box.height) });
    expect(box.width).toBeGreaterThanOrEqual(360);
    expect(box.width).toBeLessThanOrEqual(440);

    await button(page, "Record").click();
    expect(await sent(page, "capture_start")).toEqual([{ source: "record_prompt", sensitive: false, detection_id: TEAMS }]);
    await expect(panel(page)).toHaveCount(0); // fades out in 200 ms
    expect(await sent(page, "window_announce")).toContainEqual(expect.objectContaining({ text: "Recording started", politeness: "polite" }));
  });

  test("UI — other path: Vendor call recorded as sensitive — Record as Sensitive sends sensitive true", async ({ page }) => {
    await openWindow(page, "record-prompt", { world: detected(W.APPS.zoom) });
    await button(page, "Record as Sensitive").click();
    expect(await sent(page, "capture_start")).toEqual([{ source: "record_prompt", sensitive: true, detection_id: `det_${W.APPS.zoom.bundle_id}` }]);
    await expect(panel(page)).toHaveCount(0);
  });

  test("UI — other path: Matched calendar event — the source line is the event's title", async ({ page }) => {
    await openWindow(page, "record-prompt", {
      world: (w) => {
        detected(W.APPS.teams)(w);
        w.app.detection.detection!.matched_event = { id: "evt_planning", title: W.LIVE_TITLE, starts_at: Date.now(), ends_at: Date.now() + 30 * W.MIN };
      },
    });
    await expect(r1(page)).toContainText(W.LIVE_TITLE);
    await expect(r1(page)).not.toContainText("is using the microphone");
  });

  test("UI — other path: Not a call — Not Now ▾ › Don't Ask for Safari…, the browser line, Back returns, Don't Ask ignores the app", async ({ page }) => {
    await openWindow(page, "record-prompt", { world: detected(W.APPS.safari) });
    await expect(r1(page)).toContainText("Safari is using the microphone");

    await notNow(page).click();
    await page.getByRole("menuitem", { name: "Don't Ask for Safari…" }).click();
    await expect(panel(page)).toHaveAttribute("data-state", "not-a-call");
    await expect(r3(page)).toContainText("Calls in Safari, such as Google Meet, won't be offered for recording either.");
    await button(page, "Back").click();
    await expect(panel(page)).toHaveAttribute("data-state", "default");
    expect(await sent(page, "capture_ignore_app")).toEqual([]);

    await notNow(page).click();
    await page.getByRole("menuitem", { name: "Don't Ask for Safari…" }).click();
    await button(page, "Don't Ask").click();
    expect(await sent(page, "capture_ignore_app")).toEqual([{ ...W.APPS.safari }]);
    await expect(panel(page)).toHaveCount(0);
  });

  test("UI — other path: Not a call — a meeting app confirms inline with its own name", async ({ page }) => {
    await openWindow(page, "record-prompt", { world: detected(W.APPS.teams) });
    await notNow(page).click();
    await page.getByRole("menuitem", { name: "Don't Ask for Microsoft Teams…" }).click();
    await expect(r3(page)).toContainText("Microsoft Teams won't be offered for recording again.");
    await button(page, "Don't Ask").click();
    expect(await sent(page, "capture_ignore_app")).toEqual([{ ...W.APPS.teams }]);
  });

  test("UI — error path: Not enough disk space — reason with the free space, Record dimmed, Delete Old Audio… opens the sheet, Record works once cleared", async ({ page }) => {
    const steer = await openWindow(page, "record-prompt", {
      world: (w) => {
        detected(W.APPS.teams, "disk_full")(w);
        w.app.environment.disk_free_mb = 420;
      },
    });
    await expect(panel(page)).toHaveAttribute("data-state", "disabled");
    await expect(r3(page)).toContainText("Not enough disk space to record (420 MB free)");
    await expect(button(page, "Record")).toBeDisabled();
    await expect(button(page, "Record as Sensitive")).toHaveCount(0);

    await button(page, "Delete Old Audio…").click();
    expect(await sent(page, "window_navigate")).toHaveLength(1); // the sheet itself is the main window's (dialogs-host); deleting is M2

    await steer.change((w) => {
      w.app.environment.disk_free_mb = 6_600; // 6.2 GB freed
      w.app.detection.detection!.blocked = null;
    });
    await expect(button(page, "Record")).toBeEnabled();
    await expect(panel(page)).toHaveAttribute("data-state", "default");
  });

  test("UI — error path: Not enough disk space — a start refused with disk_full switches the open prompt to the Disk full variant", async ({ page }) => {
    const steer = await openWindow(page, "record-prompt", { world: detected(W.APPS.teams) });
    await expect(button(page, "Record")).toBeEnabled();
    await steer.failNext("capture_start", "disk_full", { type: "disk_space", free_mb: 420, needed_mb: 500 });
    await button(page, "Record").click();
    await expect(r3(page)).toContainText("Not enough disk space to record (420 MB free)");
    await expect(button(page, "Record")).toBeDisabled();
  });

  test("UI — error path: a start answered already_recording closes the prompt, the core shows the running call", async ({ page }) => {
    const steer = await openWindow(page, "record-prompt", { world: detected(W.APPS.teams) });
    await expect(panel(page)).toBeVisible();
    await steer.failNext("capture_start", "already_recording");
    await button(page, "Record").click();
    await expect(panel(page)).toHaveCount(0);
  });

  test("UI — error path: System audio access is off — a warning above an enabled Record that still starts capture, Open System Settings… opens its pane", async ({ page }) => {
    await openWindow(page, "record-prompt", { world: (w) => (detected(W.APPS.teams)(w), W.permission(w, "system_audio", "denied")) });
    await expect(r3(page)).toContainText("System audio access is off · only your side will be recorded");
    await expect(button(page, "Record")).toBeEnabled();

    await button(page, "Open System Settings…").click();
    expect(await sent(page, "open_external")).toEqual([{ target: { type: "system_settings", permission: "system_audio" } }]);
    await button(page, "Record").click();
    expect(await sent(page, "capture_start")).toHaveLength(1);
  });

  test("UI — error path: Speech model not downloaded — reason with the percentage, Record dimmed, no Record as Sensitive", async ({ page }) => {
    await openWindow(page, "record-prompt", {
      world: (w) => {
        detected(W.APPS.teams, "model_missing")(w);
        Object.assign(W.speechModel(w), { state: "downloading", size_mb: 1_000, done_mb: 620 });
      },
    });
    await expect(panel(page)).toHaveAttribute("data-state", "disabled");
    // the real core reports the bundle's real size, so only the fake can hold 62 %
    await expect(r3(page)).toContainText(process.env.NOTER_CORE === "stdio" ? /The speech model is still downloading \(\d+ %\)/ : "The speech model is still downloading (62 %)");
    await expect(button(page, "Record")).toBeDisabled();
    await expect(button(page, "Record as Sensitive")).toHaveCount(0);
  });
});

test.describe("cpt-noter-seq-record-prompt-record-after-missed-prompt", () => {
  test("UI — happy path: Not Now closes the prompt and sends capture_dismiss_detection (not_now)", async ({ page }) => {
    await openWindow(page, "record-prompt", { world: detected(W.APPS.teams) });
    await notNow(page).click();
    await page.getByRole("menuitem", { name: "Not Now" }).click();
    expect(await sent(page, "capture_dismiss_detection")).toEqual([{ detection_id: TEAMS, reason: "not_now" }]);
    await expect(panel(page)).toHaveCount(0);
    expect(await sent(page, "capture_start")).toEqual([]); // ⌃⌥⌘R minutes later is the core's hotkey: NATIVE test_cpt_noter_seq_record_prompt_record_after_missed_prompt__hotkey_records
  });

  test("UI — other path: the × closes it with reason closed", async ({ page }) => {
    await openWindow(page, "record-prompt", { world: detected(W.APPS.teams) });
    await r1(page).getByRole("button", { name: "Close" }).click();
    expect(await sent(page, "capture_dismiss_detection")).toEqual([{ detection_id: TEAMS, reason: "closed" }]);
    await expect(panel(page)).toHaveCount(0);
  });

  test("UI — empty path: Prompt closed unanswered — 15 s without hover or focus, the timer pauses while the pointer is on the panel", async ({ page }) => {
    await page.clock.install();
    await openWindow(page, "record-prompt", { world: detected(W.APPS.teams) });
    await expect(panel(page)).toBeVisible();

    await panel(page).hover();
    await page.clock.fastForward(20_000);
    expect(await sent(page, "capture_dismiss_detection")).toEqual([]); // paused, no visible countdown
    await page.mouse.move(0, 0);
    await page.clock.fastForward(16_000);
    expect(await sent(page, "capture_dismiss_detection")).toEqual([{ detection_id: TEAMS, reason: "timed_out" }]);
    await expect(panel(page)).toHaveCount(0);
  });

  test("UI — empty path: Setup incomplete — no prompt is drawn", async ({ page }) => {
    await openWindow(page, "record-prompt", { world: (w) => (W.idle(w), W.selfTestSkipped(w)) });
    await settled(page);
    await expect(panel(page)).toHaveCount(0);
  });

  test("UI — empty path: Hidden for presenting — no prompt is drawn on the shared screen", async ({ page }) => {
    await openWindow(page, "record-prompt", { world: (w) => (detected(W.APPS.teams)(w), (w.app.presenting.hidden = true)) });
    await settled(page);
    await expect(panel(page)).toHaveCount(0);
  });
});

test.describe("cpt-noter-seq-call-screen-stop-at-call-end", () => {
  test("UI — error path: Call window hidden — the call-ended variant counts down, hover pauses it, Keep Recording keeps the call", async ({ page }) => {
    const steer = await openWindow(page, "record-prompt", { world: live(callEnded()) });
    await expect(panel(page)).toHaveAttribute("data-variant", "call-ended");
    await expect(panel(page)).toHaveAttribute("data-state", "countdown-running");
    await expect(r1(page)).toContainText("The call seems to have ended");
    await expect(r1(page)).toContainText(/stopped using audio and the microphone 20 s ago\. Stopping in \d+ s\./);
    expect(await sent(page, "window_announce")).toContainEqual(expect.objectContaining({ politeness: "assertive", text: expect.stringContaining("seems to have ended") }));

    await panel(page).hover();
    await expect(panel(page)).toHaveAttribute("data-state", "countdown-paused");
    await expect(r1(page)).toContainText("Paused while you're here");
    expect(await sent(page, "capture_hold_notice")).toContainEqual({ call_id: W.LIVE_CALL, held: true });
    await page.mouse.move(0, 0);
    await expect(panel(page)).toHaveAttribute("data-state", "countdown-running");
    expect(await sent(page, "capture_hold_notice")).toContainEqual({ call_id: W.LIVE_CALL, held: false });

    await button(page, "Keep Recording").click();
    expect(await sent(page, "capture_answer_call_end")).toEqual([{ call_id: W.LIVE_CALL, choice: "keep_recording" }]);
    await expect(panel(page)).toHaveCount(0);
    await steer.change((w) => expect(w.app.capture.phase).toBe("recording")); // the call goes on
  });

  test("UI — error path: Call window hidden — under Reduce motion the countdown bar is absent, the seconds still update and are never announced", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install();
    await openWindow(page, "record-prompt", { world: live(callEnded()) });
    await expect(panel(page)).toHaveAttribute("data-state", "countdown-running");
    await expect(panel(page).locator(".rp-countdown")).toBeHidden();

    const seconds = panel(page).locator(".rp-sub .np-tnum");
    const before = await seconds.textContent();
    expect(before).toMatch(/^Stopping in \d+ s\.$/);
    await page.clock.fastForward(3_000);
    await expect(seconds).not.toHaveText(before ?? "");
    await expect(seconds).toHaveText(/^Stopping in \d+ s\.$/);

    const announced = (await sent(page, "window_announce")).map((a) => String(a.text));
    expect(announced.length).toBeGreaterThan(0); // the "seems to have ended" notice is announced once, without a number
    expect(announced.filter((text) => /Stopping in|\d+ s\b/.test(text))).toEqual([]);
    await expect(panel(page).locator("[aria-live]").filter({ hasText: /Stopping in/ })).toHaveCount(0);
  });

  test("UI — error path: Call window hidden — Stop Now stops the call and the panel closes", async ({ page }) => {
    await openWindow(page, "record-prompt", { world: live(callEnded()) });
    await button(page, "Stop Now").click();
    expect(await sent(page, "capture_answer_call_end")).toEqual([{ call_id: W.LIVE_CALL, choice: "stop_now" }]);
    await expect(panel(page)).toHaveCount(0); // Continue Recording for 5 minutes is the menu bar's
  });

  for (const [action, choice] of [["Start as New Call", "start_as_new_call"], ["Keep in This Call", "keep_in_this_call"]] as const) {
    test(`UI — error path: Next meeting starts straight away — the new-meeting variant, ${action} sends ${choice}`, async ({ page }) => {
      await openWindow(page, "record-prompt", { world: live(newMeeting()) });
      await expect(panel(page)).toHaveAttribute("data-variant", "new-meeting");
      await expect(r1(page)).toContainText("A new meeting may have started: 1:1 with Anna K.");
      await expect(r1(page)).toContainText(`${W.LIVE_TITLE} is still recording.`);
      expect(await sent(page, "window_announce")).toContainEqual(expect.objectContaining({ politeness: "assertive" }));

      await button(page, action).click();
      expect(await sent(page, "capture_answer_new_meeting")).toEqual([{ call_id: W.LIVE_CALL, choice }]);
      await expect(panel(page)).toHaveCount(0);
    });
  }
});
