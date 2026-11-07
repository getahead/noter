import { useEffect, useMemo, useState } from "react";

import type { CaptureState } from "../../core/bindings";
import { elapsedSeconds } from "../shell/live-row";
import { tickWhile } from "../shell/shell-effects";

export const clockOf = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, "0")}`;

/** The same capture clock in the toolbar and unmatched card; paused audio time stays fixed. */
// @cpt-flow:cpt-noter-flow-ui-today-capture:p1
export function useRecordingClock(capture: CaptureState | undefined): string {
  const receivedAt = useMemo(() => Date.now(), [capture?.version]);
  const [now, setNow] = useState(() => Date.now());
  const ticking = capture?.phase === "recording";
  useEffect(() => tickWhile(ticking, setNow), [ticking]);
  return clockOf(capture ? elapsedSeconds(capture, receivedAt, Math.max(now, receivedAt)) : 0);
}
