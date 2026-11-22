// TD-R1: Today's toolbar. The shell's toolbar with the long date, **Record**, and while a call is captured the
// recording indicator, which opens the call window.
import { useWindow } from "../../app/use-window";
import { shortCallTime, t, zoned } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import { isLive } from "../shell/live-row";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";
import { record, showCall } from "./actions";
import { useToday } from "./cache";
import { useRecordingClock } from "./clock";
import { recordBlock } from "./model";
import { hotkeyCaps } from "../settings/hotkey-rows";

// the long date without the year (TD-R1 "Thursday 16 October"), in the macOS locale's order
const longDate = (d: string) => zoned(new Date(`${d}T12:00:00`).getTime(), { weekday: "long", month: "long", day: "numeric" }, undefined);

// @cpt-component:cpt-noter-component-screen-today:p1
export function TodayToolbar({ bridge, base }: PageToolbarProps) {
  const view = useToday();
  const capture = useWindow(bridge, (s) => s.whole.capture);
  const setup = useWindow(bridge, (s) => s.whole.setup);
  const env = useWindow(bridge, (s) => s.whole.environment);
  const hotkeys = useWindow(bridge, (s) => s.whole.hotkeys);
  const recordKey = hotkeyCaps(hotkeys, "start_stop", "⌃⌥⌘R");
  const recording = useWindow(bridge, (s) => s.commands["today:record"]);
  const clock = useRecordingClock(capture);
  const block = recordBlock(setup, env);
  const live = capture && isLive(capture);
  // @cpt-begin:cpt-noter-flow-ui-today-capture:p1:inst-live
  const indicator =
    live && capture ? (
      // the recording indicator's button variant: the dot and the MM:SS clock, no word (● 23:14)
      <button type="button" className="np-btn np-btn--secondary np-btn--regular np-recind np-recind--button td-live" data-component="cpt-noter-component-ui-recording-indicator" data-variant="button" data-state={capture.phase === "paused" ? "paused" : "recording"} title={t("today.recording_help")} aria-label={t("today.recording_help")} onClick={() => void showCall(bridge)}>
        <span className={capture.phase === "paused" ? "np-recdot is-paused" : "np-recdot"} aria-hidden="true" />
        <span className="np-tnum">{shortCallTime(clock)}</span>
      </button>
    ) : (
      <PushButton
        label={t("today.record")}
        icon="record"
        cls="td-recbtn"
        help={block ? t(block === "model_missing" ? "today.record_model_missing" : "today.record_disk_full") : recordKey ? t("today.record_help", { key: recordKey }) : t("today.record_help_unbound")}
        disabled={block !== null}
        loading={recording?.state === "WAITING"}
        onAction={() => void record(bridge)}
      />
    );
  // @cpt-end:cpt-noter-flow-ui-today-capture:p1:inst-live
  // a refused Record names why; the next attempt clears it (the command's slot starts over)
  const refused = recording?.state === "ERROR" ? recording.error : undefined;
  const refusal = refused && t(refused.state === "model_missing" ? "today.record_model_missing" : refused.state === "disk_full" ? "today.record_disk_full" : refused.state === "already_recording" ? "today.record_already" : "today.record_failed");
  const trailing = (
    <>
      {refusal && <span role="status" className="td-refused">{refusal}</span>}
      {indicator}
    </>
  );
  return <MainToolbar {...base} region="TD-R1" title={t("today.title")} subtitle={view ? longDate(view.date) : undefined} trailing={trailing} />;
}
