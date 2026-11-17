// The playback bar under an answer (AK-R5): a citation's Play starts a replay; the bar follows the core's `playback:state`.
import { useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { TimeSpan } from "../../core/bindings";
import { barState, ROUTE_STOP_MS, type Replay } from "../transcript/playback";
import { playAudio, replayOf, stopAudio } from "./actions";

export function useAskReplay(bridge: Bridge) {
  const playback = useWindow(bridge, (s) => s.whole.playback);
  const [replay, setReplay] = useState<Replay | null>(null);
  const bar = barState(replay, playback);
  useEffect(() => {
    if (bar !== "STOPPED_BY_ROUTE") return;
    const h = setTimeout(() => setReplay(null), ROUTE_STOP_MS);
    return () => clearTimeout(h);
  }, [bar]);
  const fresh = playback && replay && playback.call_id === replay.call_id && playback.version > replay.since;
  const position = fresh ? playback.position_ms : (replay?.from_ms ?? 0);
  const start = async (r: Replay) => {
    setReplay({ ...r, since: playback?.version ?? 0, paused: false });
    const res = await playAudio(bridge, r.call_id, r.from_ms, r.to_ms);
    if (res.status !== "ok") setReplay(null);
  };
  return {
    replay,
    bar,
    position,
    play: (span: TimeSpan) => start(replayOf(span, playback?.version ?? 0)),
    toggle: () => {
      if (!replay) return;
      if (bar === "PLAYING" || bar === "LOADING") return void stopAudio(bridge).then(() => setReplay((r) => r && { ...r, paused: true }));
      void start({ ...replay, from_ms: bar === "ENDED" ? replay.from_ms : position });
    },
    seek: (ms: number) => replay && void start({ ...replay, from_ms: ms }),
    close: () => (setReplay(null), void stopAudio(bridge)),
  };
}
