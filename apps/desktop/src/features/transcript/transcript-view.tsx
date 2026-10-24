// Transcript view (DESIGN › Transcript view; prototype src/js/20-b-components.js C.transcriptView): the virtualised log
// of a call in its live, tail and stored variants. It follows live speech while the user is at the end, detaches with
// Jump to Live when they scroll up, and draws only the rows in view. It owns no segments and never announces lines.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { SegmentView, SpeakerView } from "../../core/bindings";
import { t } from "../../i18n/format";
import { useWindowShortcuts, type ShortcutTable } from "../../app/a11y/keys";
import { IconButton } from "../../ui/primitives/icon-button";
import { LevelMeter } from "../../ui/primitives/level-meter";
import { PushButton } from "../../ui/primitives/push-button";
import { SearchField } from "../../ui/primitives/search-field";
import { LogScroller, newLines, viewState, type Follow, type RowList } from "./follow";
import { findMatches, meterLevel, type Row, type Variant } from "./model";
import type { PlayControl } from "./play-control";
import { SegmentRow } from "./segment-row";
import "./transcript.css";

/** Estimated row heights until a row is measured (Call transcript 22 pt line, stored 19 pt, tail 17 pt, plus padding). */
const EST: Record<Variant, number> = { live: 32, stored: 29, tail: 19 };
const SKELETON_ROWS = 5;

export interface TranscriptViewProps {
  variant: Variant;
  rows: Row[];
  speakers: readonly SpeakerView[];
  /** Nothing loaded yet, and it has taken longer than 300 ms: skeleton rows. */
  loading?: boolean;
  loaded: boolean;
  /** A live call before its first speech: the two meters and **Waiting for speech…**. */
  waiting?: boolean;
  levels?: { mic_db: number | null; sys_db: number | null } | null;
  /** The view body's inline banner when the stored transcript fails to load. */
  error?: ReactNode;
  /** The stored variant's header line about the audio. */
  header?: ReactNode;
  control?: (row: Row) => PlayControl | undefined;
  playingKey?: string | null;
  /** Evidence rows (3 s); the first takes focus. */
  highlight?: readonly string[];
  timeHelp?: string;
  /** A refused `audio_play`: its reason as the row's inline status. */
  refused?: { key: string; text: string } | null;
  onRefusedDone?: () => void;
  onPlay?: (seg: SegmentView) => void;
}

const smooth = (): ScrollBehavior => (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth");
const segments = (rows: readonly Row[]) => rows.reduce((n, r) => n + (r.kind === "segment" ? 1 : 0), 0);

// @cpt-component:cpt-noter-component-ui-transcript-view:p1
// @cpt-dod:cpt-noter-dod-ui-live-transcript-view:p1
// @cpt-flow:cpt-noter-flow-ui-live-transcript-follow:p1
export function TranscriptView(p: TranscriptViewProps) {
  const { variant, rows } = p;
  const live = variant === "live";
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const log = useRef<LogScroller>(null as unknown as LogScroller);
  log.current ??= new LogScroller(EST[variant]);
  const [pos, setPos] = useState({ top: 0, height: 800 });
  const confirmed = segments(rows);
  const [follow, setFollow] = useState<Follow>({ following: live, base: confirmed });
  const [find, setFind] = useState<{ query: string; at: number } | null>(null);
  const [status, setStatus] = useState<{ key: string; text: string } | null>(null);
  const keys = useMemo(() => rows.map((r) => r.key), [rows]);
  const matches = useMemo(() => (find ? findMatches(rows, find.query) : []), [rows, find]);
  const current = matches.length ? matches[(((find?.at ?? 0) % matches.length) + matches.length) % matches.length] : undefined;
  const state = viewState({ error: !!p.error, loaded: p.loaded, waiting: !!p.waiting, follow, find: !!find });
  const el = () => scroller.current;

  // @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-jump
  const jump = () => {
    setFollow({ following: true, base: confirmed });
    el()?.scrollTo({ top: el()!.scrollHeight, behavior: smooth() });
  };
  // @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-jump
  const moveMatch = (by: number) => setFind((f) => f && { ...f, at: f.at + by });
  const openFind = () => setFind((f) => f ?? { query: "", at: 0 });
  useWindowShortcuts(useMemo((): ShortcutTable => (live ? { "Meta+KeyJ": jump } : variant === "stored" && p.loaded ? { "Meta+KeyF": openFind } : {}), [live, variant, p.loaded, confirmed]));

  // After every render: measure the drawn rows, keep the rows in view where they were, and keep the end in view while following.
  useLayoutEffect(() => {
    const area = el();
    if (!area || !list.current) return;
    const changed = log.current.afterRender(area, list.current as unknown as RowList, keys, follow.following && live, smooth());
    if (changed || area.clientHeight !== pos.height) setPos({ top: area.scrollTop, height: area.clientHeight });
  });

  // @cpt-begin:cpt-noter-flow-ui-live-transcript-stored:p1:inst-span
  const first = p.highlight?.[0];
  useLayoutEffect(() => {
    if (!first) return;
    log.current.focusKey = first;
    if (el()) log.current.scrollToRow(el()!, keys, first, smooth());
  }, [first]);
  // @cpt-end:cpt-noter-flow-ui-live-transcript-stored:p1:inst-span
  useLayoutEffect(() => void (current && el() && log.current.scrollToRow(el()!, keys, current, "instant")), [current]);

  if (state === "WAITING_FOR_SPEECH") {
    // @cpt-begin:cpt-noter-flow-ui-live-transcript-follow:p1:inst-waiting
    return (
      <div data-component="cpt-noter-component-ui-transcript-view" data-variant={variant} data-state="waiting-for-speech" className={`cw-tv cw-tv--${variant}`}>
        <div className="cw-tv__waiting">
          <div className="cw-meters">
            <span>{t("transcript.meter.you")}</span>
            <LevelMeter level={meterLevel(p.levels?.mic_db)} label={t("transcript.meter.mic")} />
            <span>{t("transcript.meter.others")}</span>
            <LevelMeter level={meterLevel(p.levels?.sys_db)} label={t("transcript.meter.sys")} />
          </div>
          <div className="np-muted">{t("transcript.waiting")}</div>
        </div>
      </div>
    );
    // @cpt-end:cpt-noter-flow-ui-live-transcript-follow:p1:inst-waiting
  }

  const win = variant === "tail" ? { start: 0, end: rows.length, before: 0, after: 0 } : log.current.window(keys, pos.top, pos.height);
  const count = newLines(follow, confirmed);
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-user-scroll
  // @cpt-begin:cpt-noter-flow-ui-live-transcript-follow:p1:inst-follow
  const scroll = () => {
    const area = el()!;
    const at = { scrollTop: area.scrollTop, clientHeight: area.clientHeight, scrollHeight: area.scrollHeight };
    setFollow(log.current.scrolled(follow, at, confirmed));
    setPos({ top: at.scrollTop, height: at.clientHeight });
  };
  // @cpt-end:cpt-noter-flow-ui-live-transcript-follow:p1:inst-follow
  // @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-user-scroll
  const onFindKey = (e: KeyboardEvent) => {
    // @cpt-begin:cpt-noter-flow-ui-live-transcript-stored:p1:inst-find
    if (e.key === "Enter") moveMatch(e.shiftKey ? -1 : 1);
    // @cpt-end:cpt-noter-flow-ui-live-transcript-stored:p1:inst-find
    else if (e.key === "Escape") setFind(null);
  };
  return (
    <div
      data-component="cpt-noter-component-ui-transcript-view"
      data-variant={variant}
      data-state={state === "DETACHED" ? "detached" : state === "FIND_ACTIVE" ? "find-active" : variant === "stored" ? "default" : "following"}
      className={`cw-tv cw-tv--${variant === "stored" ? "post-call" : variant}`}
      role="log"
      aria-live="off"
      aria-label={t("transcript.label")}
    >
      {/* @cpt-begin:cpt-noter-flow-ui-live-transcript-stored:p1:inst-user-find */}
      {find && (
        <div className="cw-tv__find" onKeyDown={onFindKey}>
          <AutoFocus>
            <SearchField placeholder={t("transcript.find")} value={find.query} onChange={(query) => setFind({ query, at: 0 })} />
          </AutoFocus>
          <span className="np-dim np-tnum">{find.query.trim() ? t("transcript.find.count", { matches: matches.length, count: confirmed }) : ""}</span>
          <IconButton icon="chevronUp" label={t("transcript.find.previous")} size="inline" onAction={() => moveMatch(-1)} />
          <IconButton icon="chevronDown" label={t("transcript.find.next")} size="inline" onAction={() => moveMatch(1)} />
          <span className="np-tb__spacer" />
          <IconButton icon="x" label={t("transcript.find.close")} size="inline" onAction={() => setFind(null)} />
        </div>
      )}
      {/* @cpt-end:cpt-noter-flow-ui-live-transcript-stored:p1:inst-user-find */}
      {p.header && <div className="cw-tv__header np-dim">{p.header}</div>}
      {p.error}
      {p.loading && !p.loaded && (
        <div className="pc-skel" aria-hidden="true">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <div key={i} className="pc-skel__line" />
          ))}
        </div>
      )}
      <div className="cw-tv__scroll" ref={scroller} onScroll={scroll}>
        <div ref={list} className="cw-tv__rows" style={{ paddingTop: win.before, paddingBottom: win.after }}>
          {rows.slice(win.start, win.end).map((row) => (
            <SegmentRow
              key={row.key}
              row={row}
              variant={variant}
              speakers={p.speakers}
              control={p.control?.(row)}
              playing={p.playingKey === row.key}
              highlighted={p.highlight?.includes(row.key)}
              find={find?.query}
              current={current === row.key}
              status={(status?.key === row.key ? status.text : undefined) ?? (p.refused?.key === row.key ? p.refused.text : undefined)}
              timeHelp={p.timeHelp}
              onPlay={p.onPlay}
              onReason={(key, text) => setStatus({ key, text })}
              onStatusDone={() => (setStatus(null), p.onRefusedDone?.())}
            />
          ))}
        </div>
      </div>
      {/* @cpt-begin:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-detach */}
      {live && count > 0 && (
        <div className="cw-tv__jump">
          <PushButton label={t("transcript.jump", { count })} size="small" icon="chevronDown" cls="cw-jump" onAction={jump} />
        </div>
      )}
      {/* @cpt-end:cpt-noter-flow-ui-live-transcript-replay-line:p1:inst-detach */}
    </div>
  );
}

/** Focuses its input when it mounts (the find bar opened with ⌘F). */
function AutoFocus({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => ref.current?.querySelector("input")?.focus(), []);
  return (
    <span ref={ref} className="cw-tv__findfield">
      {children}
    </span>
  );
}
