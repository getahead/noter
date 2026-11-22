import { useEffect, useMemo, useState } from "react";

import type { CaptureState } from "../../core/bindings";
import { elapsedSeconds, receivedAtOf } from "../shell/live-row";
import { tickWhile } from "../shell/shell-effects";

/** The same capture clock in the toolbar and unmatched card, in seconds; paused audio time stays fixed. */
// @cpt-flow:cpt-noter-flow-ui-today-capture:p1
export function useRecordingClock(capture: CaptureState | undefined): number {
  const receivedAt = useMemo(() => receivedAtOf(capture), [capture?.version]);
  const [now, setNow] = useState(() => Date.now());
  const ticking = capture?.phase === "recording";
  useEffect(() => tickWhile(ticking, setNow), [ticking]);
  return capture ? elapsedSeconds(capture, receivedAt, Math.max(now, receivedAt)) : 0;
}
