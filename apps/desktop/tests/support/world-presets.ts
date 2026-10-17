// Starting states of the DESIGN.md 3.6 stories, as mutations of the fixture world
// (contracts/fixtures/world.json). The fixture starts mid-call: "Planning: VHI 8.0 drawer
// redesign" (`call_live`) is recording on the Studio Display, setup is complete, both audio
// permissions are granted and the output is headphones. Each preset changes only what its
// story's preconditions say.

import type { CallDetection, CaptureNotice, DegradedState, PermissionKind, PermissionState } from "../../src/core/bindings";
import type { World } from "./scenario";

export const LIVE_CALL = "call_live";
export const PAST_CALL = "call_backend";
export const LIVE_TITLE = "Planning: VHI 8.0 drawer redesign";
export const STUDIO_DISPLAY = "dsp_studio";
export const BUILTIN_DISPLAY = "dsp_builtin";
export const MIN = 60_000;

export const APPS = {
  teams: { app_name: "Microsoft Teams", bundle_id: "com.microsoft.teams2" },
  zoom: { app_name: "Zoom", bundle_id: "us.zoom.xos" },
  safari: { app_name: "Safari", bundle_id: "com.apple.Safari" },
  slack: { app_name: "Slack", bundle_id: "com.tinyspeck.slackmacgap" },
} as const;

/** No call is being recorded (the copilot keeps its fixture state; it is not part of M0/M1). */
export function idle(w: World): void {
  Object.assign(w.app.capture, {
    phase: "idle",
    call_id: null,
    title: null,
    started_at: null,
    recorded_ms: 0,
    sensitive: false,
    pause: null,
    notice: null,
    continue_until: null,
  });
}

/** A call app starts using the microphone: the record prompt appears. */
export function detect(w: World, app: { app_name: string; bundle_id: string }, blocked: CallDetection["blocked"] = null): CallDetection {
  const at = Date.now();
  const detection: CallDetection = { id: `det_${app.bundle_id}`, ...app, matched_event: null, detected_at: at, prompt_until: at + 30_000, blocked };
  w.app.detection.detection = detection;
  return detection;
}

/** A capture notice on the live call. */
export function notice(w: World, n: CaptureNotice): void {
  w.app.capture.notice = n;
}

export function degrade(w: World, state: DegradedState): void {
  w.app.degraded.states = [...w.app.degraded.states.filter((d) => d.type !== state.type), state];
}

export function recover(w: World, type: DegradedState["type"]): void {
  w.app.degraded.states = w.app.degraded.states.filter((d) => d.type !== type);
}

/** The permission row as both the setup status and the environment report it. */
export function permission(w: World, kind: PermissionKind, state: PermissionState): void {
  for (const rows of [w.app.setup.permissions, w.app.environment.permissions]) {
    const row = rows.find((p) => p.kind === kind);
    if (row) row.state = state;
    else rows.push({ kind, state });
  }
}

/** Noter opened for the first time: every step after Welcome to do, nothing granted, nothing tested. */
export function firstRun(w: World, opts: { modelsReady?: boolean } = {}): void {
  idle(w);
  w.app.detection.detection = null;
  const s = w.app.setup;
  s.complete = false;
  s.detection_enabled = false;
  s.self_test = { type: "not_run" };
  s.call_display = null;
  s.steps.forEach((row) => (row.state = row.step === "welcome" ? "done" : "todo"));
  if (opts.modelsReady === false) {
    s.models.bundles.forEach((b) => Object.assign(b, { state: "pending", done_mb: 0 }));
    s.models.done_mb = 0;
  } else s.steps.find((row) => row.step === "models")!.state = "done";
  for (const kind of ["microphone", "system_audio", "calendar", "notifications"] as const) permission(w, kind, "not_asked");
}

/** The speech model (the bundle capture needs first) and its state. */
export function speechModel(w: World) {
  return w.app.setup.models.bundles.find((b) => b.required_for_capture)!;
}

/** Setup finished except the audio self-test (Skip for Now): call detection stays off. */
export function selfTestSkipped(w: World): void {
  w.app.setup.self_test = { type: "skipped" };
  w.app.setup.detection_enabled = false;
  w.app.setup.steps.find((row) => row.step === "permissions")!.state = "skipped";
}

/** Only the laptop screen is connected. */
export function laptopOnly(w: World): void {
  w.app.environment.displays = w.app.environment.displays.filter((d) => d.is_main);
}

/** More past calls, copies of "Backend sync" with their own ids and titles. */
export function morePastCalls(w: World, n: number): string[] {
  const base = w.calls.find((c) => c.id === PAST_CALL)!;
  return Array.from({ length: n }, (_, i) => {
    const id = `${PAST_CALL}_${i + 2}`;
    w.calls.push({ ...structuredClone(base), id, title: `${base.title} #${i + 2}`, started_at: base.started_at - (i + 1) * 86_400_000 });
    return id;
  });
}
