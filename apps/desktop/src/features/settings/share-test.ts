import type { CaptureTestOutcome, NoterSurface, PermissionState, ShareTestRow, ShareVisibility } from "../../core/bindings";
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
