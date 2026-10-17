// M1 — Floating panel (DESIGN.md 3.6, stories-a). One test per story path.
// `cpt-noter-seq-floating-panel-display-unplugged` is one of the five critical stories.
// Contract-level today: layout, collapse and visibility of the call window as the core
// reports them (`window:call`). Panel placement, snapping, focus and the NSPanel itself are
// XCUITest's; card steps use the M4 copilot commands through `ahead` (docs/TEST-PLAN.md).
import type { CallWindowState, TranscriptMsg } from "../../src/core/bindings";
import { ahead, ok, until } from "../support/results";
import * as W from "../support/world-presets";
import { expect, given, test, versionsGrow } from "./support/fixtures";

test.describe("cpt-noter-seq-floating-panel-display-unplugged", () => {
  test("happy path: unplug the display, the same call goes on in the floating panel, ⌃⌥⌘2 pins card 2", async ({ scenario }) => {
    const screen = scenario.core("call-screen");
    const windows = await scenario.events("window:call");
    const before = ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));
    expect(ok(await screen.windowCallState({})).layout).toBe("dedicated");

    await scenario.change(W.laptopOnly); // the external display is unplugged
    // The core re-evaluates the layout on a display change; re-sending the saved preference
    // (wanted state, harmless to repeat) makes the fake do the same.
    const panel = ok(await screen.windowSetCallLayout({ preference: "auto" }));
    expect(panel.layout).toBe("floating");
    await until(() => windows.latest()?.layout === "floating", "window:call floating");
    expect(versionsGrow(windows.all)).toBe(true);

    const after = ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));
    expect(after.segments.slice(0, before.segments.length).map((s) => s.id)).toEqual(before.segments.map((s) => s.id)); // transcript tail where it was
    expect(ok(await screen.appSnapshot({})).capture).toMatchObject({ phase: "recording", call_id: W.LIVE_CALL });

    const cards = ahead(await screen.cardsSubscribe({ call_id: W.LIVE_CALL }, () => {})); // the same cards, same numbers
    const two = cards?.visible.find((c) => c.number === 2);
    if (two) expect(ahead(await screen.cardPin({ card_id: two.id }))?.card.state).toBe("pinned"); // ⌃⌥⌘2
  });

  test("empty path — Display connected again: the panel closes, the call screen fills the external display", async ({ scenario }) => {
    await given(scenario, W.laptopOnly);
    const screen = scenario.core("call-screen");
    expect(ok(await screen.windowSetCallLayout({ preference: "auto" })).layout).toBe("floating");

    await scenario.change((w) => {
      w.app.environment.displays.push({ id: W.STUDIO_DISPLAY, name: "Studio Display", is_main: false, holds_call_app: false, width_pt: 2560, height_pt: 1440 });
    });
    const dedicated = ok(await screen.windowSetCallLayout({ preference: "auto" }));
    expect(dedicated.layout).toBe("dedicated");
    expect(ok(await screen.appSnapshot({})).capture.call_id).toBe(W.LIVE_CALL); // the same call
  });

  test("error path — Panel would land off screen: the panel stays on the laptop screen, beside the call app", async ({ scenario }) => {
    await given(scenario, W.laptopOnly);
    const screen = scenario.core("call-screen");
    const panel: CallWindowState = ok(await screen.windowSetCallLayout({ preference: "auto" }));
    expect(panel.layout).toBe("floating");
    const laptop = ok(await screen.appSnapshot({})).environment.displays;
    expect(laptop.map((d) => d.id)).toEqual([W.BUILTIN_DISPLAY]); // the only screen the panel can be placed on
    expect(ok(await screen.windowShowCall({})).visible).toBe(true);
  });

  test("error path — Chosen display not connected: the call opens in the floating panel; the choice is kept", async ({ scenario }) => {
    await given(scenario, W.idle, W.laptopOnly);
    const settings = scenario.core("settings");
    const current = ok(await settings.settingsGet({}));
    expect(current.call_screen.display_id).toBe(W.STUDIO_DISPLAY); // LG UltraFine / Studio Display (not connected)

    const screen = scenario.core("call-screen");
    expect(ok(await screen.captureStart({ source: "hotkey", sensitive: false })).phase).toBe("recording"); // at home
    expect(ok(await screen.windowSetCallLayout({ preference: "auto" })).layout).toBe("floating");
    expect(ok(await settings.settingsGet({})).call_screen.display_id).toBe(W.STUDIO_DISPLAY); // used whenever it is connected
  });
});

test.describe("cpt-noter-seq-floating-panel-collapse-strip", () => {
  test("happy path: Collapse Panel to one line, the recording keeps going, Expand Panel restores it", async ({ scenario }) => {
    await given(scenario, W.laptopOnly);
    const screen = scenario.core("call-screen");
    const windows = await scenario.events("window:call");
    ok(await screen.windowSetCallLayout({ preference: "floating" }));

    expect(ok(await screen.windowSetCollapsed({ collapsed: true })).collapsed).toBe(true);
    await until(() => windows.latest()?.collapsed === true, "window:call collapsed");
    const got: TranscriptMsg[] = [];
    ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, (m) => got.push(m)));
    await until(() => got.length > 0, "the strip keeps receiving while collapsed");
    expect(ok(await screen.windowCallState({})).collapsed).toBe(true); // the strip keeps its size

    const expanded = ok(await screen.windowSetCollapsed({ collapsed: false })); // Expand Panel
    expect(expanded).toMatchObject({ collapsed: false, layout: "floating" }); // same snapped edge, same layout
    expect(versionsGrow(windows.all)).toBe(true);
  });

  test("other path — Pin from the strip: Pin on the newest card, the strip stays collapsed", async ({ scenario }) => {
    await given(scenario, W.laptopOnly);
    const screen = scenario.core("call-screen");
    ok(await screen.windowSetCollapsed({ collapsed: true }));
    const cards = ahead(await screen.cardsSubscribe({ call_id: W.LIVE_CALL }, () => {}));
    const newest = cards?.visible.at(-1);
    if (newest) expect(ahead(await screen.cardPin({ card_id: newest.id }))?.card.state).toBe("pinned");
    expect(ok(await screen.windowCallState({})).collapsed).toBe(true); // without the strip expanding
  });

  test("error path — Capture notice while collapsed: The call seems to have ended, Keep Recording, back to one line", async ({ scenario }) => {
    await given(scenario, W.laptopOnly);
    const screen = scenario.core("call-screen");
    ok(await screen.windowSetCollapsed({ collapsed: true }));
    await scenario.change((w) => W.notice(w, { type: "call_ended", stops_at: Date.now() + 10_000 }));

    expect(ok(await screen.appSnapshot({})).capture.notice?.type).toBe("call_ended"); // the strip expands for the notice
    const kept = ok(await screen.captureAnswerCallEnd({ call_id: W.LIVE_CALL, choice: "keep_recording" }));
    expect(kept).toMatchObject({ phase: "recording", notice: null });
    expect(ok(await screen.windowSetCollapsed({ collapsed: true })).collapsed).toBe(true); // back to one line
  });

  test("empty path — Copilot muted while collapsed: Copilot muted in the strip, recording dot and clock still in view", async ({ scenario }) => {
    await given(scenario, W.laptopOnly);
    const screen = scenario.core("call-screen");
    ok(await screen.windowSetCollapsed({ collapsed: true }));
    const muted = ahead(await screen.copilotMute({ call_id: W.LIVE_CALL, scope: { type: "for_minutes", minutes: 15 } })); // ⌃⌥⌘K (M4 command)
    if (muted) expect(muted.muted).not.toBeNull();
    const snap = ok(await screen.appSnapshot({}));
    expect(snap.capture.phase).toBe("recording");
    expect(ok(await screen.windowCallState({})).collapsed).toBe(true);
  });
});

test.describe("cpt-noter-seq-floating-panel-hide-and-reopen", () => {
  test("happy path: Hide to the menu bar, recording goes on, ⌃⌥⌘N brings the panel back as it was", async ({ scenario }) => {
    await given(scenario, W.laptopOnly);
    const screen = scenario.core("call-screen");
    const before = ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));

    expect(ok(await screen.windowHideCall({})).visible).toBe(false); // Hide
    expect(ok(await scenario.core("main").appSnapshot({})).capture.phase).toBe("recording"); // menu bar icon still recording
    const back = ok(await screen.windowShowCall({})); // ⌃⌥⌘N or Open Call Screen
    expect(back.visible).toBe(true);
    const after = ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));
    expect(after.last_seq).toBeGreaterThanOrEqual(before.last_seq); // cards and transcript where they were
  });

  test("error path — Capture problem while hidden: System audio silent, the notification opens the call window with the fix", async ({ scenario }) => {
    await given(scenario, W.laptopOnly);
    const screen = scenario.core("call-screen");
    ok(await screen.windowHideCall({}));
    await scenario.change((w) => W.degrade(w, { type: "system_audio_silent", call_id: W.LIVE_CALL, since: Date.now(), confidence: 0.8 }));

    expect(ok(await scenario.core("main").windowShowCall({})).visible).toBe(true); // clicking the notification
    const snap = ok(await screen.appSnapshot({}));
    expect(snap.degraded.states.some((d) => d.type === "system_audio_silent")).toBe(true); // Open System Settings… at the top
    ok(await screen.openExternal({ target: { type: "system_settings", permission: "system_audio" } }));
  });

  test("error path — Panel closed by a crash: the menu bar still shows recording, ⌃⌥⌘N reopens it with the same transcript", async ({ scenario }) => {
    await given(scenario, W.laptopOnly);
    const before = ok(await scenario.core("call-screen").transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));

    const reopened = scenario.reopen("call-screen"); // the WebView crashed; a new one loads
    const snap = ok(await reopened.appSnapshot({})); // snapshot after a crash
    expect(snap.capture).toMatchObject({ phase: "recording", call_id: W.LIVE_CALL });
    expect(ok(await reopened.windowShowCall({})).visible).toBe(true);
    const after = ok(await reopened.transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));
    expect(after.segments.map((s) => s.id)).toEqual(expect.arrayContaining(before.segments.map((s) => s.id))); // same transcript and marks
    expect(after.marks.map((m) => m.id)).toEqual(expect.arrayContaining(before.marks.map((m) => m.id)));
  });
});
