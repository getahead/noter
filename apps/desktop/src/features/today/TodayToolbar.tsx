// TD-R1: Today's toolbar. The shell's toolbar with the long date, **Record**, and while a call is captured the
// recording indicator, which opens the call window.
import { useEffect, useMemo, useState } from "react";

import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import { RecordingIndicator } from "../call-window/strip";
import { elapsedSeconds, isLive } from "../shell/live-row";
import type { PageToolbarProps } from "../shell/pages";
import { tickWhile } from "../shell/shell-effects";
import { MainToolbar } from "../shell/toolbar";
import { record, showCall } from "./actions";
import { useToday } from "./cache";
import { recordBlock } from "./model";

export const clockOf = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const longDate = (d: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date(`${d}T12:00:00`));

// @cpt-component:cpt-noter-component-screen-today:p1
export function TodayToolbar({ bridge, base }: PageToolbarProps) {
  const view = useToday();
  const capture = useWindow(bridge, (s) => s.whole.capture);
  const setup = useWindow(bridge, (s) => s.whole.setup);
  const env = useWindow(bridge, (s) => s.whole.environment);
  const recording = useWindow(bridge, (s) => s.commands["today:record"]);
  const receivedAt = useMemo(() => Date.now(), [capture?.version]);
  const [now, setNow] = useState(() => Date.now());
  const ticking = capture?.phase === "recording";
  useEffect(() => tickWhile(ticking, setNow), [ticking]);
  const block = recordBlock(setup, env);
  const live = capture && isLive(capture);
  // @cpt-begin:cpt-noter-flow-ui-today-capture:p1:inst-live
  const indicator =
    live && capture ? (
      <button type="button" className="td-live" title={t("today.recording_help")} aria-label={t("today.recording_help")} onClick={() => void showCall(bridge)}>
        <RecordingIndicator variant="dot-text" status={capture.phase === "paused" ? "paused" : "recording"} clock={clockOf(elapsedSeconds(capture, receivedAt, Math.max(now, receivedAt)))} />
      </button>
    ) : (
      <PushButton
        label={t("today.record")}
        variant="primary"
        help={block ? t(block === "model_missing" ? "today.record_model_missing" : "today.record_disk_full") : t("today.record_help")}
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
