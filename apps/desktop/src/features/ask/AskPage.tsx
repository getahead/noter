// Ask: recent questions (AK-R2), the thread (AK-R3) and the composer (AK-R4); answers stream from the core.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { AskAnswer, AskThreadRow, TimeSpan } from "../../core/bindings";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import { TextField } from "../../ui/primitives/text-field";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { PlaybackBar } from "../transcript/playback-bar";
import { useAskReplay } from "./replay";
import { RecentRow } from "./RecentRow";
import { CitedAnswer } from "./CitedAnswer";
import { afterTurn, bindStopKey, copyText, currentStream, removeThread, searchByKeyword, loadPresets, loadRows, openThread, questionOf, settleTurn, startAsk, stopAsk, threadOfRoute } from "./actions";
import { setAskState, useAskState } from "./ask-state";
import { usePeople } from "../speakers/people";
import { announcementOf, errorKeyOf, foldTurn, groupThreads, phaseOf, suggestionsOf, type TurnPhase, type TurnView } from "./model";
import "./ask.css";

const GROUP = { today: "ask.group.today", last_week: "ask.group.last_week", earlier: "ask.group.earlier" } as const;

// @cpt-component:cpt-noter-component-screen-ask:p1
// @cpt-flow:cpt-noter-flow-ui-ask-question:p1
export function AskPage({ bridge, routeKey = "root" }: { bridge: Bridge; routeKey?: string }) {
  const [rows, setRows] = useState<AskThreadRow[]>([]);
  const { presets, scopeId, fresh } = useAskState();
  const [thread, setThread] = useState<string | null>(null);
  const [turns, setTurns] = useState<AskAnswer[]>([]);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const stream = useWindow(bridge, (s) => s.streams.ask_start);
  const loadError = useWindow(bridge, (s) => s.commands["ask:list"]?.state === "ERROR");

  const refresh = useCallback(async () => {
    const r = await loadRows(bridge);
    if (r) setRows(r);
  }, [bridge]);

  useEffect(() => {
    void refresh();
    void loadPresets(bridge).then((p) => p && setAskState({ presets: p }));
    // @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-dispose
    return () => void bridge.unsubscribe("ask_start");
    // @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-dispose
  }, [bridge, refresh]);

  const open = (id: string | null) => (setAnnounce(""), openThread)(bridge, id, { setThread, setTurns, setAsking });

  const previousTurn = useRef<string | null>(null);
  const data = currentStream(stream?.data ?? null, previousTurn.current);

  const firstRender = useRef(true);
  useEffect(() => {
    // New Question (button or ⌘N): the empty composer; not on arrival
    if (firstRender.current) firstRender.current = false;
    else void open(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);

  // `thread:<id>` opens that thread; the key is the route's, so Back and the core's nav:request land here
  useEffect(() => {
    const id = threadOfRoute(routeKey);
    if (id) void open(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  const turn: TurnView | null = data ? foldTurn(data.messages) : null;
  const phase = turn ? phaseOf(turn) : null;
  const busy = asking !== null && (phase === null || phase === "streaming") && !stream?.error;

  // The turn is over for the thread: reload what the core stored.
  useEffect(() => {
    const key = announcementOf(phase, turn?.citations.length ?? 0);
    if (key) setAnnounce(t(key, { n: turn?.citations.length ?? 0 }));
    if (asking && data) void settleTurn(bridge, data.thread_id, phase, { setThread, setTurns, setAsking, refresh });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking, data, phase, bridge, refresh]);

  const ask = (question: string) => {
    previousTurn.current = afterTurn(data, previousTurn.current); // the answered turn's data must not settle or show as the follow-up
    setAnnounce("");
    setAsking(question);
    setDraft("");
    startAsk(bridge, thread, question, presets.find((p) => p.id === scopeId)?.scope);
  };
  const send = () => {
    const question = questionOf(draft, busy);
    if (question) ask(question);
  };
  const people = usePeople(bridge);
  const replay = useAskReplay(bridge);

  const stop = () => data && stopAsk(bridge, data.turn_id);
  useEffect(() => {
    if (busy) return bindStopKey(document, stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, data?.turn_id]);

  return (
    <AskView
      bridge={bridge}
      rows={rows}
      loadError={loadError}
      thread={thread}
      turns={turns}
      asking={asking}
      turn={turn}
      phase={phase}
      draft={draft}
      busy={busy}
      onOpen={(id) => void open(id)}
      onCopyQuestion={(q) => void copyText(q, (s) => navigator.clipboard.writeText(s))}
      onDelete={(id) => void removeThread(bridge, id, thread, { open: (to) => void open(to), refresh: () => void refresh() })}
      onDraft={setDraft}
      onSend={send}
      onPlay={(span) => void replay.play(span)}
      bar={
        replay.replay && replay.bar !== "CLOSED" ? <PlaybackBar variant="search-and-ask" state={replay.bar} replay={replay.replay} position_ms={replay.position} onToggle={replay.toggle} onSeek={replay.seek} onClose={replay.close} /> : null
      }
      announce={announce}
      suggestions={suggestionsOf(people, (name) => t("ask.suggest_person", { name }))}
      onSuggest={ask}
      onStop={stop}
      onRetry={() => asking && ask(asking)}
    />
  );
}

export interface AskViewProps {
  bridge: Bridge;
  rows: AskThreadRow[];
  loadError: boolean;
  thread: string | null;
  turns: AskAnswer[];
  asking: string | null;
  turn: TurnView | null;
  phase: TurnPhase | null;
  draft: string;
  busy: boolean;
  onOpen: (id: string) => void;
  onCopyQuestion: (title: string) => void;
  onDelete: (id: string) => void;
  onDraft: (v: string) => void;
  onSend: () => void;
  announce: string;
  suggestions: string[];
  onSuggest: (question: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onPlay: (span: TimeSpan) => void;
  /** The playback bar of the replay a citation started; null while none. */
  bar: ReactNode;
}

/** The three regions of the page: recent questions, the thread and the composer. */
export function AskView({ bridge, rows, loadError, thread, turns, asking, turn, phase, draft, busy, onOpen, onCopyQuestion, onDelete, onDraft, onSend, announce, suggestions, onSuggest, onStop, onRetry, onPlay, bar }: AskViewProps) {
  const empty = turns.length === 0 && !asking;
  const groups = groupThreads(rows, Date.now());
  return (
    <div className="ak-split">
      <nav className="ak-recent" data-region="AK-R2" aria-label={t("ask.recent")}>
        {loadError && <div className="ak-recent__empty">{t("ask.load_error")}</div>}
        {!loadError && rows.length === 0 && <div className="ak-recent__empty">{t("ask.recent_empty")}</div>}
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={t(GROUP[g.key])}>
            <div className="ak-recent__group">{t(GROUP[g.key])}</div>
            <ul className="ak-recent__list">
            {g.rows.map((r) => (
              <RecentRow key={r.id} row={r} selected={r.id === thread} onOpen={() => onOpen(r.id)} onCopy={() => onCopyQuestion(r.title)} onDelete={() => onDelete(r.id)} />
            ))}
            </ul>
          </div>
        ))}
      </nav>
      <section className="ak-thread" data-region="AK-R3" aria-label={t("ask.thread")}>
        <div role="status" className="ak-live">{announce}</div>
        {empty && <h2 className="ak-first__h">{t("ask.first_heading")}</h2>}
        {turns.map((a) => (
          <article key={a.turn_id} className="ak-turn">
            <h3 className="ak-q">{a.question}</h3>
            <Answer bridge={bridge} onPlay={onPlay} onSearch={() => searchByKeyword(a.question)} onAskAgain={() => onSuggest(a.question)} view={foldTurn([{ seq: 1, event: { type: "done", answer: a } }])} />
          </article>
        ))}
        {asking && turn && (
          <article className="ak-turn">
            <h3 className="ak-q">{asking}</h3>
            <Answer bridge={bridge} view={turn} onPlay={onPlay} onRetry={onRetry} onSearch={() => searchByKeyword(asking)} />
            {phase === "interrupted" && <PushButton label={t("ask.try_again")} onAction={onRetry} />}
          </article>
        )}
        {bar}
        <div className={`ak-composer${empty ? " is-first" : ""}`} data-region="AK-R4">
          <TextField
            variant="multi"
            cls="ak-composer__field"
            rows={empty ? 3 : 2}
            ariaLabel={t(empty ? "ask.composer_first" : "ask.composer_follow_up")}
            placeholder={t(empty ? "ask.composer_first" : "ask.composer_follow_up")}
            value={draft}
            onChange={onDraft}
            onEnter={onSend}
          />
          {busy ? <PushButton label={t("ask.stop")} kbd="⌘." onAction={onStop} /> : <PushButton label={t("ask.send")} variant="primary" onAction={onSend} />}
        </div>
        {empty && suggestions.length > 0 && (
          <div className="ak-suggest">
            {suggestions.map((q) => (
              <PushButton key={q} label={q} variant="quiet" onAction={() => onSuggest(q)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** One turn's answer: its text as escaped paragraphs; citations and richer states arrive with the cited-answer slice. */
export function Answer({ view, bridge, onAskAgain, onPlay, onRetry, onSearch }: { view: TurnView; bridge: Bridge; onAskAgain?: () => void; onPlay?: (span: TimeSpan) => void; onRetry?: () => void; onSearch?: () => void }) {
  const phase = phaseOf(view);
  if (phase === "not_found")
    return (
      <div className="ak-ans" data-component="cpt-noter-component-ui-cited-answer">
        <p className="ak-ans__p">{t("ask.not_found")}</p>
        {onSearch && <PushButton label={t("ask.search_keyword")} onAction={onSearch} />}
      </div>
    );
  return (
    <div className="ak-ans" data-component="cpt-noter-component-ui-cited-answer">
      {phase === "streaming" && !view.text && <div className="ak-status">{t("ask.answering")}</div>}
      {view.text && <CitedAnswer bridge={bridge} text={view.text} citations={view.citations} live={phase === "streaming"} onAskAgain={onAskAgain} onPlay={onPlay} />}
      {phase === "stopped" && <div className="ak-status">{t("ask.stopped")}</div>}
      {phase === "interrupted" && <div className="ak-status">{t("ask.interrupted")}</div>}
      {phase === "error" && <ErrorBanner view={view} onRetry={onRetry} onLocal={() => void bridge.act("window:navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "settings", pane: "models_and_runtimes" } }))} />}
    </div>
  );
}

function ErrorBanner({ view, onRetry, onLocal }: { view: TurnView; onRetry?: () => void; onLocal: () => void }) {
  const unreachable = errorKeyOf(view) === "ask.error_runtime";
  return (
    <InlineBanner
      banner={{
        id: "ask-error",
        severity: "error",
        text: t(errorKeyOf(view)),
        actions: [...(onRetry ? [{ label: t("ask.try_again"), onAction: onRetry }] : []), ...(unreachable ? [{ label: t("ask.use_local"), onAction: onLocal, variant: "quiet" as const }] : [])],
      }}
    />
  );
}
