// The play control of a row (DESIGN › Transcript segment row › the output-route table; D85). The row never decides
// whether replay is allowed: it shows what the core's capture state says.
import type { CapturePhase, CaptureState, ErrorCode, GapView, SegmentView } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";

export type PlayControl = { state: "hidden" } | { state: "enabled" | "disabled"; help: MsgKey };

/** Phases in which the call is being recorded: replay could reach the call. */
const CAPTURING: ReadonlySet<CapturePhase> = new Set(["starting", "recording", "paused", "failed"]);

export interface PlayInput {
  seg: SegmentView;
  hypothesis: boolean;
  /** Audio is kept for the call (not deleted by retention, not "Never store audio"). */
  audio: boolean;
  gaps: readonly GapView[];
  capture: Pick<CaptureState, "phase" | "call_id" | "output_route" | "replay_available"> | undefined;
}

/** The call is being recorded right now. */
export const capturing = (capture: PlayInput["capture"], callId: string) => !!capture && capture.call_id === callId && CAPTURING.has(capture.phase);

// @cpt-algo:cpt-noter-algo-ui-live-transcript-play-control:p1
export function playControl({ seg, hypothesis, audio, gaps, capture }: PlayInput): PlayControl {
  // @cpt-begin:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-hypothesis
  if (hypothesis) return { state: "hidden" };
  // @cpt-end:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-hypothesis
  // @cpt-begin:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-no-audio
  if (!audio) return { state: "hidden" };
  // @cpt-end:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-no-audio
  // @cpt-begin:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-gap-audio
  const lost = seg.channel === "sys" && gaps.some((g) => g.reason === "system_audio_silent" && g.t0_ms <= seg.t0_ms && g.t1_ms >= seg.t1_ms);
  if (lost) return { state: "disabled", help: "transcript.play.no_audio" };
  // @cpt-end:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-gap-audio
  // @cpt-begin:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-after-call
  if (!capture || !capturing(capture, seg.call_id)) return { state: "enabled", help: "transcript.play" };
  // @cpt-end:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-after-call
  // @cpt-begin:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-match-route
  switch (capture.output_route) {
    // @cpt-begin:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-case-headphones
    // @cpt-begin:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-case-own-sounds
    case "headphones":
      return capture.replay_available ? { state: "enabled", help: "transcript.play" } : { state: "disabled", help: "transcript.play.own_sounds" };
    // @cpt-end:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-case-own-sounds
    // @cpt-end:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-case-headphones
    // @cpt-begin:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-case-speakers
    case "speakers":
      return { state: "disabled", help: "transcript.play.speakers" };
    // @cpt-end:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-case-speakers
    // @cpt-begin:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-case-unknown
    // @cpt-begin:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-return-control
    default:
      return { state: "disabled", help: "transcript.play.unknown" };
    // @cpt-end:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-return-control
    // @cpt-end:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-case-unknown
  }
  // @cpt-end:cpt-noter-algo-ui-live-transcript-play-control:p1:inst-match-route
}

// @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-play-refused
/** The reason a refused `audio_play` shows as an inline status on the control. */
export const REFUSED: Partial<Record<ErrorCode, MsgKey>> = {
  replay_needs_headphones: "transcript.play.speakers",
  output_route_unknown: "transcript.play.unknown",
  own_sounds_not_excluded: "transcript.play.own_sounds",
};
// @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-play-refused
