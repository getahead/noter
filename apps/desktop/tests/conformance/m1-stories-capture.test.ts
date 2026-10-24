// M1 capture stories against the real core (Backend Teamlead TL-7, HoD D-26): each test names
// its DESIGN.md story and asserts the core-visible steps of it — state, events and rows — not
// only a command result. The engine's side comes from the harness's scripted engine
// (`Scenario.engineFact` / `engineKill`) and the windows the core asked for from its scripted
// `Surfaces` log. The fake has no engine: there a story stops at its first engine fact.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CallId, CaptureState, DegradedState } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ahead, ok, refused, until } from "../support/results";
import { openScenario, type EngineFact, type Scenario } from "../support/scenario";
import * as W from "../support/world-presets";

/** Setup is complete and the self-test passed: call detection is on (the stories' precondition). */
function detectionOn(w: Parameters<typeof W.idle>[0]): void {
  W.idle(w);
  w.app.setup.self_test = { type: "passed", at: Date.now() };
  w.app.setup.detection_enabled = true;
}

let s: Scenario;
beforeEach(() => {
  s = openScenario({ alsoRecord: exercised, world: detectionOn });
});
afterEach(async () => {
  await s.dispose();
});

const TEAMS = { bundle_id: "com.microsoft.teams2", app_name: "Microsoft Teams" };
const SLACK = { bundle_id: "com.tinyspeck.slackmacgap", app_name: "Slack" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The engine reports `event` once it runs; false on the fake (the story stops there). */
async function fact(event: EngineFact): Promise<boolean> {
  if (s.target === "fake") return false;
  for (let i = 0; i < 100; i++) {
    if (await s.engineFact(event)) return true;
    await sleep(20);
  }
  throw new Error(`the engine never ran to hear ${event.type}`);
}

const types = (states: DegradedState[]) => states.map((d) => d.type);

async function degraded(): Promise<DegradedState[]> {
  return ok(await s.core("call-screen").appSnapshot({})).degraded.states;
}

async function phase(want: CaptureState["phase"]): Promise<CaptureState> {
  return until(async () => {
    const c = ok(await s.core("main").appSnapshot({})).capture;
    return c.phase === want && c;
  }, `phase ${want}`);
}

/** The call's row in the library; undefined while calls_list is not delivered. */
async function callRow(callId: CallId) {
  const page = ahead(await s.core("main").callsList({ filter: {}, sort: "newest", page: {} }));
  return page ? (page.rows.find((c) => c.id === callId) ?? null) : undefined;
}

/** A call recording from the Today page; null on the fake once the engine is needed. */
async function recording(): Promise<CallId | null> {
  const started = ok(await s.core("main").captureStart({ source: "today", sensitive: false }));
  if (s.target === "fake") return null;
  await phase("recording");
  return started.call_id!;
}

describe("cpt-noter-seq-record-prompt-start-recording", () => {
  it("happy path: a detected call shows the prompt, Record starts it, every window sees it recording, the call window opens without focus", async () => {
    const detected = await s.events("capture:detected");
    const states = await s.events("capture:state");
    if (!(await fact({ type: "call_detected", ...TEAMS, pid: 4242 }))) return;
    const detection = await until(() => detected.latest()?.detection ?? undefined, "capture:detected");
    expect(detection).toMatchObject({ bundle_id: TEAMS.bundle_id, app_name: TEAMS.app_name, blocked: null });
    expect(await s.surfaces()).toContain("show_record_prompt");

    const prompt = s.core("record-prompt");
    ok(await prompt.captureStart({ source: "record_prompt", sensitive: false, detection_id: detection.id }));
    const live = await phase("recording");
    expect(live.title).toBe(TEAMS.app_name);
    expect(ok(await s.core("call-screen").appSnapshot({})).capture.call_id).toBe(live.call_id); // every window
    expect(states.all.map((c) => c.phase)).toEqual(expect.arrayContaining(["starting", "recording"]));
    expect(await s.surfaces()).toEqual(expect.arrayContaining(["close_record_prompt", "open_call_window_inactive"]));
    expect(ok(await prompt.appSnapshot({})).detection.detection).toBeNull(); // used up by the start
    const row = await callRow(live.call_id!);
    if (row !== undefined) expect(row).toMatchObject({ title: TEAMS.app_name, status: "recording" });

    expect(ok(await s.core("call-screen").captureStop({ call_id: live.call_id! })).phase).toBe("stopped");
  });

  it("error path — not enough disk space: the prompt carries the block, Record is refused with disk_full, the menu starts it once there is room", async () => {
    await s.setFreeDisk(420);
    const detected = await s.events("capture:detected");
    if (!(await fact({ type: "call_detected", ...TEAMS, pid: 4242 }))) return;
    const detection = await until(() => detected.latest()?.detection ?? undefined, "capture:detected");
    expect(detection.blocked).toBe("disk_full");
    const refusal = refused(await s.core("record-prompt").captureStart({ source: "record_prompt", sensitive: false, detection_id: detection.id }));
    expect(refusal).toMatchObject({ code: "disk_full", detail: { type: "disk_space", free_mb: 420, needed_mb: 500 } });
    await s.setFreeDisk(90_000); // Delete Old Audio…
    ok(await s.core("main").captureStart({ source: "menu_bar", sensitive: false, detection_id: detection.id })); // Call Detected · Start Recording
    expect((await phase("recording")).title).toBe(TEAMS.app_name);
  });

  it("other path — not a call: Don't Ask for Safari ignores it from then on", async () => {
    const safari = { bundle_id: "com.apple.Safari", app_name: "Safari" };
    const detected = await s.events("capture:detected");
    if (!(await fact({ type: "call_detected", ...safari, pid: 77 }))) return;
    await until(() => detected.latest()?.detection ?? undefined, "capture:detected");
    ok(await s.core("record-prompt").captureIgnoreApp(safari));
    expect(ok(await s.core("main").appSnapshot({})).detection.detection).toBeNull();
    expect(ok(await s.core("settings").settingsGet({})).general.ignored_apps).toContainEqual(safari);
    const prompts = async () => (await s.surfaces())!.filter((c: string) => c === "show_record_prompt").length;
    const shown = await prompts();
    await fact({ type: "call_detected", ...safari, pid: 78 });
    await sleep(100);
    expect(await prompts()).toBe(shown);
  });
});

describe("cpt-noter-seq-record-prompt-record-after-missed-prompt", () => {
  it("empty path — prompt closed unanswered: the detection stays for the menu bar, no second prompt, Start Recording records the call", async () => {
    const detected = await s.events("capture:detected");
    if (!(await fact({ type: "call_detected", ...TEAMS, pid: 4242 }))) return;
    const detection = await until(() => detected.latest()?.detection ?? undefined, "capture:detected");
    ok(await s.core("record-prompt").captureDismissDetection({ detection_id: detection.id, reason: "timed_out" }));
    expect(await s.surfaces()).toContain("close_record_prompt");
    expect(ok(await s.core("main").appSnapshot({})).detection.detection?.id).toBe(detection.id); // kept for the menu
    await fact({ type: "call_detected", ...TEAMS, pid: 4242 });
    await sleep(100);
    expect((await s.surfaces())!.filter((c: string) => c === "show_record_prompt")).toHaveLength(1); // no second prompt

    ok(await s.core("main").captureStart({ source: "menu_bar", sensitive: false, detection_id: detection.id }));
    const live = await phase("recording");
    expect(live.title).toBe(TEAMS.app_name);
    const row = await callRow(live.call_id!);
    if (row !== undefined) expect(row?.title).toBe(TEAMS.app_name);
  });

  it("error path — setup incomplete: no prompt, Start Recording still records (O1)", async () => {
    await s.change((w) => W.firstRun(w));
    expect(ok(await s.core("main").appSnapshot({})).detection.detection).toBeNull();
    const started = ok(await s.core("main").captureStart({ source: "hotkey", sensitive: false }));
    expect(["starting", "recording"]).toContain(started.phase);
    if (s.target === "fake") return;
    expect((await phase("recording")).call_id).toBe(started.call_id);
  });
});

describe("cpt-noter-seq-call-screen-recover-capture", () => {
  it("happy path: a second audio source shows, Exclude stops it, the recording carries on", async () => {
    const callId = await recording();
    if (!callId) return;
    await fact({ type: "audio_source_added", call_id: callId, ...SLACK });
    await until(async () => types(await degraded()).includes("second_audio_source"), "second_audio_source");
    ok(await s.core("call-screen").captureExcludeSource({ call_id: callId, bundle_id: SLACK.bundle_id }));
    expect(types(await degraded())).not.toContain("second_audio_source");
    expect(ok(await s.core("main").appSnapshot({})).capture.phase).toBe("recording");

    // Keep: a source that belongs to the call stays, and is not asked about again.
    const zoom = { bundle_id: "us.zoom.xos", app_name: "zoom.us" };
    await fact({ type: "audio_source_added", call_id: callId, ...zoom });
    await until(async () => types(await degraded()).includes("second_audio_source"), "second_audio_source (Zoom)");
    ok(await s.core("call-screen").captureKeepSource({ call_id: callId, bundle_id: zoom.bundle_id }));
    expect(types(await degraded())).not.toContain("second_audio_source");
    await fact({ type: "audio_source_added", call_id: callId, ...zoom });
    await sleep(100);
    expect(types(await degraded())).not.toContain("second_audio_source");
  });

  it("error paths — system audio silent, microphone off and a microphone change show while the recording carries on", async () => {
    const callId = await recording();
    if (!callId) return;
    await fact({ type: "system_audio_silent", call_id: callId, since_ms: 1_802_000, confidence: 0.9 });
    await until(async () => types(await degraded()).includes("system_audio_silent"), "system_audio_silent");
    await fact({ type: "levels", call_id: callId, mic_db: -30, sys_db: -30 }); // allowed again
    await until(async () => !types(await degraded()).includes("system_audio_silent"), "silent cleared");

    await fact({ type: "levels", call_id: callId, mic_db: -120, sys_db: -30 });
    await until(async () => types(await degraded()).includes("microphone_off"), "microphone_off");
    await fact({ type: "levels", call_id: callId, mic_db: -30, sys_db: -30 });
    await until(async () => !types(await degraded()).includes("microphone_off"), "mic cleared");

    await fact({ type: "device_changed", call_id: callId, device_name: "AirPods Pro", gap_from_ms: 60_000, gap_to_ms: 62_000 });
    const changed = await until(async () => (await degraded()).find((d) => d.type === "device_changed"), "device_changed");
    expect(changed).toMatchObject({ device_name: "AirPods Pro", gap_ms: 2_000 }); // Microphone changed · 2 s lost
    expect(ok(await s.core("main").appSnapshot({})).capture.phase).toBe("recording");
    const transcript = ahead(await s.core("call-screen").transcriptSubscribe({ call_id: callId }, () => {}));
    if (transcript) expect(transcript.gaps.some((g) => g.reason === "device_changed" && g.t1_ms - g.t0_ms === 2_000)).toBe(true);
  });

  it("error path — engine stopped: Not recording, Try Again continues the same call with an engine_restart gap", async () => {
    const callId = await recording();
    if (!callId) return;
    // Three crashes within 30 s: the capture-first restart gives up.
    for (let i = 0; i < 3; i++) {
      await fact({ type: "levels", call_id: callId, mic_db: -30, sys_db: -30 }); // a running engine to kill
      await s.engineKill();
    }
    const failed = await phase("failed");
    expect(failed.call_id).toBe(callId);
    expect(types(await degraded())).toContain("capture_failed");

    const again = s.core("call-screen").captureResumeInterrupted({ call_id: callId }); // Try Again
    await fact({ type: "session_started", call_id: callId, mic_device: "Scripted Microphone", output_device: "Scripted Speakers" });
    expect(ok(await again).phase).toBe("recording");
    expect(ok(await s.core("main").appSnapshot({})).capture.call_id).toBe(callId); // the same call
    await until(async () => !types(await degraded()).includes("capture_failed"), "capture_failed cleared");
    const transcript = ahead(await s.core("call-screen").transcriptSubscribe({ call_id: callId }, () => {}));
    if (transcript) expect(transcript.gaps.some((g) => g.reason === "engine_restart")).toBe(true);
  });
});

describe("cpt-noter-seq-call-screen-stop-at-call-end", () => {
  it("happy path: the call-ended notice holds, Keep Recording keeps the call, Stop Now stops it, Continue Recording appends", async () => {
    const callId = await recording();
    if (!callId) return;
    const screen = s.core("call-screen");
    await s.change((w) => W.notice(w, { type: "call_ended", stops_at: Date.now() + 10_000 }));
    expect(ok(await screen.captureHoldNotice({ call_id: callId, held: true })).notice).toEqual({ type: "call_ended", stops_at: null });
    expect(ok(await screen.captureAnswerCallEnd({ call_id: callId, choice: "keep_recording" }))).toMatchObject({ phase: "recording", notice: null });

    await s.change((w) => W.notice(w, { type: "call_ended", stops_at: Date.now() + 10_000 }));
    const stopped = ok(await screen.captureAnswerCallEnd({ call_id: callId, choice: "stop_now" }));
    expect(stopped.phase).toBe("stopped");
    expect(stopped.continue_until! - Date.now()).toBeGreaterThan(4 * W.MIN); // Continue Recording for 5 minutes
    const row = await callRow(callId);
    if (row !== undefined) expect(row?.status).toBe("processing");

    expect(ok(await screen.captureContinue({ call_id: callId }))).toMatchObject({ phase: "recording", call_id: callId });
    const transcript = ahead(await screen.transcriptSubscribe({ call_id: callId }, () => {}));
    if (transcript) expect(transcript.gaps.some((g) => g.reason === "continued")).toBe(true);
  });

  it("error path — next meeting starts straight away: Start as New Call saves this call and records the new one", async () => {
    const callId = await recording();
    if (!callId) return;
    await s.change((w) =>
      W.notice(w, {
        type: "new_meeting",
        event: { id: "evt_anna", title: "1:1 with Anna K.", starts_at: Date.now(), ends_at: Date.now() + 30 * W.MIN },
        app_name: TEAMS.app_name,
        detected_at: Date.now() - 12_000,
        expires_at: Date.now() + 60_000,
        default_choice: "start_as_new_call",
      }),
    );
    const next = ok(await s.core("call-screen").captureAnswerNewMeeting({ call_id: callId, choice: "start_as_new_call" }));
    expect(next.call_id).not.toBe(callId);
    expect(next.title).toBe("1:1 with Anna K.");
    const saved = await callRow(callId);
    if (saved !== undefined) expect(saved?.status).toBe("processing");
  });
});

describe("cpt-noter-seq-menu-bar-control-recording", () => {
  it("core half: mark, pause and stop take effect at once and every window hears capture:state", async () => {
    const callId = await recording();
    if (!callId) return;
    const states = await s.events("capture:state");
    const main = s.core("main");
    const mark = ok(await s.core("call-screen").captureMarkMoment({ call_id: callId }));
    expect(mark.call_id).toBe(callId);
    expect(ok(await main.captureSetPaused({ call_id: callId, paused: true })).phase).toBe("paused");
    await sleep(20); // a pause that lasts no time leaves no gap (and the real core's clock counts milliseconds)
    expect(ok(await main.captureSetPaused({ call_id: callId, paused: false })).phase).toBe("recording");
    expect(ok(await main.captureStop({ call_id: callId })).phase).toBe("stopped");
    await until(() => states.latest()?.phase === "stopped", "capture:state stopped");
    expect(states.all.map((c) => c.phase)).toEqual(expect.arrayContaining(["paused", "recording", "stopping", "stopped"]));
    const transcript = ahead(await s.core("call-screen").transcriptSubscribe({ call_id: callId }, () => {}));
    if (transcript) {
      expect(transcript.marks.some((m) => m.id === mark.id)).toBe(true);
      expect(transcript.gaps.some((g) => g.reason === "paused")).toBe(true);
    }
  });
});
