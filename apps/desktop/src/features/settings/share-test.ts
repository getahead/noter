import type { Bridge } from "../../app/bridge/bridge";
import type { CaptureTestOutcome, NoterSurface, PermissionState, ShareTestResult, ShareTestRow, ShareVisibility } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";

export type ShareTestState = "TABLE" | "ASKING" | "RUNNING" | "RAN" | "NEEDS_PERMISSION" | "FAILED";

export type ShareTestEvent =
  /** **Run Capture Test**: with Screen Recording not granted, the test-only permission row asks first. */
  | { type: "run"; screenRecording: PermissionState }
  /** **Continue** on the permission row, and the answer macOS gave. */
  | { type: "answered"; granted: boolean }
  | { type: "outcome"; outcome: CaptureTestOutcome };

export function shareTestReduce(s: ShareTestState, e: ShareTestEvent): ShareTestState {
  switch (e.type) {
    case "run":
      return s === "RUNNING" ? s : e.screenRecording === "granted" ? "RUNNING" : "ASKING";
    case "answered":
      return s === "ASKING" ? (e.granted ? "RUNNING" : "NEEDS_PERMISSION") : s;
    case "outcome":
      if (s !== "RUNNING") return s;
      return e.outcome.type === "passed" ? "RAN" : e.outcome.type === "failed" ? "FAILED" : "TABLE";
  }
}

const VISIBILITY: Record<ShareVisibility, MsgKey> = { hidden: "settings.share.hidden", visible: "settings.share.visible", depends_on_app: "settings.share.maybe" };
const SURFACE: Record<NoterSurface, MsgKey> = {
  call_window: "settings.share.surface_call_window",
  record_prompt: "settings.share.surface_record_prompt",
  main_window: "settings.share.surface_main_window",
  settings_window: "settings.share.surface_settings_window",
  menu_bar_title: "settings.share.surface_menu_bar_title",
};

export const visibilityKey = (v: ShareVisibility): MsgKey => VISIBILITY[v];
export const surfaceKey = (s: NoterSurface): MsgKey => SURFACE[s];

/** One result row per surface after the capture test, judged by what a window share sees. */
export function resultRows(rows: readonly ShareTestRow[]): { surface: NoterSurface; message: MsgKey; ok: boolean }[] {
  const message = (v: ShareVisibility): MsgKey => (v === "hidden" ? "settings.share.result_hidden" : v === "visible" ? "settings.share.result_visible" : "settings.share.result_maybe");
  return rows.map((r) => ({ surface: r.surface, message: message(r.window_share), ok: r.window_share === "hidden" }));
}

// @cpt-begin:cpt-noter-flow-ui-settings-share-test:p1:inst-api-share
/** `share_test_run`: the table, and with the capture test its outcome; a refusal is a failed capture. */
export async function runShareTest(bridge: Bridge, capture: boolean): Promise<{ result: ShareTestResult | null; outcome: CaptureTestOutcome | null }> {
  const res = await bridge.act("share:run", "share_test_run", () => bridge.core.shareTestRun({ run_capture_test: capture }));
  if (res.status === "ok") return { result: res.data, outcome: capture ? res.data.capture_test : null };
  return { result: null, outcome: capture ? { type: "failed", code: res.error.code } : null };
}
// @cpt-end:cpt-noter-flow-ui-settings-share-test:p1:inst-api-share

/** **Continue** on the test-only row: macOS asks once; true when it was granted. */
export async function askScreenRecording(bridge: Bridge): Promise<boolean> {
  const res = await bridge.act("share:permission", "permission_request", () => bridge.core.permissionRequest({ kind: "screen_recording" }));
  return res.status === "ok";
}

export interface ShareActionsCtx {
  permission: PermissionState;
  dispatch: (e: ShareTestEvent) => void;
  setResult: (r: ShareTestResult) => void;
}

/** The sheet's three commands: the table, **Run Capture Test**, and **Continue** on the test-only permission row. */
export function createShareActions(bridge: Bridge, ctx: ShareActionsCtx) {
  const run = async (capture: boolean) => {
    const { result, outcome } = await runShareTest(bridge, capture);
    if (result) ctx.setResult(result);
    if (outcome) ctx.dispatch({ type: "outcome", outcome });
  };
  // @cpt-begin:cpt-noter-flow-ui-settings-share-test:p1:inst-run-capture
  const start = () => {
    ctx.dispatch({ type: "run", screenRecording: ctx.permission });
    if (ctx.permission === "granted") void run(true);
  };
  const answer = async () => {
    const granted = await askScreenRecording(bridge);
    ctx.dispatch({ type: "answered", granted });
    if (granted) void run(true);
  };
  // @cpt-end:cpt-noter-flow-ui-settings-share-test:p1:inst-run-capture
  return { run, start, answer };
}
