// The transcript as its hosts mount it: the call screen (CS-R2, CS-R2b), the floating panel (FP-R5) and the call page
// (PC-R5, PC-R6). `useTranscript` holds the Channel, the replay and the play-control rule; `TranscriptPanel` draws the
// view and the playback bar in the host's regions. Hosts pass the call id and the variant; nothing else.
import { useEffect, useMemo, useRef, useState } from "react";

import type { CallDetail, SegmentView, TimeSpan, UiPrefs } from "../../core/bindings";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { duration, t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { buildRows, speakerColumn, spanKeys, type Row, type Variant } from "./model";
import { barState, ROUTE_STOP_MS, type Replay } from "./playback";
import { PlaybackBar, type BarVariant } from "./playback-bar";
import { playControl, REFUSED } from "./play-control";
import { TranscriptView } from "./transcript-view";

const HIGHLIGHT_MS = 3000;

export interface TranscriptOptions {
  /** A span to show (evidence, search result): scrolled to and highlighted for 3 s. */
  span?: TimeSpan | null;
  /** The call's details (call page): audio retention and "Never store audio". */
  detail?: CallDetail | null;
  /** The host knows the audio is gone (deleted or never stored): no play controls. */
  audioKept?: boolean;
}

/**
 * Holds a Channel of the call while mounted (`null`: none). The end waits a tick, so StrictMode's second effect run
 * keeps the first subscription instead of opening another; a new call id replaces the Channel. Returns a resubscribe.
 */
export function useChannel(bridge: Bridge, cmd: ChannelCmd, callId: string | null): () => void {
  const held = useRef<string | null>(null);
  const ending = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => holdChannel(bridge, cmd, callId, held, ending), [bridge, cmd, callId]);
  return () => void (callId && bridge.subscribe(cmd, { call_id: callId }));
}

type ChannelCmd = "transcript_subscribe" | "levels_subscribe";
type Box<T> = { current: T };

/** The effect of `useChannel`: open the call's Channel unless it is already held; the cleanup ends it a tick later. */
export function holdChannel(bridge: Pick<Bridge, "subscribe" | "unsubscribe">, cmd: ChannelCmd, callId: string | null, held: Box<string | null>, ending: Box<ReturnType<typeof setTimeout> | null>) {
  if (ending.current) clearTimeout(ending.current);
  if (held.current !== callId) void (callId ? bridge.subscribe(cmd, { call_id: callId }) : bridge.unsubscribe(cmd));
  held.current = callId;
  return () => {
    ending.current = setTimeout(() => {
      if (held.current) void bridge.unsubscribe(cmd);
      held.current = null;
    }, 0);
  };
}

/** Run `fn` after `ms`; the returned cleanup cancels it (an effect's timer). */
export const after = (ms: number, fn: () => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/** Highlight the rows a span covers; when none of them is loaded, ask the core for the span's segments. */
export function showSpan(bridge: Pick<Bridge, "core">, span: TimeSpan, rows: readonly Row[], highlight: (keys: string[]) => void): void {
  const keys = spanKeys(rows, span);
  if (keys.length) return highlight(keys);
  void bridge.core.transcriptSpan({ span }).then((r) => r.status === "ok" && highlight(r.data.segments.map((s) => s.id)));
}

// @cpt-flow:cpt-noter-flow-ui-live-transcript-replay-line:p1
// @cpt-flow:cpt-noter-flow-ui-live-transcript-stored:p1
/**
 * The transcript of a call while mounted: the Channel (snapshot, then stream), the meters while waiting for speech,
 * the evidence highlight, the play-control rule and the replay. Call it once per call where the transcript lives (a
 * window that switches between the live log and the tail keeps one subscription), and draw with TranscriptLog and
 * TranscriptBar.
 */
export function useTranscript(bridge: Bridge, callId: string, o: TranscriptOptions = {}) {
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-follow:p1:inst-flush
  // the bridge flushes the Channel into this slice every 100 ms: confirmed appended, hypothesis replaced, gaps, marks and updates by identity
  const stream = useWindow(bridge, (s) => s.streams.transcript_subscribe);
  // @cpt-end:cpt-noter-flow-ui-live-transcript-follow:p1:inst-flush
  const levels = useWindow(bridge, (s) => s.streams.levels_subscribe?.data?.levels ?? null);
  const capture = useWindow(bridge, (s) => s.whole.capture);
  const playback = useWindow(bridge, (s) => s.whole.playback);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [refused, setRefused] = useState<{ key: string; text: string } | null>(null);
  const [highlight, setHighlight] = useState<string[]>([]);
  const data = stream?.data?.call_id === callId ? stream.data : null;

  // @cpt-begin:cpt-noter-flow-ui-live-transcript-follow:p1:inst-mount
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-follow:p1:inst-api-subscribe
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-stored:p1:inst-mount-stored
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-stored:p1:inst-api-stored
  const subscribe = useChannel(bridge, "transcript_subscribe", callId);
  // @cpt-end:cpt-noter-flow-ui-live-transcript-stored:p1:inst-api-stored
  // @cpt-end:cpt-noter-flow-ui-live-transcript-stored:p1:inst-mount-stored
  // @cpt-end:cpt-noter-flow-ui-live-transcript-follow:p1:inst-api-subscribe
  // @cpt-end:cpt-noter-flow-ui-live-transcript-follow:p1:inst-mount

  const rows = useMemo(() => (data ? buildRows(data, "stored") : []), [data]);
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-follow:p1:inst-if-waiting
  const waiting = !!data?.live && data.segments.length === 0 && data.hypotheses.length === 0;
  // @cpt-end:cpt-noter-flow-ui-live-transcript-follow:p1:inst-if-waiting
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-follow:p1:inst-waiting
  useChannel(bridge, "levels_subscribe", waiting ? callId : null);
  // @cpt-end:cpt-noter-flow-ui-live-transcript-follow:p1:inst-waiting

  // @cpt-begin:cpt-noter-flow-ui-live-transcript-stored:p1:inst-if-span
  const span = o.span;
  const loaded = !!data;
  useEffect(() => void (span && loaded && showSpan(bridge, span, rows, setHighlight)), [span, loaded]);
  useEffect(() => (highlight.length ? after(HIGHLIGHT_MS, () => setHighlight([])) : undefined), [highlight]);
  // @cpt-end:cpt-noter-flow-ui-live-transcript-stored:p1:inst-if-span

  const audio = o.audioKept !== false && !!data?.audio_available && !o.detail?.call.audio_deleted && !o.detail?.audio_not_stored && !(capture?.call_id === callId && capture.audio_not_stored);
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-user-hover
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-play-control
  const control = (row: Row) =>
    row.kind === "segment" || row.kind === "hypothesis" ? playControl({ seg: row.seg, hypothesis: row.kind === "hypothesis", audio, gaps: data?.gaps ?? [], capture }) : undefined;
  // @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-play-control
  // @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-user-hover

  const bar = barState(replay, playback);
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-if-route
  useEffect(() => (bar === "STOPPED_BY_ROUTE" ? after(ROUTE_STOP_MS, () => setReplay(null)) : undefined), [bar]);
  // @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-if-route

  const start = async (r: Omit<Replay, "since" | "paused">) => {
    setReplay({ ...r, since: playback?.version ?? 0, paused: false });
    // @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-api-play
    const res = await bridge.act("audio_play", "audio_play", () => bridge.core.audioPlay({ call_id: r.call_id, from_ms: r.from_ms, to_ms: r.to_ms }), { slice: "playback", named: REFUSED });
    // @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-api-play
    if (res.status === "ok") return;
    setReplay(null);
    const reason = REFUSED[res.error.code];
    if (reason) setRefused({ key: r.key, text: t(reason) });
  };
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-if-stop
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-api-stop
  const stop = () => bridge.act("audio_stop", "audio_stop", () => bridge.core.audioStop({}), { slice: "playback" });
  // @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-api-stop
  // @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-if-stop
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-if-play
  const play = async (seg: SegmentView) => {
    if (bar === "PLAYING") await stop();
    await start({ key: seg.id, call_id: seg.call_id, from_ms: seg.t0_ms, to_ms: seg.t1_ms, speaker: speakerColumn(seg, data?.speakers ?? []).text });
  };
  // @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-if-play
  const fresh = playback && replay && playback.call_id === replay.call_id && playback.version > replay.since;
  const position = fresh ? playback.position_ms : (replay?.from_ms ?? 0);

  return {
    bridge,
    callId,
    detail: o.detail ?? null,
    data,
    rows,
    waiting,
    levels,
    control,
    refused,
    clearRefused: () => setRefused(null),
    highlight,
    loading: !!stream?.slow,
    error: stream?.error ?? null,
    retry: subscribe,
    replay,
    bar,
    position,
    playingKey: bar === "PLAYING" ? (replay?.key ?? null) : null,
    play,
    // @cpt-begin:cpt-noter-state-ui-live-transcript-playback:p1:inst-playing-paused
    toggle: () => {
      if (!replay) return;
      if (bar === "PLAYING" || bar === "LOADING") return void stop().then(() => setReplay((r) => r && { ...r, paused: true }));
      void start({ ...replay, from_ms: bar === "ENDED" ? replay.from_ms : position });
    },
    // @cpt-end:cpt-noter-state-ui-live-transcript-playback:p1:inst-playing-paused
    seek: (ms: number) => replay && void start({ ...replay, from_ms: ms }),
    close: () => {
      setReplay(null);
      void stop();
    },
  };
}

export type TranscriptHandle = ReturnType<typeof useTranscript>;

// D-36: M1 shows no deletion date ("audio_deleted_at" comes in M2)
/** The stored variant's header line about the audio: kept until, deleted, or never stored. */
export function audioLine(detail: CallDetail | null | undefined, prefs: UiPrefs | undefined): string | null {
  if (!detail) return null;
  const { call } = detail;
  if (detail.audio_not_stored) return t("transcript.audio.not_stored");
  if (call.audio_deleted) return t("transcript.audio.deleted");
  if (call.audio_kept_until == null || !prefs) return null;
  const date = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: prefs.time_zone || undefined }).format(call.audio_kept_until);
  return t("transcript.audio.kept", { length: duration(call.duration_ms / 1000), date });
}

export interface TranscriptLogProps {
  tr: TranscriptHandle;
  variant: Variant;
  /** Tail lines: 3, or 8 when the copilot is off (FP-R5). */
  tailLines?: number;
  /** The stored variant's audio line; by default from the call's details. */
  header?: string | null;
}

/** The transcript view of `useTranscript`'s call, in the host's region (CS-R2, FP-R5 or PC-R5). */
export function TranscriptLog({ tr, variant, tailLines, header }: TranscriptLogProps) {
  const prefs = useWindow(tr.bridge, (s) => s.app?.prefs);
  const rows = useMemo(() => (variant === "tail" && tr.data ? buildRows(tr.data, "tail", tailLines) : tr.rows), [variant, tr.data, tr.rows, tailLines]);
  const line = header !== undefined ? header : variant === "stored" ? audioLine(tr.detail, prefs) : null;
  const gone = !!tr.detail && (tr.detail.call.audio_deleted || tr.detail.audio_not_stored);
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-stored:p1:inst-return-stored
  const error = tr.error && <InlineBanner banner={{ id: "transcript-error", severity: "error", text: t("transcript.error"), actions: [{ label: t("action.try_again"), onAction: tr.retry }] }} />;
  // @cpt-end:cpt-noter-flow-ui-live-transcript-stored:p1:inst-return-stored
  return (
    <TranscriptView
      key={tr.callId}
      variant={variant}
      rows={rows}
      speakers={tr.data?.speakers ?? []}
      loaded={!!tr.data}
      loading={tr.loading}
      waiting={variant !== "stored" && tr.waiting}
      levels={tr.levels}
      error={error || undefined}
      header={line}
      control={tr.control}
      playingKey={tr.playingKey}
      highlight={tr.highlight}
      refused={tr.refused}
      onRefusedDone={tr.clearRefused}
      timeHelp={gone ? (tr.detail!.audio_not_stored ? t("transcript.audio.not_stored") : t("transcript.audio.deleted_help")) : undefined}
      onPlay={(seg) => void tr.play(seg)}
    />
  );
}

const BAR: Record<Variant, { region?: string; cls?: string; variant: BarVariant }> = {
  live: { region: "CS-R2b", cls: "cs-r2b", variant: "live-headphones" },
  tail: { variant: "live-headphones" }, // in FP-R5, in the tail's place
  stored: { region: "PC-R6", cls: "pc-play", variant: "stored" },
};

// @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-bar
/** The playback bar while a line replays: CS-R2b under the live log, PC-R6 on the call page; in the floating panel the
 *  host draws it in FP-R5 instead of the tail. Nothing while closed. */
export function TranscriptBar({ tr, variant }: { tr: TranscriptHandle; variant: Variant }) {
  if (!tr.replay || tr.bar === "CLOSED") return null;
  const b = BAR[variant];
  const bar = <PlaybackBar variant={b.variant} state={tr.bar} replay={tr.replay} position_ms={tr.position} onToggle={tr.toggle} onSeek={tr.seek} onClose={tr.close} />;
  return b.region ? (
    <div data-region={b.region} className={b.cls}>
      {bar}
    </div>
  ) : (
    bar
  );
}
// @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-bar

/** The call screen until the call window (2.10) lands around it: the capture's call, live, in CS-R2 and CS-R2b. */
export function CallScreenTranscript({ bridge }: { bridge: Bridge }) {
  const callId = useWindow(bridge, (s) => s.whole.capture?.call_id ?? null);
  return callId ? <LiveHost bridge={bridge} callId={callId} /> : null;
}

function LiveHost({ bridge, callId }: { bridge: Bridge; callId: string }) {
  const tr = useTranscript(bridge, callId);
  return (
    <div className="tr-window">
      <section data-region="CS-R2" className="cs-r2" aria-label={t("transcript.label")}>
        <TranscriptLog tr={tr} variant="live" />
      </section>
      <TranscriptBar tr={tr} variant="live" />
    </div>
  );
}

/**
 * A call's stored transcript for the call page's PC-R5 (the page draws the region and its heading): the audio line,
 * the view with its play controls, and the playback bar in PC-R6. It reads the call's details for the audio line.
 */
export function StoredTranscript({ bridge, callId, audioKept, span }: { bridge: Bridge; callId: string; audioKept?: boolean; span?: TimeSpan | null }) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  useEffect(() => void bridge.core.callGet({ call_id: callId }).then((r) => r.status === "ok" && setDetail(r.data)), [bridge, callId]);
  const tr = useTranscript(bridge, callId, { detail, audioKept, span });
  return (
    <>
      <TranscriptLog tr={tr} variant="stored" />
      <TranscriptBar tr={tr} variant="stored" />
    </>
  );
}

/** Dev server only (App's `#transcript=<call id>`): the stored transcript in a PC-R5 of its own, until the call page lands. */
export function StoredTranscriptRoute({ bridge, callId }: { bridge: Bridge; callId: string }) {
  return (
    <div className="tr-window">
      <section data-region="PC-R5" className="pc-tr" aria-label={t("transcript.label")}>
        <StoredTranscript bridge={bridge} callId={callId} />
      </section>
    </div>
  );
}
