// Playback bar (DESIGN › Playback bar; prototype src/js/20-b-components.js C.playbackBar): play and pause, back and
// forward 5 s, a scrubber over the span ± 30 s, time, speaker and ×. It plays nothing itself: its owner calls the core.
import type { KeyboardEvent } from "react";

import { t } from "../../i18n/format";
import { Icon } from "../../ui/icons";
import { PRIM } from "../../ui/primitives/attrs";
import { IconButton } from "../../ui/primitives/icon-button";
import { clock } from "./model";
import { scrubRange, type BarState, type Replay } from "./playback";

export type BarVariant = "live-headphones" | "stored" | "search-and-ask";

export interface PlaybackBarProps {
  variant: BarVariant;
  state: Exclude<BarState, "CLOSED">;
  replay: Replay;
  position_ms: number;
  onToggle: () => void;
  onSeek: (ms: number) => void;
  onClose: () => void;
}

const CLS: Record<BarVariant, string> = { "live-headphones": "cw-pb cw-pb--live-headphones", stored: "cw-pb cw-pb--post-call", "search-and-ask": "cw-pb cw-pb--result" };

// @cpt-component:cpt-noter-component-ui-playback-bar:p1
// @cpt-dod:cpt-noter-dod-ui-live-transcript-replay:p1
export function PlaybackBar({ variant, state, replay, position_ms, onToggle, onSeek, onClose }: PlaybackBarProps) {
  const cls = CLS[variant];
  const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-route-stop
  if (state === "STOPPED_BY_ROUTE") {
    return (
      <div data-component="cpt-noter-component-ui-playback-bar" data-variant={variant} data-state="stopped-by-route" className={cls} role="group" aria-label={t("playback.label")}>
        <Icon name="info" size={13} />
        <span role="status">{t("playback.stopped_by_route")}</span>
      </div>
    );
  }
  // @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-route-stop
  const playing = state === "PLAYING" || state === "LOADING";
  const range = scrubRange(replay);
  const at = Math.min(range.max, Math.max(range.min, position_ms));
  const seek = (ms: number) => onSeek(Math.min(range.max, Math.max(range.min, ms)));
  return (
    <div data-component="cpt-noter-component-ui-playback-bar" data-variant={variant} data-state={state.toLowerCase().replace(/_/g, "-")} className={cls} role="group" aria-label={t("playback.label")} onKeyDown={onKeyDown}>
      <IconButton icon={playing ? "pause" : "play"} label={playing ? t("playback.pause") : t("playback.play")} size="inline" state={state === "LOADING" ? "loading" : undefined} onAction={onToggle} />
      <IconButton icon="back" label={t("playback.back")} size="inline" onAction={() => seek(at - 5000)} />
      <IconButton icon="forward" label={t("playback.forward")} size="inline" onAction={() => seek(at + 5000)} />
      <input
        type="range"
        className="cw-pb__scrub"
        data-component={PRIM}
        data-primitive="slider"
        data-variant="scrubber"
        min={range.min}
        max={range.max}
        step={1000}
        value={at}
        aria-label={t("playback.position")}
        aria-valuetext={clock(at)}
        onChange={(e) => seek(Number(e.target.value))}
      />
      <span className="np-tnum cw-pb__time">{clock(at)}</span>
      <span className="cw-pb__spk" title={replay.speaker}>
        {replay.speaker}
      </span>
      {variant === "live-headphones" && (
        <span className="cw-pb__line">
          <Icon name="headphones" size={13} /> {t("playback.live_headphones")}
        </span>
      )}
      <span className="np-tb__spacer" />
      <IconButton icon="x" label={t("playback.close")} size="inline" onAction={onClose} />
    </div>
  );
}
