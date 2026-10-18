// M1 — Menu bar extra (DESIGN.md 3.6, stories-a). One test per story path.
// The menu itself is native (NSStatusItem): its rendering, glyphs and the quit alert are
// XCUITest's (`test_cpt_noter_seq_menu_bar_…`, docs/TEST-PLAN.md). Here each menu action is
// the command the core runs for it, sent from the window that may send it (the menu's own
// calls are `Caller::Native`), and each line of the menu is checked in the state it renders from.
import { ahead, ok, refused, until } from "../support/results";
import * as W from "../support/world-presets";
import { changeAhead, expect, given, test } from "./support/fixtures";

test.describe("cpt-noter-seq-menu-bar-control-recording", () => {
  test("happy path: Mark Moment, Pause, Resume, Stop Recording, with Continue Recording for 5 minutes", async ({ scenario }) => {
    const main = scenario.core("main");
    const screen = scenario.core("call-screen");
    const captures = await scenario.events("capture:state");

    const mark = ahead(await screen.captureMarkMoment({ call_id: W.LIVE_CALL })); // Mark Moment
    if (!mark) return; // capture_mark_moment (M1); the live call the menu shows is M1 state too
    const top = ok(await main.appSnapshot({})).capture;
    expect(top).toMatchObject({ phase: "recording", title: W.LIVE_TITLE }); // Recording · Planning: VHI 8.0 drawer redesign · 23:14
    expect(mark).toMatchObject({ call_id: W.LIVE_CALL });
    const paused = ahead(await main.captureSetPaused({ call_id: W.LIVE_CALL, paused: true }));
    if (!paused) return; // capture_set_paused (M1)
    expect(paused.phase).toBe("paused"); // icon in its paused form
    expect(ok(await main.captureSetPaused({ call_id: W.LIVE_CALL, paused: true })).phase).toBe("paused"); // wanted state: repeating is harmless
    expect(ok(await main.captureSetPaused({ call_id: W.LIVE_CALL, paused: false })).phase).toBe("recording"); // Resume
    const stopped = ahead(await main.captureStop({ call_id: W.LIVE_CALL })); // Stop Recording
    if (!stopped) return; // capture_stop (M1)
    expect(stopped.phase).toBe("stopped");
    expect(stopped.continue_until! - Date.now()).toBeGreaterThan(4 * W.MIN); // Saved · … with Continue Recording
    expect(refused(await screen.captureMarkMoment({ call_id: W.LIVE_CALL })).code).toBe("not_recording");
    await until(() => captures.latest()?.phase === "stopped", "capture:state stopped");
    expect(captures.all.map((c) => c.phase)).toEqual(expect.arrayContaining(["paused", "recording", "stopped"]));
  });

  test("error path — Paused for 5 minutes: Paused for 5 min at the top, Resume, the pause marked as a gap", async ({ scenario }) => {
    const main = scenario.core("main");
    const paused = ahead(await main.captureSetPaused({ call_id: W.LIVE_CALL, paused: true }));
    if (!paused) return; // capture_set_paused (M1)
    expect(paused.pause).not.toBeNull();
    expect(paused.pause!.remind_at! - paused.pause!.since).toBe(5 * W.MIN); // Paused for 5 min reminder
    const resumed = ok(await main.captureSetPaused({ call_id: W.LIVE_CALL, paused: false })); // Resume
    expect(resumed).toMatchObject({ phase: "recording", pause: null });
  });

  test("error path — Quit while recording: Stop and Quit stops and saves the recording first", async ({ scenario }) => {
    const main = scenario.core("main");
    // The alert and the quit are native (XCUITest); Stop and Quit stops the call before the core shuts down.
    const stopped = ahead(await main.captureStop({ call_id: W.LIVE_CALL }));
    if (!stopped) return; // capture_stop (M1)
    expect(stopped).toMatchObject({ phase: "stopped", call_id: W.LIVE_CALL }); // the transcript so far is kept
    const call = ahead(await main.callGet({ call_id: W.LIVE_CALL }));
    if (call) expect(call.call.id).toBe(W.LIVE_CALL); // call_get (M1)
    ok(await main.logUi({ level: "info", screen: "menu_bar", message: "quit after stop" }));
  });
});

test.describe("cpt-noter-seq-menu-bar-check-state", () => {
  test("happy path: recording form, the call, its speakers, languages and where text may go", async ({ scenario }) => {
    const main = scenario.core("main");
    const detail = ahead(await main.callGet({ call_id: W.LIVE_CALL }));
    if (detail) {
      // call_get (M1): the live call, its speakers and the recording form are M1 state
      const snap = ok(await main.appSnapshot({}));
      expect(snap.capture).toMatchObject({ phase: "recording", title: W.LIVE_TITLE });
      expect(snap.privacy.effective).toBe("cloud_redacted"); // Cloud, redacted
      expect(detail.speakers.length).toBeGreaterThanOrEqual(4); // 4 speakers
      expect(detail.call.languages.length).toBeGreaterThan(0); // EN / RU
    }
    // Each action with its hotkey: the menu reads the same bindings as Settings › Hotkeys.
    const keys = ok(await scenario.core("settings").hotkeysList({}));
    expect(keys.bindings.find((b) => b.action === "start_stop")?.shortcut).toBe("Ctrl+Alt+Super+R");
    expect(keys.bindings.find((b) => b.action === "pause")?.shortcut).toBe("Ctrl+Alt+Super+P");
  });

  test("empty path — Not recording: Noter — Not recording with Start Recording ⌃⌥⌘R", async ({ scenario }) => {
    await given(scenario, W.idle);
    const snap = ok(await scenario.core("main").appSnapshot({}));
    expect(snap.capture).toMatchObject({ phase: "idle", call_id: null });
    expect(snap.detection.detection).toBeNull();
    const calls = ahead(await scenario.core("main").callsList({ filter: {}, sort: "newest", page: {} }));
    if (calls) expect(calls.rows.length).toBeGreaterThan(0); // calls_list (M1)
  });

  test("error path — Switched to local: the line under the call, recording still running on the local model", async ({ scenario }) => {
    const local = await changeAhead(scenario, "M1", (w) => {
      W.degrade(w, { type: "switched_to_local", call_id: W.LIVE_CALL, reason: "offline", retry_at: null });
      w.app.privacy.effective = "switched_to_local";
    });
    if (!local) return; // degraded and privacy (M1)
    const snap = ok(await scenario.core("main").appSnapshot({}));
    expect(snap.degraded.states.some((d) => d.type === "switched_to_local")).toBe(true);
    expect(snap.privacy.effective).toBe("switched_to_local");
    expect(snap.capture.phase).toBe("recording");
  });

  test("error path — Setup incomplete: Finish Setup… opens first run at Permissions, Run Test turns detection on", async ({ scenario }) => {
    await given(scenario, W.idle, W.selfTestSkipped);
    const main = scenario.core("main");
    const nav = await scenario.events("nav:request");
    expect(ok(await main.appSnapshot({})).setup.detection_enabled).toBe(false); // Setup incomplete · call detection off

    if (ahead(await main.windowNavigate({ target: { type: "first_run", step: "permissions" } }))) {
      await until(() => nav.latest(), "the first-run window opens"); // Finish Setup… (window_navigate, M1)
      expect(nav.latest()).toEqual({ type: "first_run", step: "permissions" });
    }
    let passed = false;
    ok(await scenario.core("first-run").selfTestRun({ play_clip: false }, (m) => (passed ||= m.event.type === "passed")));
    await until(() => passed, "Self-test passed");
    await until(async () => ok(await main.setupStatus({})).detection_enabled, "call detection on");
  });

  test("other path — New meeting while hidden: Start as New Call from the menu, nothing on the shared screen", async ({ scenario }) => {
    const screen = scenario.core("call-screen");
    if (!ahead(await screen.appSetHiddenForPresenting({ hidden: true }))) return; // app_set_hidden_for_presenting (M1)
    const notified = await changeAhead(scenario, "M1", (w) =>
      W.notice(w, {
        type: "new_meeting",
        event: { id: "evt_anna", title: "1:1 with Anna K.", starts_at: Date.now(), ends_at: Date.now() + 30 * W.MIN },
        app_name: null,
        detected_at: Date.now(),
        expires_at: Date.now() + 60_000,
        default_choice: "start_as_new_call",
      }),
    );
    if (!notified) return; // capture notice (M1)
    expect(ok(await scenario.core("main").appSnapshot({})).capture.notice?.type).toBe("new_meeting");
    const next = ahead(await screen.captureAnswerNewMeeting({ call_id: W.LIVE_CALL, choice: "start_as_new_call" }));
    if (!next) return; // capture_answer_new_meeting (M1)
    expect(next).toMatchObject({ phase: "recording", title: "1:1 with Anna K." });
    expect(ok(await scenario.core("main").appSnapshot({})).presenting.hidden).toBe(true);
  });
});
