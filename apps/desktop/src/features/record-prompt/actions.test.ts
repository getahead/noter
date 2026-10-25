import { afterEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { CallDetection } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { announce, answerCallEnd, answerNewMeeting, dismiss, holdNotice, ignoreApp, openDeleteOldAudio, openSystemSettings, startRecording } from "./actions";

let bridge: Bridge;
let fake: FakeCore;
afterEach(() => bridge.close());

const det: CallDetection = { id: "det_teams", app_name: "Microsoft Teams", bundle_id: "com.microsoft.teams2", matched_event: null, detected_at: Date.now(), prompt_until: Date.now() + 30_000, blocked: null };
async function ready() {
  fake = new FakeCore({ window: "record-prompt" });
  fake.world.app.capture.phase = "idle";
  fake.world.app.detection.detection = det;
  bridge = createBridge("record-prompt", fake);
  await bridge.open();
}
const sent = () => {
  const seen: Array<[string, unknown]> = [];
  const invoke = fake.invoke.bind(fake);
  fake.invoke = ((cmd: string, args: unknown) => (seen.push([cmd, args]), (invoke as (...a: unknown[]) => unknown)(cmd, args))) as typeof fake.invoke;
  return seen;
};

describe("record prompt commands", () => {
  it("startRecording sends the detection and the sensitive choice, and announces the start", async () => {
    await ready();
    const seen = sent();
    expect(await startRecording(bridge, det, true)).toEqual({ ok: true });
    expect(seen).toContainEqual(["capture_start", { source: "record_prompt", sensitive: true, detection_id: "det_teams" }]);
    expect(seen).toContainEqual(["window_announce", { text: "Recording started", politeness: "polite" }]);
  });

  it("names the refusal of a start: disk_full with the free space, model_missing, already_recording", async () => {
    await ready();
    fake.failNext("capture_start", "disk_full", { type: "disk_space", free_mb: 420, needed_mb: 500 });
    expect(await startRecording(bridge, det, false)).toEqual({ ok: false, reason: "disk_full", freeMb: 420 });
    fake.failNext("capture_start", "model_missing");
    expect(await startRecording(bridge, det, false)).toEqual({ ok: false, reason: "model_missing" });
    fake.failNext("capture_start", "already_recording");
    expect(await startRecording(bridge, det, false)).toEqual({ ok: false, reason: "already_recording" });
    fake.failNext("capture_start", "internal");
    expect(await startRecording(bridge, det, false)).toEqual({ ok: false, reason: "other" });
  });

  it("dismiss, ignoreApp, the notice answers and the hold send their arguments", async () => {
    await ready();
    const seen = sent();
    await dismiss(bridge, "det_teams", "timed_out");
    await ignoreApp(bridge, det);
    await answerCallEnd(bridge, "call_x", "keep_recording");
    await answerNewMeeting(bridge, "call_x", "start_as_new_call");
    await holdNotice(bridge, "call_x", true);
    seen.splice(0, seen.length, ...seen.filter(([c]) => c !== "log_ui")); // the core refuses the notice answers of a call that is not live; the UI logs it
    expect(seen.map(([c]) => c)).toEqual(["capture_dismiss_detection", "capture_ignore_app", "capture_answer_call_end", "capture_answer_new_meeting", "capture_hold_notice"]);
    expect(seen[0]![1]).toEqual({ detection_id: "det_teams", reason: "timed_out" });
    expect(seen[1]![1]).toEqual({ bundle_id: "com.microsoft.teams2", app_name: "Microsoft Teams" });
    expect(seen[4]![1]).toEqual({ call_id: "call_x", held: true });
  });

  it("opens the System Audio Recording pane, asks the main window for the Delete Old Audio sheet, and announces", async () => {
    await ready();
    const seen = sent();
    await openSystemSettings(bridge);
    await openDeleteOldAudio(bridge);
    await announce(bridge, "x", "assertive");
    expect(seen).toContainEqual(["open_external", { target: { type: "system_settings", permission: "system_audio" } }]);
    expect(seen).toContainEqual(["window_navigate", { target: { type: "delete_old_audio" } }]);
    expect(seen).toContainEqual(["window_announce", { text: "x", politeness: "assertive" }]);
  });
});
