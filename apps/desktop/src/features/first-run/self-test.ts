// Self-test panel: the state machine and the reducer that renders each core message
// (docs/features/ui/first-run.md § 3 › Render a self-test message, § 4 › Self-test panel).
import type { AudioChannel, PermissionState, SelfTestEvent } from "../../core/bindings";

export type SelfTestState = "IDLE" | "WAITING_FOR_MODEL" | "PERMISSION_MISSING" | "RUNNING" | "PASSED" | "FAILED";
export type SelfTestInput =
  | { type: "run"; modelReady: boolean } // Run Test or Play Test Clip
  | { type: "model_arrived" }
  | { type: "system_audio"; state: PermissionState }
  | { type: "core"; event: SelfTestEvent };

// @cpt-state:cpt-noter-state-ui-first-run-self-test:p1
export function selfTestNext(state: SelfTestState, input: SelfTestInput): SelfTestState {
  switch (input.type) {
    case "run":
      // @cpt-begin:cpt-noter-state-ui-first-run-self-test:p1:inst-idle-waiting
      // @cpt-begin:cpt-noter-state-ui-first-run-self-test:p1:inst-idle-running
      // @cpt-begin:cpt-noter-state-ui-first-run-self-test:p1:inst-failed-running
      return state === "IDLE" || state === "FAILED" || state === "PASSED" ? (input.modelReady ? "RUNNING" : "WAITING_FOR_MODEL") : state;
      // @cpt-end:cpt-noter-state-ui-first-run-self-test:p1:inst-failed-running
      // @cpt-end:cpt-noter-state-ui-first-run-self-test:p1:inst-idle-running
      // @cpt-end:cpt-noter-state-ui-first-run-self-test:p1:inst-idle-waiting
    case "model_arrived":
      // @cpt-begin:cpt-noter-state-ui-first-run-self-test:p1:inst-waiting-running
      return state === "WAITING_FOR_MODEL" ? "RUNNING" : state;
      // @cpt-end:cpt-noter-state-ui-first-run-self-test:p1:inst-waiting-running
    case "system_audio": {
      const granted = input.state === "granted";
      // @cpt-begin:cpt-noter-state-ui-first-run-self-test:p1:inst-idle-missing
      if (state === "IDLE" && !granted) return "PERMISSION_MISSING";
      // @cpt-end:cpt-noter-state-ui-first-run-self-test:p1:inst-idle-missing
      // @cpt-begin:cpt-noter-state-ui-first-run-self-test:p1:inst-missing-idle
      return state === "PERMISSION_MISSING" && granted ? "IDLE" : state;
      // @cpt-end:cpt-noter-state-ui-first-run-self-test:p1:inst-missing-idle
    }
    case "core": {
      if (state !== "RUNNING") return state;
      const e = input.event;
      // @cpt-begin:cpt-noter-state-ui-first-run-self-test:p1:inst-running-passed
      if (e.type === "passed") return "PASSED";
      // @cpt-end:cpt-noter-state-ui-first-run-self-test:p1:inst-running-passed
      // @cpt-begin:cpt-noter-state-ui-first-run-self-test:p1:inst-running-failed
      if (e.type === "failed") {
        // the fourth line is information only: the first three still passed
        if (e.reason.type === "own_sounds_leak") return "PASSED";
        if (e.reason.type === "model_missing") return "WAITING_FOR_MODEL";
        return e.reason.type === "permission_missing" || e.reason.type === "zero_buffers" ? "PERMISSION_MISSING" : "FAILED";
      }
      // @cpt-end:cpt-noter-state-ui-first-run-self-test:p1:inst-running-failed
      return e.type === "ended" ? "IDLE" : state; // the stream ended without a verdict
    }
  }
}

export type OwnSounds = "pending" | "excluded" | "off" | "leaked";
export type SelfTestPanel = {
  state: SelfTestState;
  micDb: number | null;
  sysDb: number | null;
  /** The live transcript line; shown, never announced. */
  line: { channel: AudioChannel; text: string } | null;
  arrived: Record<AudioChannel, boolean>;
  aligned: boolean;
  ownSounds: OwnSounds;
  /** Settings › Audio: whether the test also checks that Noter's own sounds stay out. */
  excludeOwnSounds: boolean;
  failure: string | null;
  runEnabled: boolean;
};

export const OWN_SOUNDS_MESSAGE: Record<OwnSounds, string> = {
  pending: "",
  excluded: "Noter's own sounds stay out of the recording",
  off: "Noter's own sounds are recorded. Replay while recording stays off. Change this in Settings › Audio & Transcription.",
  leaked: "Noter's own sounds reached the recording. Replay while recording stays off until this passes.",
};
export const ONE_STREAM_SILENT: Record<AudioChannel, string> = {
  sys: "We hear your microphone but not system audio. Play any sound in another app and try again.",
  mic: "We hear system audio but not your microphone. Speak and try again.",
};
export const SYSTEM_AUDIO_MISSING = "System audio recording is not allowed yet.";
export const TIMED_OUT = "The test didn't finish. Check that sound is playing, then try again.";
export const LEVELS_MIN_INTERVAL_MS = 100;

// Run Test is dimmed only while waiting for the model, with the permission missing, or while a test runs
const runEnabled = (s: SelfTestState) => s === "IDLE" || s === "FAILED" || s === "PASSED";

export function initialSelfTestPanel(state: SelfTestState, excludeOwnSounds: boolean): SelfTestPanel {
  return { state, micDb: null, sysDb: null, line: null, arrived: { mic: false, sys: false }, aligned: false, ownSounds: "pending", excludeOwnSounds, failure: null, runEnabled: runEnabled(state) };
}

/** The panel after the user starts a test: results of the last run are cleared. */
export function runSelfTest(panel: SelfTestPanel, modelReady: boolean): SelfTestPanel {
  const state = selfTestNext(panel.state, { type: "run", modelReady });
  return state === panel.state ? panel : { ...initialSelfTestPanel(state, panel.excludeOwnSounds) };
}

/** True when a `levels` message should update the meters. */
export const levelsDue = (lastMs: number | null, nowMs: number) => lastMs === null || nowMs - lastMs >= LEVELS_MIN_INTERVAL_MS;

// @cpt-algo:cpt-noter-algo-ui-first-run-self-test-result:p1
export function applySelfTestEvent(panel: SelfTestPanel, e: SelfTestEvent): SelfTestPanel {
  // a late message after the verdict changes nothing but the meters going quiet
  if (panel.state !== "RUNNING" && e.type !== "ended") return panel;
  const state = selfTestNext(panel.state, { type: "core", event: e });
  let next: SelfTestPanel = { ...panel, state };
  // @cpt-begin:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-match-event
  switch (e.type) {
    case "levels":
      // @cpt-begin:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-case-levels
      next = { ...next, micDb: e.mic_db, sysDb: e.sys_db };
      // @cpt-end:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-case-levels
      break;
    case "line":
      // @cpt-begin:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-case-line
      next = { ...next, line: { channel: e.channel, text: e.text } };
      // @cpt-end:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-case-line
      break;
    case "stream_arrived":
      // @cpt-begin:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-case-arrived
      next = { ...next, arrived: { ...panel.arrived, [e.channel]: true } };
      // @cpt-end:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-case-arrived
      break;
    case "passed":
      // @cpt-begin:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-case-passed
      next = { ...next, aligned: true, ownSounds: panel.ownSounds === "leaked" ? "leaked" : panel.excludeOwnSounds ? "excluded" : "off" };
      // @cpt-end:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-case-passed
      break;
    case "failed":
      // @cpt-begin:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-case-failed
      if (e.reason.type === "own_sounds_leak") next = { ...next, aligned: true, ownSounds: "leaked" };
      else if (e.reason.type === "one_stream_silent") next = { ...next, failure: ONE_STREAM_SILENT[e.reason.channel] };
      else if (e.reason.type === "timed_out") next = { ...next, failure: TIMED_OUT };
      // @cpt-end:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-case-failed
      break;
    case "ended":
      // @cpt-begin:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-case-ended
      next = { ...next, micDb: null, sysDb: null };
      // @cpt-end:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-case-ended
      break;
  }
  // @cpt-end:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-match-event
  // @cpt-begin:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-return-panel
  return { ...next, runEnabled: runEnabled(state) };
  // @cpt-end:cpt-noter-algo-ui-first-run-self-test-result:p1:inst-return-panel
}

/** Result lines newly ticked by a step, in order, for the polite live region; the transcript line is never among them. */
export function newAnnouncements(prev: SelfTestPanel, next: SelfTestPanel): string[] {
  const out: string[] = [];
  if (!prev.arrived.sys && next.arrived.sys) out.push("System audio arrives");
  if (!prev.arrived.mic && next.arrived.mic) out.push("Your microphone arrives");
  if (!prev.aligned && next.aligned) out.push("Both streams line up");
  if (prev.ownSounds === "pending" && next.ownSounds !== "pending") out.push(OWN_SOUNDS_MESSAGE[next.ownSounds]);
  if (prev.state !== "PASSED" && next.state === "PASSED") out.push("Self-test passed");
  return out;
}
