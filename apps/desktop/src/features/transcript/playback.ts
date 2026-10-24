// The playback bar's state from the replay the user asked for and the core's `playback:state` (the bar plays nothing:
// the core plays natively and reports, D6).
import type { PlaybackState } from "../../core/bindings";

/** A replay the user started from a row: the bar is open until closed. */
export interface Replay {
  /** The row it plays. */
  key: string;
  call_id: string;
  from_ms: number;
  to_ms: number | null;
  speaker: string;
  /** `playback:state` version when it was asked for: older reports are not about it. */
  since: number;
  paused: boolean;
}

export type BarState = "CLOSED" | "LOADING" | "PLAYING" | "PAUSED" | "ENDED" | "STOPPED_BY_ROUTE";

/** How long **Replay stopped: output switched to speakers** stays before the bar closes. */
export const ROUTE_STOP_MS = 3000;

// @cpt-state:cpt-noter-state-ui-live-transcript-playback:p1
export function barState(replay: Replay | null, pb: PlaybackState | undefined): BarState {
  // @cpt-begin:cpt-noter-state-ui-live-transcript-playback:p1:inst-playing-closed
  // @cpt-begin:cpt-noter-state-ui-live-transcript-playback:p1:inst-route-closed
  if (!replay) return "CLOSED";
  // @cpt-end:cpt-noter-state-ui-live-transcript-playback:p1:inst-route-closed
  // @cpt-end:cpt-noter-state-ui-live-transcript-playback:p1:inst-playing-closed
  const fresh = pb && pb.version > replay.since && pb.call_id === replay.call_id ? pb : null;
  // @cpt-begin:cpt-noter-state-ui-live-transcript-playback:p1:inst-playing-route
  if (fresh && !fresh.playing && fresh.stopped_reason === "output_switched_to_speakers") return "STOPPED_BY_ROUTE";
  // @cpt-end:cpt-noter-state-ui-live-transcript-playback:p1:inst-playing-route
  // @cpt-begin:cpt-noter-state-ui-live-transcript-playback:p1:inst-playing-paused
  if (replay.paused) return "PAUSED";
  // @cpt-end:cpt-noter-state-ui-live-transcript-playback:p1:inst-playing-paused
  // @cpt-begin:cpt-noter-state-ui-live-transcript-playback:p1:inst-loading-playing
  // @cpt-begin:cpt-noter-state-ui-live-transcript-playback:p1:inst-paused-playing
  if (fresh?.playing) return "PLAYING";
  // @cpt-end:cpt-noter-state-ui-live-transcript-playback:p1:inst-paused-playing
  // @cpt-end:cpt-noter-state-ui-live-transcript-playback:p1:inst-loading-playing
  // @cpt-begin:cpt-noter-state-ui-live-transcript-playback:p1:inst-playing-ended
  if (fresh?.stopped_reason) return "ENDED";
  // @cpt-end:cpt-noter-state-ui-live-transcript-playback:p1:inst-playing-ended
  // @cpt-begin:cpt-noter-state-ui-live-transcript-playback:p1:inst-closed-loading
  return "LOADING";
  // @cpt-end:cpt-noter-state-ui-live-transcript-playback:p1:inst-closed-loading
}

/** The scrubber covers the span plus or minus 30 s (DESIGN › Playback bar). */
export function scrubRange(r: Pick<Replay, "from_ms" | "to_ms">): { min: number; max: number } {
  return { min: Math.max(0, r.from_ms - 30_000), max: (r.to_ms ?? r.from_ms) + 30_000 };
}
