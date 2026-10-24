// M1 call-window stories against the real core (Backend Teamlead TL-7, HoD D-26): each test
// names its DESIGN.md story and asserts the core-visible steps — state, events and rows — not
// only a command result. What the core asked of the native layer is read from the harness's
// scripted `Surfaces` log (`Scenario.surfaces()`); the panel itself, focus and snapping are
// XCUITest's. On the fake there is no log, so those lines are checked on the real core only.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { exercised } from "../support/core";
import { ok, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import * as W from "../support/world-presets";

let s: Scenario;
beforeEach(() => {
  s = openScenario({ alsoRecord: exercised });
});
afterEach(async () => {
  await s.dispose();
});

const growing = (versions: number[]) => versions.every((v, i) => i === 0 || v > versions[i - 1]);
const real = () => s.target !== "fake";
/** What the core asked of the native layer so far (empty on the fake). */
const asked = async () => (await s.surfaces()) ?? [];
const phase = async () => ok(await s.core("main").appSnapshot({})).capture.phase;

describe("cpt-noter-seq-call-screen-hide-for-presenting", () => {
  it("happy path: hiding for presenting hides every surface, recording goes on, showing restores exactly the open windows", async () => {
    const screen = s.core("call-screen");
    const presenting = await s.events("app:presenting");
    ok(await screen.windowShowCall({})); // the call window is open
    const before = ok(await screen.windowCallState({}));
    expect(before.visible).toBe(true);
    const hidden = ok(await screen.appSetHiddenForPresenting({ hidden: true }));
    expect(hidden.hidden).toBe(true);
    await until(() => presenting.latest()?.hidden === true, "app:presenting hidden");
    if (real()) expect(await asked()).toContain("hide_all");
    expect(ok(await screen.appSnapshot({})).presenting.hidden).toBe(true);
    expect(await phase()).toBe("recording"); // capture, transcript and the menu keep running
    if (real()) expect(ok(await screen.windowCallState({})).visible).toBe(false);

    expect(ok(await screen.appSetHiddenForPresenting({ hidden: false })).hidden).toBe(false);
    await until(() => presenting.latest()?.hidden === false, "app:presenting shown");
    if (real()) expect(await asked()).toContain("restore_all");
    expect(ok(await screen.windowCallState({})).visible).toBe(before.visible); // exactly the windows that were open
    expect(growing(presenting.all.map((p) => p.version))).toBe(true);
  });

  it("empty path — call detected while hidden: nothing is drawn until Show Noter, the menu starts the recording", async () => {
    await s.change((w) => {
      W.idle(w);
      w.app.setup.self_test = { type: "passed", at: Date.now() }; // call detection is on
      w.app.setup.detection_enabled = true;
    });
    const main = s.core("main");
    ok(await main.appSetHiddenForPresenting({ hidden: true }));
    const shownBefore = (await asked()).filter((c) => c === "show_record_prompt").length;
    if (real()) {
      // the engine hears the call app (detection is the core's, not the world's)
      for (let i = 0; i < 100 && !(await s.engineFact({ type: "call_detected", bundle_id: "com.microsoft.teams2", app_name: "Microsoft Teams", pid: 4242 })); i++) await new Promise((r) => setTimeout(r, 20));
      await until(async () => ok(await main.appSnapshot({})).detection.detection, "detection");
    } else await s.change((w) => W.detect(w, W.APPS.teams));
    expect(ok(await main.appSnapshot({})).detection.detection?.app_name).toBe("Microsoft Teams");
    if (real()) expect((await asked()).filter((c) => c === "show_record_prompt").length).toBe(shownBefore); // no prompt while hidden
    expect(ok(await main.captureStart({ source: "menu_bar", sensitive: false })).phase).toBe("recording");
    expect(ok(await main.appSnapshot({})).presenting.hidden).toBe(true);
    expect(ok(await main.appSetHiddenForPresenting({ hidden: false })).hidden).toBe(false);
  });
});

describe("cpt-noter-seq-floating-panel-collapse-strip", () => {
  it("happy path: Collapse Panel to one line keeps the recording and the stream, Expand Panel restores it", async () => {
    await s.change(W.laptopOnly);
    const screen = s.core("call-screen");
    const windows = await s.events("window:call");
    expect(ok(await screen.windowSetCallLayout({ preference: "floating" })).layout).toBe("floating");
    expect(ok(await screen.windowShowCall({})).visible).toBe(true);

    const collapsed = ok(await screen.windowSetCollapsed({ collapsed: true }));
    expect(collapsed.collapsed).toBe(true);
    await until(() => windows.latest()?.collapsed === true, "window:call collapsed");
    if (real()) expect((await asked()).some((c) => c.startsWith("place_call_window") && c.endsWith("collapsed=true"))).toBe(true);
    const got: { seq: number }[] = [];
    const snap = ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, (m) => got.push(m)));
    await until(() => got.length > 0, "the strip keeps receiving while collapsed");
    expect(got[0].seq).toBe(snap.last_seq + 1);
    expect(ok(await screen.windowCallState({})).collapsed).toBe(true);
    expect(await phase()).toBe("recording");

    const expanded = ok(await screen.windowSetCollapsed({ collapsed: false }));
    expect(expanded).toMatchObject({ collapsed: false, layout: "floating" }); // same layout
    if (real()) expect((await asked()).some((c) => c.startsWith("place_call_window") && c.endsWith("collapsed=false"))).toBe(true);
    expect(growing(windows.all.map((w) => w.version))).toBe(true);
  });

  it("error path — capture notice while collapsed: the strip expands for it and Keep Recording takes it back to one line", async () => {
    await s.change(W.laptopOnly);
    const screen = s.core("call-screen");
    ok(await screen.windowSetCollapsed({ collapsed: true }));
    await s.change((w) => W.notice(w, { type: "call_ended", stops_at: Date.now() + 10_000 }));
    expect(ok(await screen.appSnapshot({})).capture.notice?.type).toBe("call_ended");
    const kept = ok(await screen.captureAnswerCallEnd({ call_id: W.LIVE_CALL, choice: "keep_recording" }));
    expect(kept).toMatchObject({ phase: "recording", notice: null });
    expect(ok(await screen.windowSetCollapsed({ collapsed: true })).collapsed).toBe(true);
  });
});

describe("cpt-noter-seq-floating-panel-hide-and-reopen", () => {
  it("happy path: Hide takes the panel off screen, the recording goes on, Open Call Screen brings it back with the same transcript", async () => {
    await s.change(W.laptopOnly);
    const screen = s.core("call-screen");
    const windows = await s.events("window:call");
    const before = ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));
    expect(ok(await screen.windowShowCall({})).visible).toBe(true);

    const hidden = ok(await screen.windowHideCall({}));
    expect(hidden.visible).toBe(false);
    await until(() => windows.latest()?.visible === false, "window:call hidden");
    if (real()) expect(await asked()).toContain("hide_call_window");
    expect(await phase()).toBe("recording"); // the menu bar icon still says recording

    const back = ok(await screen.windowShowCall({}));
    expect(back.visible).toBe(true);
    await until(() => windows.latest()?.visible === true, "window:call visible");
    const after = ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));
    expect(after.segments.map((g) => g.id)).toEqual(expect.arrayContaining(before.segments.map((g) => g.id)));
    expect(after.last_seq).toBeGreaterThanOrEqual(before.last_seq);
    expect(growing(windows.all.map((w) => w.version))).toBe(true);
  });

  it("error path — panel closed by a crash: a new WebView gets the recording state and the same transcript", async () => {
    await s.change(W.laptopOnly);
    const before = ok(await s.core("call-screen").transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));
    const reopened = s.reopen("call-screen"); // the WebView crashed; a new one loads
    expect(ok(await reopened.appSnapshot({})).capture).toMatchObject({ phase: "recording", call_id: W.LIVE_CALL });
    expect(ok(await reopened.windowShowCall({})).visible).toBe(true);
    const after = ok(await reopened.transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));
    expect(after.segments.map((g) => g.id)).toEqual(expect.arrayContaining(before.segments.map((g) => g.id)));
    expect(after.marks.map((m) => m.id)).toEqual(expect.arrayContaining(before.marks.map((m) => m.id)));
  });
});

describe("cpt-noter-seq-menu-bar-check-state", () => {
  it("happy path: the tray reads Recording with the call, and the privacy mode the settings hold", async () => {
    const snap = ok(await s.core("main").appSnapshot({}));
    expect(snap.capture).toMatchObject({ phase: "recording", title: W.LIVE_TITLE });
    expect(snap.privacy.effective).toBe("cloud_redacted");
    if (real()) {
      const tray = (await asked()).filter((c) => c.startsWith("set_tray")).at(-1);
      expect(tray).toMatch(/Recording/);
    }
  });

  it("empty path — not recording: the tray reads Not recording and nothing is detected", async () => {
    await s.change(W.idle);
    const snap = ok(await s.core("main").appSnapshot({}));
    expect(snap.capture).toMatchObject({ phase: "idle", call_id: null });
    expect(snap.detection.detection).toBeNull();
    if (real()) {
      await until(async () => (await asked()).filter((c) => c.startsWith("set_tray")).at(-1)?.includes("Not recording"), "tray: Not recording");
    }
  });
});

describe("the window commands", () => {
  it("window_report_view, window_navigate, window_announce and open_external each succeed at least once", async () => {
    const main = s.core("main");
    const nav = await s.events("nav:request");
    ok(await main.windowReportView({ call_id: null }));
    ok(await main.windowNavigate({ target: { type: "call_page", call_id: W.PAST_CALL, tab: "summary" } }));
    await until(() => nav.latest()?.type === "call_page", "nav:request");
    ok(await main.windowReportView({ call_id: W.PAST_CALL }));
    ok(await s.core("call-screen").windowAnnounce({ text: "Recording paused", politeness: "polite" }));
    ok(await main.openExternal({ target: { type: "system_settings", permission: "system_audio" } }));
    if (real()) expect(await asked()).toEqual(expect.arrayContaining(["open_external system_settings"]));
    expect(ok(await s.core("call-screen").windowSetCallLayout({ preference: "auto" })).layout).toBeDefined();
    ok(await s.core("call-screen").windowShowCall({}));
    ok(await s.core("call-screen").windowHideCall({}));
    ok(await s.core("call-screen").windowSetCollapsed({ collapsed: false }));
    ok(await s.core("call-screen").appSetHiddenForPresenting({ hidden: false }));
  });
});
