// M1 — Call window (docs/features/ui/call-window.md, DESIGN.md › Shell — Call window, CS-R0..R5, FP-R0..R6, FP-C1..C3).
// The UI half of the call-window stories: m1-call-screen-capture, m1-call-screen-replay-presenting and
// m1-floating-panel prove each path at the contract; these drive the window (copilot-off layout of
// M1) and check what the user sees and which commands it sends. Written before the window exists
// (tests first). Markup follows the prototype (`surface('call')`): notice slot CS-R0/FP-R0, banner slot
// CS-R3/FP-R3, transcript CS-R2/FP-R5, status strip CS-R5/FP-R6, strip FP-C1..C3, the two layouts
// carry their DESIGN component IDs in `data-component`. What macOS does (non-activation, ⌃⌥⌘N and
// ⌃⌥⌘0 as keys, the NSPanel, placement, the notification) is XCUITest's, not tested here:
//   test_cpt_noter_seq_floating_panel_hide_and_reopen__hotkey_shows_without_focus
//   test_cpt_noter_seq_call_screen_hide_for_presenting__hotkey_hides_and_restores_every_surface
//   test_cpt_noter_seq_call_screen_stop_at_call_end__hidden_for_presenting_menu_carries_notice
//   test_cpt_noter_seq_floating_panel_display_unplugged__panel_lands_inside_remaining_display
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { calls, openWindow, type Steer } from "./support/app";
import { expect, test } from "./support/fixtures";

const FAKE = process.env.NOTER_CORE !== "stdio";
const SLACK = W.APPS.slack.bundle_id;
const dedicated = (p: Page) => p.locator('[data-component="cpt-noter-component-screen-call-screen"]');
const floating = (p: Page) => p.locator('[data-component="cpt-noter-component-screen-floating-panel"]');
const noticeSlot = (p: Page) => p.locator('[data-region="CS-R0"], [data-region="FP-R0"]');
const bannerSlot = (p: Page) => p.locator('[data-region="CS-R3"], [data-region="FP-R3"]');
const transcript = (p: Page) => p.locator('[data-region="CS-R2"], [data-region="FP-R5"]');
const strip = (p: Page) => p.locator('[data-region="CS-R5"], [data-region="FP-R6"]');
const header = (p: Page) => p.locator('[data-region="CS-R1"], [data-region="FP-R1"]');
const button = (p: Page, name: string) => p.getByRole("button", { name, exact: true });
/** The recording indicator's state word (text in the dot-text variant, label in the dot variant). */
const word = (p: Page, w: string) => p.getByText(w, { exact: true }).or(p.getByRole("img", { name: w, exact: true })).first();
const sent = async (p: Page, name: string): Promise<unknown[]> => (await calls(p)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args);
const live = { call_id: W.LIVE_CALL };

/** What the core does by itself when the window or the displays change: `window:call` (the fake does not derive it from the world). */
async function coreWindow(page: Page, patch: Partial<{ visible: boolean; layout: "dedicated" | "floating"; collapsed: boolean; show_share_warning: boolean }>) {
  if (!FAKE) return; // the real core derives it from the displays and the settings
  await page.evaluate((p) => {
    const f = (globalThis as unknown as { __noterFake: { callWindow: object; publish(e: string): void } }).__noterFake;
    Object.assign(f.callWindow, p);
    f.publish("window:call");
  }, patch);
}
/** ⋯ › item in the header of whichever layout is showing. */
async function more(page: Page, item: string) {
  await header(page).getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
const toFloating = (page: Page) => more(page, "Use Floating Panel");
const gapAt = (steer: Steer, t0_ms: number, t1_ms: number, reason: string) =>
  steer.push("transcript_subscribe", { event: { type: "gap", gap: { call_id: W.LIVE_CALL, t0_ms, t1_ms, reason: reason as never } } });
/** No scripted lines after the snapshot, so a before/after comparison of the transcript is stable. */
const still = (w: Parameters<typeof W.idle>[0]) => void (FAKE && ((w as unknown as { live_script: unknown[] }).live_script = []));
const startLive = (page: Page, world: (w: Parameters<typeof W.idle>[0]) => void = () => {}) => openWindow(page, "call-screen", { world });

test.describe("cpt-noter-seq-call-screen-recover-capture", () => {
  test("UI — happy path: Slack is also playing audio — Exclude Slack closes the banner, the transcript carries on", async ({ page }) => {
    await startLive(page, (w) => W.degrade(w, { type: "second_audio_source", call_id: W.LIVE_CALL, ...W.APPS.slack, since: Date.now() }));
    const banner = bannerSlot(page);

    await expect(banner).toContainText("Slack is also playing audio");
    await banner.getByRole("button", { name: "Exclude Slack" }).click();
    expect(await sent(page, "capture_exclude_source")).toContainEqual({ ...live, bundle_id: SLACK });
    await expect(banner).toHaveCount(0);
    await expect(word(page, "Recording")).toBeVisible();
  });

  test("UI — other path: Keep — the banner closes and is not shown again for that app", async ({ page }) => {
    const steer = await startLive(page, (w) => W.degrade(w, { type: "second_audio_source", call_id: W.LIVE_CALL, ...W.APPS.slack, since: Date.now() }));

    await bannerSlot(page).getByRole("button", { name: "Keep" }).click();
    expect(await sent(page, "capture_keep_source")).toContainEqual({ ...live, bundle_id: SLACK });
    await expect(bannerSlot(page)).toHaveCount(0);
    await steer.change((w) => W.degrade(w, { type: "capture_failed", call_id: W.LIVE_CALL, since: Date.now() })); // any later change keeps it away
    await expect(page.getByText("Slack is also playing audio")).toHaveCount(0);
  });

  test("UI — error path: System audio silent — Recording · mic only, announced once, Open System Settings…, the gap row", async ({ page }) => {
    const steer = await startLive(page, (w) => W.degrade(w, { type: "system_audio_silent", call_id: W.LIVE_CALL, since: Date.now(), confidence: 0.9 }));

    await expect(bannerSlot(page)).toContainText("System audio silent");
    await expect(word(page, "Recording · mic only")).toBeVisible();
    const said = (await sent(page, "window_announce")).filter((a) => (a as { text: string }).text.startsWith("System audio silent"));
    expect(said).toEqual([{ text: "System audio silent. Recording continues with your microphone.", politeness: "assertive" }]); // once
    await bannerSlot(page).getByRole("button", { name: "Open System Settings…" }).click();
    expect(await sent(page, "open_external")).toContainEqual({ target: { type: "system_settings", permission: "system_audio" } });

    await gapAt(steer, 1_802_000, 1_840_000, "system_audio_silent");
    await steer.change((w) => W.recover(w, "system_audio_silent")); // Noter ticked in the system audio list
    await expect(bannerSlot(page)).toHaveCount(0);
    await expect(word(page, "Recording")).toBeVisible();
    await expect(transcript(page)).toContainText("System audio silent 00:30:02–00:30:40");
    expect((await sent(page, "window_announce")).filter((a) => (a as { text: string }).text.startsWith("System audio silent"))).toHaveLength(1); // not again
  });

  test("UI — error path: Microphone off — Recording · no mic, Open System Settings…, the recording carries on", async ({ page }) => {
    await startLive(page, (w) => (W.permission(w, "microphone", "denied"), W.degrade(w, { type: "microphone_off", call_id: W.LIVE_CALL })));

    await expect(bannerSlot(page)).toContainText("Microphone off");
    await expect(word(page, "Recording · no mic")).toBeVisible();
    await bannerSlot(page).getByRole("button", { name: "Open System Settings…" }).click();
    expect(await sent(page, "open_external")).toContainEqual({ target: { type: "system_settings", permission: "microphone" } });
  });

  test("UI — error path: Engine stopped — Not recording, Try Again replaces Pause and Stop Recording and continues the same call", async ({ page }) => {
    await startLive(page, (w) => {
      w.app.capture.phase = "failed";
      W.degrade(w, { type: "capture_failed", call_id: W.LIVE_CALL, since: Date.now() });
    });

    await expect(bannerSlot(page)).toContainText("Not recording · engine stopped");
    await expect(word(page, "Not recording")).toBeVisible();
    await expect(button(page, "Pause")).toHaveCount(0);
    await expect(button(page, "Stop Recording")).toHaveCount(0);
    await bannerSlot(page).getByRole("button", { name: "Try Again" }).click();
    // The feature text says capture_continue, DESIGN-core and the contract test say capture_resume_interrupted.
    await expect.poll(async () => (await sent(page, "capture_continue")).length + (await sent(page, "capture_resume_interrupted")).length).toBe(1);
    await expect(bannerSlot(page)).toHaveCount(0);
    await expect(word(page, "Recording")).toBeVisible();
    await expect(button(page, "Stop Recording").or(page.getByRole("menuitem", { name: "Stop Recording" })).first()).toBeAttached();
  });

  test("UI — error path: Headphones connected — Microphone changed · 2 s lost is a row, never a banner", async ({ page }) => {
    const steer = await startLive(page, (w) => W.degrade(w, { type: "device_changed", call_id: W.LIVE_CALL, device_name: "AirPods Pro", gap_ms: 2000 }));

    await gapAt(steer, 1_420_000, 1_422_000, "device_changed");
    await expect(transcript(page)).toContainText("Microphone changed · 2 s lost");
    await expect(bannerSlot(page)).toHaveCount(0);
    await expect(word(page, "Recording")).toBeVisible();
  });

  test("UI — error path: Transcription stalled — the banner without an action, gone once lines come again", async ({ page }) => {
    const steer = await startLive(page, (w) => W.degrade(w, { type: "transcription_stalled", call_id: W.LIVE_CALL, since: Date.now() }));

    await expect(bannerSlot(page)).toContainText("Transcription stalled · restarting");
    await expect(bannerSlot(page).getByRole("button")).toHaveCount(0);
    await steer.change((w) => W.recover(w, "transcription_stalled"));
    await expect(bannerSlot(page)).toHaveCount(0);
  });

  test("UI — empty path: Nothing heard yet — the two meters, Keep Recording closes the notice", async ({ page }) => {
    await startLive(page, (w) => W.notice(w, { type: "nothing_heard", since: Date.now() - 5 * W.MIN }));
    const notice = noticeSlot(page);

    await expect(notice).toContainText("Nothing heard yet");
    await expect(notice).toContainText("You");
    await expect(notice).toContainText("Others");
    expect((await sent(page, "levels_subscribe")).length).toBeGreaterThan(0); // the meters
    await notice.getByRole("button", { name: "Keep Recording" }).click();
    expect(await sent(page, "capture_keep_recording")).toContainEqual(live);
    await expect(notice).toHaveCount(0);
  });

  test("UI — empty path: Nothing heard yet — Discard Recording asks inline, Back keeps it, Discard calls capture_discard", async ({ page }) => {
    await startLive(page, (w) => W.notice(w, { type: "nothing_heard", since: Date.now() - 5 * W.MIN }));
    const notice = noticeSlot(page);

    await notice.getByRole("button", { name: "Discard Recording" }).click();
    await expect(notice).toContainText("Discard this recording? This can't be undone.");
    await notice.getByRole("button", { name: "Back" }).click();
    expect(await sent(page, "capture_discard")).toHaveLength(0);
    await notice.getByRole("button", { name: "Discard Recording" }).click();
    await notice.getByRole("button", { name: "Discard", exact: true }).click();
    expect(await sent(page, "capture_discard")).toEqual([live]);
  });

  test("UI — error path: Disk nearly full — the warning with Delete Old Audio…, recording continues", async ({ page }) => {
    await startLive(page, (w) => {
      w.app.environment.disk_free_mb = 2_000;
      W.degrade(w, { type: "disk_low", free_mb: 2_000 });
    });

    await expect(bannerSlot(page)).toContainText("2 GB free on this Mac. Recording continues.");
    await bannerSlot(page).getByRole("button", { name: "Delete Old Audio…" }).click();
    expect((await sent(page, "window_navigate")).length).toBe(1); // the sheet opens in the main window (target: see doubts)
    await expect(word(page, "Recording")).toBeVisible();
  });
});

test.describe("cpt-noter-seq-call-screen-stop-at-call-end", () => {
  const ended = (w: Parameters<typeof W.idle>[0]) => W.notice(w, { type: "call_ended", stops_at: Date.now() + 10_000 });

  test("UI — happy path: The call seems to have ended — held while pointed at, Stop Now, the closing state, Open in Noter", async ({ page }) => {
    await startLive(page, ended);
    const notice = noticeSlot(page);

    await expect(notice).toContainText("The call seems to have ended");
    expect((await sent(page, "window_announce")).at(-1)).toMatchObject({ politeness: "assertive" });
    await notice.hover();
    await expect.poll(async () => await sent(page, "capture_hold_notice")).toContainEqual({ ...live, held: true });
    await expect(notice).toContainText("Paused while you're here");
    await transcript(page).hover(); // off the notice (it spans the top of the window)
    await expect.poll(async () => await sent(page, "capture_hold_notice")).toContainEqual({ ...live, held: false });

    await notice.getByRole("button", { name: "Stop Now" }).click();
    expect(await sent(page, "capture_answer_call_end")).toContainEqual({ ...live, choice: "stop_now" });
    await expect(page.getByText(/Saved · \d+ min · Summary in about 2 minutes/)).toBeVisible();
    for (const name of ["Continue Recording", "Open in Noter", "Close"]) await expect(button(page, name)).toBeVisible();
    await expect(page.getByText("The panel closes in 10 s. Continue Recording works for 5 minutes, also from the menu bar.")).toBeVisible();
    await expect(word(page, "Stopped")).toBeVisible();
    await expect(button(page, "Mark Moment")).toHaveCount(0); // the strip drops its buttons
    expect((await sent(page, "window_announce")).at(-1)).toMatchObject({ text: expect.stringMatching(/^Recording stopped, saved \d+ minutes$/) });

    await button(page, "Open in Noter").click();
    expect(await sent(page, "window_navigate")).toContainEqual({ target: { type: "call_page", call_id: W.LIVE_CALL, tab: "summary" } });
  });

  test("UI — other path: Keep Recording on the call-ended notice closes it and the recording goes on", async ({ page }) => {
    await startLive(page, ended);

    await noticeSlot(page).getByRole("button", { name: "Keep Recording" }).click();
    expect(await sent(page, "capture_answer_call_end")).toContainEqual({ ...live, choice: "keep_recording" });
    await expect(noticeSlot(page)).toHaveCount(0);
    await expect(word(page, "Recording")).toBeVisible();
  });

  test("UI — error path: Next meeting starts straight away — Start as New Call, the 1:1 header, a waiting transcript, the saved-and-started line", async ({ page }) => {
    await startLive(page, (w) =>
      W.notice(w, {
        type: "new_meeting",
        event: { id: "evt_anna", title: "1:1 with Anna K.", starts_at: Date.now(), ends_at: Date.now() + 30 * W.MIN },
        app_name: "Microsoft Teams",
        detected_at: Date.now() - 12_000,
        expires_at: Date.now() + 60_000,
        default_choice: "start_as_new_call",
      }),
    );

    await expect(noticeSlot(page)).toContainText("A new meeting may have started: 1:1 with Anna K.");
    await noticeSlot(page).getByRole("button", { name: "Start as New Call" }).click();
    expect(await sent(page, "capture_answer_new_meeting")).toContainEqual({ ...live, choice: "start_as_new_call" });
    await expect(header(page).getByRole("heading", { name: "1:1 with Anna K." })).toBeVisible();
    await expect(transcript(page)).toContainText("Waiting for speech…");
    await expect(strip(page)).toContainText("Saved “Planning: VHI 8.0 drawer redesign” · started “1:1 with Anna K.”");
    await expect(noticeSlot(page)).toHaveCount(0);
  });

  test("UI — error path: Stopped by mistake — Stop Recording, then Continue Recording records the same call again", async ({ page }) => {
    await startLive(page);

    await button(page, "Stop Recording").click();
    expect(await sent(page, "capture_stop")).toContainEqual(live);
    await expect(page.getByText(/Saved · \d+ min/)).toBeVisible();
    await button(page, "Continue Recording").click();
    expect(await sent(page, "capture_continue")).toContainEqual(live);
    await expect(word(page, "Recording")).toBeVisible();
    await expect(button(page, "Mark Moment")).toBeVisible();
  });

  test("UI — empty path: No answer to the notice — Stopped at hh:mm · the call had ended · N min saved, Continue Recording and Open in Noter", async ({ page }) => {
    await startLive(page, (w) =>
      Object.assign(w.app.capture, { phase: "stopped", notice: { type: "stopped_automatically", call_id: W.LIVE_CALL }, continue_until: Date.now() + 5 * W.MIN }),
    );

    await expect(page.getByText(/Stopped at \d\d:\d\d · the call had ended · \d+ min saved/)).toBeVisible();
    await expect(button(page, "Open in Noter")).toBeVisible();
    await expect(button(page, "Close")).toHaveCount(0); // only after a manual stop
    await button(page, "Continue Recording").click();
    expect(await sent(page, "capture_continue")).toContainEqual(live);
  });

  test("UI — error path: Continue Recording after five minutes — the button disappears", async ({ page }) => {
    const steer = await startLive(page, (w) => Object.assign(w.app.capture, { phase: "stopped", continue_until: Date.now() + 5 * W.MIN }));

    await steer.failNext("capture_continue", "continue_window_closed");
    await button(page, "Continue Recording").click();
    await expect(button(page, "Continue Recording")).toHaveCount(0);
    await expect(button(page, "Open in Noter")).toBeVisible();
  });
});

test.describe("cpt-noter-seq-call-screen-hide-for-presenting", () => {
  test("UI — happy path: Hide Noter for Presenting sends the wanted state, the window keeps its state for the return", async ({ page }) => {
    const steer = await startLive(page, still);
    const before = await transcript(page).innerText();

    await header(page).getByRole("button", { name: "Hide Noter for Presenting" }).click();
    expect(await sent(page, "app_set_hidden_for_presenting")).toContainEqual({ hidden: true });
    await steer.change((w) => (w.app.presenting.hidden = true)); // the core hides every surface and sends app:presenting
    await steer.change((w) => (w.app.presenting.hidden = false)); // ⌃⌥⌘0 or Show Noter
    await expect(transcript(page)).toHaveText(before, { useInnerText: true });
    await expect(word(page, "Recording")).toBeVisible();
  });

  test("UI — other path: Share warning in the floating panel — shown the first time, Got It closes it, the share glyph stays", async ({ page }) => {
    await startLive(page);
    await toFloating(page);
    await coreWindow(page, { layout: "floating", show_share_warning: true });
    const warning = page.locator('[data-region="FP-R3"]').filter({ hasText: "Hidden from window shares only. Before sharing your whole screen, press" });

    await expect(warning).toContainText("⌃⌥⌘0");
    await warning.getByRole("button", { name: "Got It" }).click();
    await expect(warning).toHaveCount(0);
    await coreWindow(page, { show_share_warning: false });
    const glyph = header(page).getByRole("img", { name: "Hidden from window shares" });
    await expect(glyph).toHaveAttribute("title", "Hidden from Teams, Meet and window-filtered Zoom shares. Share a window, not a display.");
  });
});

test.describe("cpt-noter-seq-floating-panel-display-unplugged", () => {
  test("UI — happy path: the display is unplugged — the same call goes on in the floating panel with the transcript tail where it was", async ({ page }) => {
    const steer = await startLive(page);
    await expect(dedicated(page)).toBeVisible();
    const tail = (await transcript(page).innerText()).trim().split("\n").at(-1)!;
    const loads = (await calls(page)).filter((c) => c.name === "app_snapshot").length;

    await steer.change(W.laptopOnly);
    await coreWindow(page, { layout: "floating" });
    await expect(floating(page)).toBeVisible();
    await expect(dedicated(page)).toHaveCount(0);
    await expect(header(page)).toContainText(W.LIVE_TITLE);
    await expect(transcript(page)).toContainText(tail);
    await expect(word(page, "Recording")).toBeVisible();
    expect((await calls(page)).filter((c) => c.name === "app_snapshot").length).toBe(loads); // nothing reloaded
  });

  test("UI — empty path: Display connected again — the call screen returns while the call goes on", async ({ page }) => {
    const steer = await startLive(page, W.laptopOnly);
    await coreWindow(page, { layout: "floating" });
    await expect(floating(page)).toBeVisible();

    await steer.change((w) => {
      w.app.environment.displays.push({ id: W.STUDIO_DISPLAY, name: "Studio Display", is_main: false, holds_call_app: false, width_pt: 2560, height_pt: 1440 });
    });
    await coreWindow(page, { layout: "dedicated" });
    await expect(dedicated(page)).toBeVisible();
    await expect(header(page)).toContainText(W.LIVE_TITLE);
  });

  test("UI — other path: by hand — ⋯ › Use Floating Panel, then Move to Display 2 and ⋯ › Open Call Screen on Display 2", async ({ page }) => {
    await startLive(page);

    await toFloating(page);
    expect(await sent(page, "window_set_call_layout")).toContainEqual({ preference: "floating" });
    await expect(floating(page)).toBeVisible();
    await header(page).getByRole("button", { name: "Move to Display 2" }).click();
    expect((await sent(page, "window_set_call_layout")).at(-1)).toEqual({ preference: "auto" });
    await expect(dedicated(page)).toBeVisible();
    await toFloating(page);
    await more(page, "Open Call Screen on Display 2");
    await expect(dedicated(page)).toBeVisible();
  });
});

test.describe("cpt-noter-seq-floating-panel-collapse-strip", () => {
  test("UI — happy path: Collapse Panel to one line with the dot and clock, Expand Panel brings the panel back", async ({ page }) => {
    await startLive(page);
    await toFloating(page);

    await header(page).getByRole("button", { name: "Collapse Panel" }).click();
    expect(await sent(page, "window_set_collapsed")).toContainEqual({ collapsed: true });
    const c1 = page.locator('[data-region="FP-C1"]');
    await expect(c1).toContainText(/\d\d:\d\d:\d\d/);
    await expect(c1.getByRole("img", { name: "Recording" })).toBeVisible();
    await expect(page.locator('[data-region="FP-C2"]')).toHaveCount(0); // copilot off: no card area
    await expect(page.locator('[data-region="FP-C3"]').getByText(/^\d+$/)).toHaveCount(0); // and no count badge

    await page.locator('[data-region="FP-C3"]').getByRole("button", { name: "Expand Panel" }).click();
    expect((await sent(page, "window_set_collapsed")).at(-1)).toEqual({ collapsed: false });
    await expect(floating(page)).toBeVisible();
    await header(page).dblclick(); // a double-click on the header collapses too
    await expect(page.locator('[data-region="FP-C1"]')).toBeVisible();
  });

  test("UI — error path: Paused — the strip clock reads Paused 3 min", async ({ page }) => {
    await startLive(page, (w) => Object.assign(w.app.capture, { phase: "paused", pause: { since: Date.now() - 3 * W.MIN, remind_at: Date.now() + 2 * W.MIN } }));
    await toFloating(page);

    await header(page).getByRole("button", { name: "Collapse Panel" }).click();
    await expect(page.locator('[data-region="FP-C1"]')).toContainText("Paused 3 min");
  });

  test("UI — error path: Capture notice while collapsed — the strip expands for it and is a line again after the choice", async ({ page }) => {
    const steer = await startLive(page);
    await toFloating(page);
    await header(page).getByRole("button", { name: "Collapse Panel" }).click();
    await expect(page.locator('[data-region="FP-C1"]')).toBeVisible();

    await steer.change((w) => W.notice(w, { type: "call_ended", stops_at: Date.now() + 10_000 }));
    await coreWindow(page, { collapsed: false });
    await expect(page.locator('[data-region="FP-R0"]')).toContainText("The call seems to have ended");
    await page.locator('[data-region="FP-R0"]').getByRole("button", { name: "Keep Recording" }).click();
    await coreWindow(page, { collapsed: true });
    await expect(page.locator('[data-region="FP-C1"]')).toBeVisible();
    await expect(page.locator('[data-region="FP-R0"]')).toHaveCount(0);
  });
});

test.describe("cpt-noter-seq-floating-panel-hide-and-reopen", () => {
  test("UI — happy path: Hide (Hide to the menu bar) — recording goes on, the panel comes back as it was", async ({ page }) => {
    await startLive(page, still);
    await toFloating(page);
    const before = await transcript(page).innerText();

    const hide = header(page).getByRole("button", { name: "Hide", exact: true });
    await expect(hide).toHaveAttribute("title", "Hide to the menu bar");
    await hide.click();
    expect(await sent(page, "window_hide_call")).toHaveLength(1);
    await coreWindow(page, { visible: false });
    await coreWindow(page, { visible: true }); // ⌃⌥⌘N or Open Call Screen: the core shows it, not key
    await expect(floating(page)).toBeVisible();
    // the real core keeps transcribing, so its tail moves on; the fake's stays as it was
    if (FAKE) await expect(transcript(page)).toHaveText(before, { useInnerText: true });
    else await expect(transcript(page)).not.toBeEmpty();
    await expect(word(page, "Recording")).toBeVisible();
  });

  test("UI — error path: Panel closed by a crash — a new WebView opens with snapshot, window state, then the transcript", async ({ page }) => {
    await startLive(page);
    await expect(transcript(page)).not.toBeEmpty();
    const title = await header(page).innerText();

    await page.reload(); // the crashed WebView is recreated
    await expect(header(page)).toHaveText(title);
    const order = (await calls(page)).filter((c) => c.kind === "invoke").map((c) => c.name);
    expect(order.indexOf("app_snapshot")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("window_call_state")).toBeGreaterThan(order.indexOf("app_snapshot"));
    expect(order.indexOf("transcript_subscribe")).toBeGreaterThan(order.indexOf("window_call_state"));
    await expect(word(page, "Recording")).toBeVisible();
  });
});

test.describe("cpt-noter-flow-ui-call-window-controls", () => {
  test("UI — happy path: Mark Moment reads Marked 00:23:00 for 2 s", async ({ page }) => {
    await startLive(page);

    await button(page, "Mark Moment").click();
    expect(await sent(page, "capture_mark_moment")).toContainEqual(expect.objectContaining(live));
    await expect(page.getByRole("button", { name: /Marked \d\d:\d\d:\d\d/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Marked \d\d:\d\d:\d\d/ })).toHaveCount(0, { timeout: 4_000 });
  });

  test("UI — happy path: Pause, then Resume becomes primary and the indicator says Paused; Resume sends the wanted state", async ({ page }) => {
    await startLive(page);

    await button(page, "Pause").click();
    expect(await sent(page, "capture_set_paused")).toContainEqual({ ...live, paused: true });
    await expect(word(page, "Paused")).toBeVisible();
    await expect(button(page, "Pause")).toHaveCount(0);
    await button(page, "Resume").click();
    expect((await sent(page, "capture_set_paused")).at(-1)).toEqual({ ...live, paused: false });
    await expect(word(page, "Recording")).toBeVisible();
    expect((await sent(page, "window_announce")).map((a) => (a as { text: string }).text)).toEqual(expect.arrayContaining(["Paused", "Resumed"]));
  });

  test("UI — other path: ⋯ › Make This Call Sensitive — the line, Sensitive · local, the item disabled; ⋯ › Open in Noter", async ({ page }) => {
    await startLive(page);

    await more(page, "Make This Call Sensitive");
    expect(await sent(page, "capture_set_sensitive")).toContainEqual({ ...live, sensitive: true });
    await expect(page.getByText("From now on, nothing from this call leaves this Mac.")).toBeVisible();
    await expect(page.getByText("Sensitive · local").first()).toBeVisible();
    await header(page).getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Make This Call Sensitive" })).toBeDisabled();
    await page.getByRole("menuitem", { name: "Open in Noter" }).click();
    expect(await sent(page, "window_navigate")).toContainEqual({ target: { type: "call_page", call_id: W.LIVE_CALL, tab: expect.anything() } });
  });

  test("UI — error path: A command fails — the button leaves its loading state and the strip shows the error", async ({ page }) => {
    const steer = await startLive(page);

    await steer.failNext("capture_set_paused", "internal");
    await button(page, "Pause").click();
    await expect(button(page, "Pause")).toBeEnabled();
    await expect(strip(page).getByRole("alert").or(strip(page).getByRole("status"))).toBeVisible();
    await expect(word(page, "Recording")).toBeVisible();
  });

  test("UI — empty path: the header shows a person chip per participant, You and the unnamed Speaker 3 included", async ({ page }) => {
    await startLive(page);
    const chips = page.locator('[data-region="CS-R1"] [data-component="cpt-noter-component-ui-person-chip"]');

    await expect(chips.filter({ hasText: "You" })).toHaveCount(1);
    await expect(chips.filter({ hasText: "Speaker 3" })).toHaveCount(1);
    await expect(chips.filter({ hasText: "Anna K." })).toHaveCount(1);
  });
});
