// M1 — Menu bar extra (docs/features/ui/menu-bar.md, DESIGN.md › Screen — Menu bar extra, MB-R2..R7).
// The menu, its glyphs, info lines, hotkey hints, dimmed items and the quit alert are drawn by macOS
// and run by the core as `Caller::Native`: they are XCUITest's, not tested here. What the web side
// owns is what the windows show when the menu acts (the same capture state and navigation events the
// hotkeys cause), and that no window sends a command for it. Contract paths: m1-menu-bar.spec.ts.
// Written before the windows exist (tests first). NATIVE, in apps/desktop/tests/native/NoterNativeUITests/MenuBarTests.swift:
//   test_cpt_noter_seq_menu_bar_control_recording__mark_pause_resume_stop_continue
//   test_cpt_noter_seq_menu_bar_control_recording__paused_for_5_min
//   test_cpt_noter_seq_menu_bar_control_recording__quit_while_recording_alert
//   test_cpt_noter_seq_menu_bar_check_state__recording_lines_and_hotkeys
//   test_cpt_noter_seq_menu_bar_check_state__not_recording_start_and_next_event
//   test_cpt_noter_seq_menu_bar_check_state__switched_to_local
//   test_cpt_noter_seq_menu_bar_check_state__setup_incomplete
//   test_cpt_noter_seq_menu_bar_check_state__new_meeting_while_hidden
//   test_cpt_noter_seq_menu_bar_check_state__glyph_per_state_and_hidden_badge
//   test_cpt_noter_seq_menu_bar_check_state__no_hotkey_shows_no_key
//   test_cpt_noter_flow_ui_menu_bar_start__start_recording_dimmed_below_500_mb
//   test_cpt_noter_flow_ui_menu_bar_start__open_items_open_only_their_windows
//   test_cpt_noter_seq_record_prompt_record_after_missed_prompt__call_detected_start_recording
//   test_cpt_noter_seq_call_screen_hide_for_presenting__hide_and_show_noter_items
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const FAKE = process.env.NOTER_CORE !== "stdio";
const button = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
const word = (p: Page, w: string) => p.getByText(w, { exact: true }).or(p.getByRole("img", { name: w, exact: true })).first();
const invoked = async (p: Page) => (await calls(p)).filter((c) => c.kind === "invoke").map((c) => c.name as string);
/** What the core does when a menu item opens a window: the navigation event the window listens to (the fake emits it directly). */
const navRequest = (page: Page, target: object) =>
  page.evaluate((t) => (globalThis as unknown as { __noterFake: { emit(e: string, p: object): void } }).__noterFake.emit("nav:request", t), target);

test.describe("cpt-noter-flow-ui-menu-bar-control-recording", () => {
  test("UI — happy path: Pause, Resume, Stop Recording and Continue Recording from the menu show in the call window, which sends nothing itself", async ({ page }) => {
    const steer = await openWindow(page, "call-screen");
    const before = (await invoked(page)).filter((c) => c.startsWith("capture_"));
    await expect(word(page, "Recording")).toBeVisible();

    await steer.change((w) => Object.assign(w.app.capture, { phase: "paused", pause: { since: Date.now(), remind_at: Date.now() + 5 * W.MIN } })); // Pause
    await expect(word(page, "Paused")).toBeVisible();
    await expect(button(page, "Resume")).toBeVisible();
    await steer.change((w) => Object.assign(w.app.capture, { phase: "recording", pause: null })); // Resume
    await expect(word(page, "Recording")).toBeVisible();

    await steer.change((w) => Object.assign(w.app.capture, { phase: "stopped", continue_until: Date.now() + 5 * W.MIN })); // Stop Recording
    await expect(page.getByText(/Saved · \d+ min · Summary in about 2 minutes/)).toBeVisible();
    await expect(button(page, "Continue Recording")).toBeVisible();
    await steer.change((w) => Object.assign(w.app.capture, { phase: "recording", continue_until: null })); // Continue Recording
    await expect(word(page, "Recording")).toBeVisible();
    await expect(button(page, "Mark Moment")).toBeVisible();

    expect((await invoked(page)).filter((c) => c.startsWith("capture_"))).toEqual(before); // the menu's calls are the core's own
  });

  test("UI — error path: Paused for 5 minutes — the window keeps Paused with Resume primary until the menu resumes with a gap", async ({ page }) => {
    const steer = await openWindow(page, "call-screen", { world: (w) => Object.assign(w.app.capture, { phase: "paused", pause: { since: Date.now() - 5 * W.MIN, remind_at: Date.now() } }) });

    await expect(word(page, "Paused")).toBeVisible();
    await expect(button(page, "Resume")).toBeVisible();
    await steer.change((w) => Object.assign(w.app.capture, { phase: "recording", pause: null })); // Resume in the menu
    await expect(word(page, "Recording")).toBeVisible();
    await expect(button(page, "Pause")).toBeVisible();
  });
});

test.describe("cpt-noter-flow-ui-menu-bar-start", () => {
  test("UI — happy path: Start Recording from the menu opens the call window on the recording, whatever the setup state", async ({ page }) => {
    const steer = await openWindow(page, "call-screen", { world: (w) => (W.idle(w), W.selfTestSkipped(w)) });

    await steer.change((w) =>
      Object.assign(w.app.capture, { phase: "recording", call_id: W.LIVE_CALL, title: W.LIVE_TITLE, started_at: Date.now(), recorded_ms: 0 }),
    );
    await expect(word(page, "Recording")).toBeVisible();
    await expect(page.getByRole("heading", { name: W.LIVE_TITLE }).or(page.getByText(W.LIVE_TITLE)).first()).toBeVisible();
    await expect(page.getByText("Finish Setup…")).toHaveCount(0); // never in place of Start Recording
  });

  test("UI — other path: Use Floating Panel in the menu switches the same window to the floating layout", async ({ page }) => {
    await openWindow(page, "call-screen");
    const dedicated = page.locator('[data-component="cpt-noter-component-screen-call-screen"]');
    await expect(dedicated).toBeVisible();

    if (FAKE) {
      await page.evaluate(() => {
        const f = (globalThis as unknown as { __noterFake: { callWindow: { layout: string }; publish(e: string): void } }).__noterFake;
        f.callWindow.layout = "floating"; // window_set_call_layout, run by the core for the menu item
        f.publish("window:call");
      });
    }
    await expect(page.locator('[data-component="cpt-noter-component-screen-floating-panel"]')).toBeVisible();
    await expect(dedicated).toHaveCount(0);
    expect((await invoked(page)).filter((c) => c === "window_set_call_layout")).toHaveLength(0);
  });
});

test.describe("cpt-noter-flow-ui-menu-bar-check-state", () => {
  test("UI — other path: Open Last Summary — the main window opens the call's page from the navigation request", async ({ page }) => {
    let title = "";
    await openWindow(page, "main", {
      world: (w) => {
        W.idle(w);
        title = w.calls.find((c) => c.id === W.PAST_CALL)!.title;
      },
    });
    await expect(page.locator('[data-region="MW-R3"]')).toBeVisible();

    await navRequest(page, { type: "call_page", call_id: W.PAST_CALL, tab: "summary" });
    await expect(page.locator('[data-region="MW-R3"]').getByRole("heading", { name: title }).first()).toBeVisible();
    expect((await invoked(page)).filter((c) => c === "window_navigate")).toHaveLength(0); // the core navigates, not the window
  });

  test("UI — error path: Setup incomplete — Finish Setup… lands the first-run window on the step where setup stopped", async ({ page }) => {
    await openWindow(page, "first-run", { world: (w) => W.firstRun(w) });

    await expect(page.getByRole("list", { name: "Setup steps" }).getByRole("listitem").filter({ hasText: "Permissions" })).toHaveAttribute("aria-current", "step");
    expect((await invoked(page)).filter((c) => c === "window_navigate")).toHaveLength(0);
  });
});
