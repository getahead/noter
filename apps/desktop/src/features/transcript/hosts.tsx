// The transcript as its hosts mount it: the call screen (CS-R2, CS-R2b), the floating panel (FP-R5) and the call page
// (PC-R5, PC-R6). `useTranscript` holds the Channel, the replay and the play-control rule; `TranscriptPanel` draws the
// view and the playback bar in the host's regions. Hosts pass the call id and the variant; nothing else.
import { useEffect, useMemo, useRef, useState } from "react";

import type { CallDetail, SegmentView, SpeakerView, TextRange, TimeSpan, UiPrefs } from "../../core/bindings";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { duration, t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Menu } from "../../ui/primitives/menu";
import { Popover } from "../../ui/primitives/popover";
import { holdUndo } from "../history/undo";
import { SpeakerRenamePopover } from "../speakers/SpeakerRenamePopover";
import { SpeakerNamingPanel } from "../speakers/SpeakerNamingPanel";
import { rereadSegment, TermFixPopover } from "../speakers/TermFixPopover";
import { buildRows, speakerColumn, spanKeys, type Row, type Variant } from "./model";
import { barState, ROUTE_STOP_MS, type Replay } from "./playback";
import { PlaybackBar, type BarVariant } from "./playback-bar";
import { playControl, REFUSED } from "./play-control";
import { ArchiveNotice, type ArchiveNote } from "./ArchiveNotice";
import { followFixTermChoice, watchFixTermMenu } from "./fix-term-menu";
import { selectedFixTerm } from "./segment-row";
import { TranscriptView } from "./transcript-view";

const HIGHLIGHT_MS = 3000;

/** What the stored variant needs of a call's details: the call (audio deleted, kept until, length) and "Never store audio". */
export type AudioFacts = Pick<CallDetail, "call" | "audio_not_stored">;

export interface TranscriptOptions {
  /** A span to show (evidence, search result): scrolled to and highlighted for 3 s. */
  span?: TimeSpan | null;
  /** The call's details (call page): audio retention and "Never store audio". */
  detail?: AudioFacts | null;
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

/** What the archive pass did to an evidence span: its words before and after, `{ change: null }` when it replaced the lines, `null` for nothing to say. */
export async function spanArchiveNote(bridge: Pick<Bridge, "core">, span: TimeSpan, set: (note: ArchiveNote | null) => void): Promise<void> {
  // @cpt-begin:cpt-noter-flow-ui-items-evidence:p1:inst-archive
  const r = await bridge.core.transcriptSpan({ span });
  if (r.status === "ok") set(r.data.archive_change ? { change: r.data.archive_change } : null);
  else set(r.error.code === "transcript_upgraded" ? { change: null } : null);
  // @cpt-end:cpt-noter-flow-ui-items-evidence:p1:inst-archive
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
  const [archive, setArchive] = useState<ArchiveNote | null>(null);
  useEffect(() => void (span && loaded && showSpan(bridge, span, rows, setHighlight)), [span?.call_id, span?.t0_ms, span?.t1_ms, loaded]); // eslint-disable-line react-hooks/exhaustive-deps -- a new span object each render must not restart the 3 s highlight
  useEffect(() => void (span ? spanArchiveNote(bridge, span, setArchive) : setArchive(null)), [bridge, span?.call_id, span?.t0_ms, span?.t1_ms]); // eslint-disable-line react-hooks/exhaustive-deps
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
    archive,
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

/** The stored variant's header line about the audio: kept until, deleted, or never stored. */
export function audioLine(detail: AudioFacts | null | undefined, prefs: UiPrefs | undefined): string | null {
  if (!detail) return null;
  const { call } = detail;
  if (detail.audio_not_stored) return t("transcript.audio.not_stored");
  const day = (ms: number) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: prefs?.time_zone || undefined }).format(ms);
  // D-36: the deletion date when the core knows it (Call info reads the same field)
  if (call.audio_deleted) return call.audio_deleted_at == null ? t("transcript.audio.deleted") : t("transcript.audio.deleted_on", { date: day(call.audio_deleted_at) });
  if (call.audio_kept_until == null || !prefs) return null;
  const date = day(call.audio_kept_until);
  return t("transcript.audio.kept", { length: duration(call.duration_ms / 1000), date });
}

export interface TranscriptLogProps {
  tr: TranscriptHandle;
  variant: Variant;
  /** Tail lines: 3, or 8 when the copilot is off (FP-R5). */
  tailLines?: number;
  /** The stored variant's audio line; by default from the call's details. */
  header?: string | null;
  /** A speaker was named from a label: by default the undo strip carries the result; the call window shows it in its strip. */
  onNamed?: (text: string, change_id: string) => void;
}

/** The Undo strip of a term fix; Undo re-reads the line, which no Channel event restores. */
export const holdFix = (bridge: Bridge, seg: SegmentView) => (message: string, change_id: string) => holdUndo({ target: { type: "change", change_id }, message, refresh: () => rereadSegment(bridge, seg) });

/** The transcript view of `useTranscript`'s call, in the host's region (CS-R2, FP-R5 or PC-R5). */
export function TranscriptLog({ tr, variant, tailLines, header, onNamed }: TranscriptLogProps) {
  const [renaming, setRenaming] = useState<{ speakerId: string; segmentId: string; anchor: HTMLElement } | null>(null);
  // a selection on a stored line: first the Copy / Fix Term… menu, then the popover
  const [fixing, setFixing] = useState<{ seg: SegmentView; range: TextRange; anchor: HTMLElement; menu: boolean } | null>(null);
  const call = useWindow(tr.bridge, (s) => s.entities.call[tr.callId]);
  const prefs = useWindow(tr.bridge, (s) => s.app?.prefs);
  const rows = useMemo(() => (variant === "tail" && tr.data ? buildRows(tr.data, "tail", tailLines) : tr.rows), [variant, tr.data, tr.rows, tailLines]);
  const line = header !== undefined ? header : variant === "stored" ? audioLine(tr.detail, prefs) : null;
  const gone = !!tr.detail && (tr.detail.call.audio_deleted || tr.detail.audio_not_stored);
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-stored:p1:inst-return-stored
  const error = tr.error && <InlineBanner banner={{ id: "transcript-error", severity: "error", text: t("transcript.error"), actions: [{ label: t("action.try_again"), onAction: tr.retry }] }} />;
  // @cpt-end:cpt-noter-flow-ui-live-transcript-stored:p1:inst-return-stored
  const speakers = tr.data?.speakers ?? [];
  // The Edit menu's Fix Term…: enabled while confirmed words are selected, and it opens the term fix on them.
  const segments = tr.data?.segments;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  useEffect(() => (variant === "stored" ? watchFixTermMenu(document, () => globalThis.getSelection(), () => segmentsRef.current ?? [], (enabled) => void tr.bridge.core.windowSetFixTermEnabled({ enabled })) : undefined), [variant, tr.bridge]);
  const chosen = useWindow(tr.bridge, (s) => s.fixTerm);
  const handled = useRef(chosen);
  // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-open
  useEffect(() => followFixTermChoice(handled, chosen, () => (variant === "stored" ? selectedFixTerm(globalThis.getSelection(), segmentsRef.current ?? []) : null), (picked) => setFixing({ ...picked, menu: false })), [chosen, variant]);
  // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-open
  const renamed = renaming && speakers.find((x) => x.id === renaming.speakerId);
  const named = onNamed ?? ((message: string, change_id: string) => holdUndo({ target: { type: "change", change_id }, message }));
  return (
    <>
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
      onRename={variant === "tail" ? undefined : async (speakerId, seg, anchor) => {
        if (variant === "live") {
          const focused = await tr.bridge.act("window_show_call", "window_show_call", () => tr.bridge.core.windowShowCall({}), {});
          if (focused.status === "error") return;
        }
        setRenaming({ speakerId, segmentId: seg.id, anchor });
      }}
      // @cpt-begin:cpt-noter-flow-ui-speakers-fix-term:p1:inst-open
      onFixTerm={variant === "stored" ? (seg, range, anchor) => setFixing({ seg, range, anchor, menu: true }) : undefined}
      // @cpt-end:cpt-noter-flow-ui-speakers-fix-term:p1:inst-open
    />
    {fixing?.menu && (
      <Popover variant="context-menu" anchor={fixing.anchor} label={t("speakers.fix.menu")} onClose={() => setFixing(null)}>
        <Menu
          variant="context-menu"
          label={t("speakers.fix.menu")}
          items={[
            { label: t("speakers.fix.copy"), onSelect: () => void globalThis.navigator?.clipboard?.writeText(fixing.seg.text.slice(fixing.range.start, fixing.range.end)) },
            { label: t("speakers.fix.menu"), onSelect: () => setFixing({ ...fixing, menu: false }) },
          ]}
          onClose={() => setFixing((f) => (f?.menu ? null : f))}
        />
      </Popover>
    )}
    {fixing && !fixing.menu && (
      <TermFixPopover bridge={tr.bridge} segment={fixing.seg} range={fixing.range} anchor={fixing.anchor} onClose={() => setFixing(null)} onFixed={onNamed ?? holdFix(tr.bridge, fixing.seg)} />
    )}
    {renamed && (
      <SpeakerRenamePopover
        bridge={tr.bridge}
        callId={tr.callId}
        speaker={renamed}
        segmentId={renaming.segmentId}
        participants={tr.detail?.call.participants ?? call?.participants ?? []}
        speakers={speakers}
        anchor={renaming.anchor}
        onClose={() => setRenaming(null)}
        onNamed={named}
      />
    )}
    </>
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

/**
 * A call's stored transcript for the call page's PC-R5 (the page draws the region and its heading): the audio line,
 * the view with its play controls, and the playback bar in PC-R6. It reads the call's details for the audio line unless
 * the host passes them (`detail`); `header={null}` leaves the line to a host that draws it in its own heading.
 */
export function StoredTranscript({ bridge, callId, audioKept, span, detail, header }: { bridge: Bridge; callId: string; audioKept?: boolean; span?: TimeSpan | null; detail?: AudioFacts | null; header?: string | null }) {
  const [read, setRead] = useState<CallDetail | null>(null);
  const given = detail !== undefined;
  useEffect(() => void (!given && bridge.core.callGet({ call_id: callId }).then((r) => r.status === "ok" && setRead(r.data))), [bridge, callId, given]);
  const tr = useTranscript(bridge, callId, { detail: given ? detail : read, audioKept, span });
  return (
    <>
      <NamingPanel tr={tr} audioKept={audioKept} />
      {tr.archive && <ArchiveNotice note={tr.archive} />}
      <TranscriptLog tr={tr} variant="stored" header={header} />
      <TranscriptBar tr={tr} variant="stored" />
    </>
  );
}

function NamingPanel({ tr, audioKept }: { tr: ReturnType<typeof useTranscript>; audioKept?: boolean }) {
  return tr.data ? (
    <SpeakerNamingPanel
      bridge={tr.bridge}
      callId={tr.callId}
      speakers={tr.data.speakers}
      segments={tr.data.segments}
      participants={tr.detail?.call.participants ?? []}
      audio={audioKept !== false && !!tr.data.audio_available && !tr.detail?.call.audio_deleted && !tr.detail?.audio_not_stored}
    />
  ) : null;
}

/** The call's speakers and every line, read once (no Channel; the span ends at the protocol's u32 OffsetMs maximum): the first lines the naming rows quote. */
export async function readNaming(bridge: Bridge, callId: string): Promise<{ speakers: SpeakerView[]; segments: SegmentView[] } | null> {
  const [c, t] = await Promise.all([bridge.core.callGet({ call_id: callId }), bridge.core.transcriptSpan({ span: { call_id: callId, t0_ms: 0, t1_ms: 0xffff_ffff } })]);
  return c.status === "ok" && t.status === "ok" ? { speakers: c.data.speakers, segments: t.data.segments } : null;
}

/** PC-R9 above the Summary: one read of the speakers and lines, no Channel (the Transcript tab owns the one Channel slot); a naming re-reads. */
export function SummaryNamingPanel({ bridge, callId, detail }: { bridge: Bridge; callId: string; detail: AudioFacts }) {
  const [read, setRead] = useState<Awaited<ReturnType<typeof readNaming>>>(null);
  const named = useWindow(bridge, (s) => s.entities.speaker);
  // shortcut: a slow older read can land after a newer one, a naming re-reads again at once; no cancel until a DOM test harness exists
  useEffect(() => void readNaming(bridge, callId).then(setRead), [bridge, callId, named]);
  return read ? (
    <SpeakerNamingPanel
      bridge={bridge}
      callId={callId}
      speakers={read.speakers}
      segments={read.segments}
      participants={detail.call.participants ?? []}
      audio={!detail.call.audio_deleted && !detail.audio_not_stored}
    />
  ) : null;
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
