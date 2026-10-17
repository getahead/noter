// M1 — Call screen: capture problems and the end of the call (DESIGN.md 3.6, stories-a).
// One test per story path. `cpt-noter-seq-call-screen-stop-at-call-end` is one of the five
// critical stories. The fixture world starts mid-call ("Planning: VHI 8.0 drawer redesign"
// recording on the Studio Display). Contract-level today; banner and status-strip rendering
// is added when the call screen lands (docs/TEST-PLAN.md › M1).
import type { CaptureState, TranscriptMsg } from "../../src/core/bindings";
import { ahead, ok, refused, until } from "../support/results";
import * as W from "../support/world-presets";
import { expect, given, seqContiguous, test, versionsGrow } from "./support/fixtures";

const states = (s: { states: Array<{ type: string }> }) => s.states.map((d) => d.type);

test.describe("cpt-noter-seq-call-screen-recover-capture", () => {
  test("happy path: Slack is also playing audio → Exclude Slack, banner closes, one clean recording", async ({ scenario }) => {
    await given(scenario, (w) => W.degrade(w, { type: "second_audio_source", call_id: W.LIVE_CALL, ...W.APPS.slack, since: Date.now() }));
    const screen = scenario.core("call-screen");
    const degraded = await scenario.events("degraded:changed");

    expect(states(ok(await screen.appSnapshot({})).degraded)).toContain("second_audio_source");
    const after = ok(await screen.captureExcludeSource({ call_id: W.LIVE_CALL, bundle_id: W.APPS.slack.bundle_id }));
    expect(after.phase).toBe("recording"); // nothing lost
    await until(() => degraded.latest() && !states(degraded.latest()!).includes("second_audio_source"), "the banner closes");
    expect(versionsGrow(degraded.all)).toBe(true);
  });

  test("other path — Keep: the second source stays in the tap and its banner is not shown again", async ({ scenario }) => {
    await given(scenario, (w) => W.degrade(w, { type: "second_audio_source", call_id: W.LIVE_CALL, ...W.APPS.slack, since: Date.now() }));
    const screen = scenario.core("call-screen");

    expect(ok(await screen.captureKeepSource({ call_id: W.LIVE_CALL, bundle_id: W.APPS.slack.bundle_id })).phase).toBe("recording");
    expect(states(ok(await screen.appSnapshot({})).degraded)).not.toContain("second_audio_source");
    expect(refused(await screen.captureKeepSource({ call_id: W.LIVE_CALL, bundle_id: W.APPS.slack.bundle_id })).code).toBe("notice_expired");
  });

  test("error path — System audio silent: Recording · mic only, Open System Settings…, both sides back with the gap shown", async ({ scenario }) => {
    await given(scenario, (w) => W.degrade(w, { type: "system_audio_silent", call_id: W.LIVE_CALL, since: Date.now(), confidence: 0.9 }));
    const screen = scenario.core("call-screen");

    expect(states(ok(await screen.appSnapshot({})).degraded)).toContain("system_audio_silent");
    ok(await screen.openExternal({ target: { type: "system_settings", permission: "system_audio" } }));
    await scenario.change((w) => {
      W.recover(w, "system_audio_silent"); // Noter ticked in the system audio list
      w.transcripts.find((t) => t.call_id === W.LIVE_CALL)!.gaps.push({ call_id: W.LIVE_CALL, t0_ms: 1_802_000, t1_ms: 1_840_000, reason: "system_audio_silent" });
    });
    const snap = ok(await screen.appSnapshot({}));
    expect(states(snap.degraded)).not.toContain("system_audio_silent");
    expect(snap.capture.phase).toBe("recording");
    const transcript = ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));
    expect(transcript.gaps.some((g) => g.reason === "system_audio_silent")).toBe(true); // System audio silent 00:30:02–00:30:40
  });

  test("error path — Microphone off: the call window opens as usual, Recording · no mic, fixed in System Settings", async ({ scenario }) => {
    await given(scenario, W.idle, (w) => W.permission(w, "microphone", "denied"));
    const screen = scenario.core("call-screen");

    const started = ok(await screen.captureStart({ source: "call_window", sensitive: false })); // O1: not gated on permissions
    expect(started.phase).toBe("recording");
    ok(await screen.windowShowCall({}));
    await scenario.change((w) => W.degrade(w, { type: "microphone_off", call_id: started.call_id! }));
    expect(states(ok(await screen.appSnapshot({})).degraded)).toContain("microphone_off");
    ok(await screen.openExternal({ target: { type: "system_settings", permission: "microphone" } }));
    await scenario.change((w) => {
      W.permission(w, "microphone", "granted");
      W.recover(w, "microphone_off");
    });
    const snap = ok(await screen.appSnapshot({}));
    expect(states(snap.degraded)).not.toContain("microphone_off");
    expect(snap.capture).toMatchObject({ phase: "recording", call_id: started.call_id }); // the other side recorded throughout
  });

  test("error path — Engine stopped: Not recording · engine stopped, Try Again continues the same call with a gap row", async ({ scenario }) => {
    await given(scenario, (w) => {
      w.app.capture.phase = "failed";
      W.degrade(w, { type: "capture_failed", call_id: W.LIVE_CALL, since: Date.now() });
    });
    const screen = scenario.core("call-screen");

    expect(states(ok(await screen.appSnapshot({})).degraded)).toContain("capture_failed");
    const resumed = ok(await screen.captureResumeInterrupted({ call_id: W.LIVE_CALL })); // Try Again
    expect(resumed).toMatchObject({ phase: "recording", call_id: W.LIVE_CALL });
    expect(states(ok(await screen.appSnapshot({})).degraded)).not.toContain("capture_failed");
    const transcript = ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, () => {}));
    expect(transcript.gaps.some((g) => g.reason === "engine_restart")).toBe(true);
  });

  test("error path — Headphones connected: Microphone changed · 2 s lost, the recording carries on", async ({ scenario }) => {
    const screen = scenario.core("call-screen");
    const got: TranscriptMsg[] = [];
    const sub = ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, (m) => got.push(m)));
    expect(sub.live).toBe(true);

    await scenario.change((w) => W.degrade(w, { type: "device_changed", call_id: W.LIVE_CALL, device_name: "AirPods Pro", gap_ms: 2000 }));
    await scenario.push("transcript_subscribe", { event: { type: "gap", gap: { call_id: W.LIVE_CALL, t0_ms: 1_420_000, t1_ms: 1_422_000, reason: "device_changed" } } });
    await until(() => got.some((m) => m.event.type === "gap" && m.event.gap.reason === "device_changed"), "the marker row in the transcript");
    expect(seqContiguous(got, sub.last_seq)).toBe(true);
    expect(ok(await screen.appSnapshot({})).capture.phase).toBe("recording");
  });

  test("error path — Transcription stalled: restarting, then new lines again and the banner closes", async ({ scenario }) => {
    const screen = scenario.core("call-screen");
    const got: TranscriptMsg[] = [];
    const sub = ok(await screen.transcriptSubscribe({ call_id: W.LIVE_CALL }, (m) => got.push(m)));

    await scenario.change((w) => W.degrade(w, { type: "transcription_stalled", call_id: W.LIVE_CALL, since: Date.now() }));
    expect(states(ok(await screen.appSnapshot({})).degraded)).toContain("transcription_stalled");
    const seen = got.length;
    await scenario.change((w) => W.recover(w, "transcription_stalled"));
    await until(() => got.length > seen, "new lines appear again");
    expect(states(ok(await screen.appSnapshot({})).degraded)).not.toContain("transcription_stalled");
    expect(seqContiguous(got, sub.last_seq)).toBe(true); // missed lines filled in, no gap in the stream
  });

  test("empty path — Nothing heard yet: Keep Recording closes the notice; Discard Recording deletes it", async ({ scenario }) => {
    await given(scenario, W.idle);
    const screen = scenario.core("call-screen");
    const started = ok(await screen.captureStart({ source: "call_window", sensitive: false }));
    const id = started.call_id!;
    let levels = 0;
    ok(await screen.levelsSubscribe({ call_id: id }, () => levels++)); // Waiting for speech… with You and Others
    await until(() => levels >= 2, "the two meters");

    await scenario.change((w) => W.notice(w, { type: "nothing_heard", since: Date.now() - 5 * W.MIN }));
    expect(ok(await screen.captureKeepRecording({ call_id: id })).notice).toBeNull(); // Keep Recording
    expect(refused(await screen.captureKeepRecording({ call_id: id })).code).toBe("notice_expired");

    await scenario.change((w) => W.notice(w, { type: "nothing_heard", since: Date.now() - 5 * W.MIN }));
    const discarded = ok(await screen.captureDiscard({ call_id: id })); // Discard Recording → Discard
    expect(discarded).toMatchObject({ phase: "idle", call_id: null }); // Noter — Not recording
    expect(refused(await scenario.core("main").callGet({ call_id: id })).code).toBe("not_found");
  });

  test("error path — Disk nearly full: 2 GB free, Recording continues, Delete Old Audio… in the main window", async ({ scenario }) => {
    await given(scenario, (w) => {
      w.app.environment.disk_free_mb = 2_000;
      W.degrade(w, { type: "disk_low", free_mb: 2_000 });
    });
    const screen = scenario.core("call-screen");

    const snap = ok(await screen.appSnapshot({}));
    expect(states(snap.degraded)).toContain("disk_low");
    expect(snap.capture.phase).toBe("recording"); // Recording stays in the status strip
    ok(await screen.windowNavigate({ target: { type: "today" } })); // the sheet opens in the main window
    ahead(await scenario.core("main").audioDeleteOlder({ older_than_days: 30 })); // Delete Audio (M2 command)
    await scenario.change((w) => {
      w.app.environment.disk_free_mb = 8_200;
      W.recover(w, "disk_low");
    });
    const after = ok(await screen.appSnapshot({}));
    expect(states(after.degraded)).not.toContain("disk_low");
    expect(after.capture.phase).toBe("recording");
  });
});

test.describe("cpt-noter-seq-call-screen-stop-at-call-end", () => {
  const callEnded = (w: Parameters<typeof W.notice>[0]) => W.notice(w, { type: "call_ended", stops_at: Date.now() + 10_000 });

  test("happy path: The call seems to have ended, countdown held while pointed at, Stop Now, Saved with Continue Recording", async ({ scenario }) => {
    await given(scenario, callEnded);
    const screen = scenario.core("call-screen");
    const captures = await scenario.events("capture:state");

    const shown = ok(await screen.appSnapshot({})).capture.notice;
    expect(shown).toMatchObject({ type: "call_ended" });
    const held = ok(await screen.captureHoldNotice({ call_id: W.LIVE_CALL, held: true })); // pointer on the notice
    expect(held.notice).toEqual({ type: "call_ended", stops_at: null });
    const released = ok(await screen.captureHoldNotice({ call_id: W.LIVE_CALL, held: false }));
    expect(released.notice?.type === "call_ended" && typeof released.notice.stops_at === "number").toBe(true); // 10 s again

    const stopped = ok(await screen.captureAnswerCallEnd({ call_id: W.LIVE_CALL, choice: "stop_now" }));
    expect(stopped.phase).toBe("stopped"); // Saved · 48 min · Summary in about 2 minutes
    expect(stopped.notice).toBeNull();
    expect(stopped.continue_until! - Date.now()).toBeGreaterThan(4 * W.MIN); // Continue Recording works for 5 minutes
    expect(stopped.continue_until! - Date.now()).toBeLessThanOrEqual(5 * W.MIN);
    await until(() => captures.latest()?.phase === "stopped", "capture:state stopped");
    expect(versionsGrow(captures.all)).toBe(true);
    ok(await screen.windowNavigate({ target: { type: "call_page", call_id: W.LIVE_CALL, tab: "summary" } })); // Open in Noter
  });

  test("error path — Next meeting starts straight away: Start as New Call saves the planning call and records the 1:1", async ({ scenario }) => {
    await given(scenario, (w) =>
      W.notice(w, {
        type: "new_meeting",
        event: { id: "evt_anna", title: "1:1 with Anna K.", starts_at: Date.now(), ends_at: Date.now() + 30 * W.MIN },
        app_name: "Microsoft Teams",
        detected_at: Date.now() - 12_000,
        expires_at: Date.now() + 60_000,
        default_choice: "start_as_new_call",
      }),
    );
    const screen = scenario.core("call-screen");

    const next = ok(await screen.captureAnswerNewMeeting({ call_id: W.LIVE_CALL, choice: "start_as_new_call" }));
    expect(next.call_id).not.toBe(W.LIVE_CALL); // two calls, each with its own title
    expect(next).toMatchObject({ phase: "recording", title: "1:1 with Anna K.", notice: null });
    expect(next.recorded_ms).toBeLessThan(60_000); // the clock restarts near 00:00:12
    expect(refused(await screen.captureAnswerNewMeeting({ call_id: W.LIVE_CALL, choice: "keep_in_this_call" })).code).toBe("notice_expired");
  });

  test("error path — Stopped by mistake: ⌃⌥⌘R by mistake, Continue Recording resumes the same call", async ({ scenario }) => {
    const screen = scenario.core("call-screen");

    const stopped = ok(await screen.captureStop({ call_id: W.LIVE_CALL })); // ⌃⌥⌘R
    expect(stopped.phase).toBe("stopped");
    expect(refused(await screen.captureSetPaused({ call_id: W.LIVE_CALL, paused: false })).code).toBe("not_recording"); // un-pausing is not Continue
    const again = ok(await screen.captureContinue({ call_id: W.LIVE_CALL })); // Continue Recording
    expect(again).toMatchObject({ phase: "recording", call_id: W.LIVE_CALL, continue_until: null });
  });

  test("empty path — No answer to the notice: stopped when the countdown runs out, Continue Recording", async ({ scenario }) => {
    await given(scenario, (w) => W.notice(w, { type: "call_ended", stops_at: Date.now() + 10_000 }));
    const screen = scenario.core("call-screen");
    // The countdown runs out unanswered: the core stops the call by itself.
    await scenario.change((w) =>
      Object.assign(w.app.capture, { phase: "stopped", notice: { type: "stopped_automatically", call_id: W.LIVE_CALL }, continue_until: Date.now() + 5 * W.MIN }),
    );
    const snap = ok(await screen.appSnapshot({})).capture;
    expect(snap).toMatchObject({ phase: "stopped", notice: { type: "stopped_automatically" } }); // Stopped at 11:02 · the call had ended
    expect(refused(await screen.captureAnswerCallEnd({ call_id: W.LIVE_CALL, choice: "keep_recording" })).code).toBe("notice_expired");

    const again = ok(await screen.captureContinue({ call_id: W.LIVE_CALL }));
    expect(again).toMatchObject({ phase: "recording", call_id: W.LIVE_CALL });
  });

  test("error path — Call window hidden: the notice in the small panel, Stop Now there, recording saved", async ({ scenario }) => {
    await given(scenario, callEnded);
    const screen = scenario.core("call-screen");
    expect(ok(await screen.windowHideCall({})).visible).toBe(false);

    const panel = scenario.core("record-prompt"); // the small panel where Record this call? appears
    expect(ok(await panel.appSnapshot({})).capture.notice?.type).toBe("call_ended");
    expect(ok(await panel.captureHoldNotice({ call_id: W.LIVE_CALL, held: false })).notice?.type).toBe("call_ended"); // Stopping in 10 s.
    const stopped: CaptureState = ok(await panel.captureAnswerCallEnd({ call_id: W.LIVE_CALL, choice: "stop_now" }));
    expect(stopped.phase).toBe("stopped");
    expect(ok(await screen.windowCallState({})).visible).toBe(false); // Teams keeps focus, nothing reopened
  });

  test("error path — Hidden for presenting: no countdown on screen, Stop Recording from the menu, windows back after ⌃⌥⌘0", async ({ scenario }) => {
    const main = scenario.core("main");
    ok(await main.appSetHiddenForPresenting({ hidden: true }));
    await scenario.change((w) => W.notice(w, { type: "call_ended", stops_at: null })); // Call seems to have ended, no countdown

    const snap = ok(await main.appSnapshot({}));
    expect(snap.presenting.hidden).toBe(true);
    expect(snap.capture.notice).toEqual({ type: "call_ended", stops_at: null });
    expect(ok(await main.captureStop({ call_id: W.LIVE_CALL })).phase).toBe("stopped"); // Stop Recording
    expect(ok(await main.appSetHiddenForPresenting({ hidden: false })).hidden).toBe(false); // ⌃⌥⌘0 after the share
  });
});
