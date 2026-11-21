import { ModelDownloadNotice } from "../../ui/setup/model-download-notice";
// Ask: recent questions (AK-R2), the thread (AK-R3) and the composer (AK-R4); answers stream from the core.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { AskAnswer, AskScope, AskThreadRow, TimeSpan } from "../../core/bindings";
import { t } from "../../i18n/format";
import { navigate } from "../shell/navigate";
import { PushButton } from "../../ui/primitives/push-button";
import { TextField } from "../../ui/primitives/text-field";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { PlaybackBar } from "../transcript/playback-bar";
import { useAskReplay } from "./replay";
import { RecentRow } from "./RecentRow";
import { CitedAnswer } from "./CitedAnswer";
import { AnswerFeedback } from "./AnswerFeedback";
import { afterTurn, bindStopKey, endedWhileAway, copyText, currentStream, removeThread, searchByKeyword, settleRoute, startRoute, recoverGap, releaseFailedRoute, widenScope, isNarrowed, loadPresets, loadRows, openThread, questionOf, settleTurn, scopeOf, startAsk, stopAsk, threadOfRoute, afterDelete, COMPOSER_ID, nextOpenRequest, keepRowFocus, focusComposer, focusNewQuestion } from "./actions";
import { setPresets, setRecent, useAskState } from "./ask-state";
import { usePeople } from "../speakers/people";
import { runtimeLabel } from "../call-page/outputs-logic";
import { announcementOf, errorKeyOf, failedView, foldTurn, groupThreads, phaseOf, suggestionsOf, type TurnPhase, type TurnView } from "./model";
import "./ask.css";

const MODE = { cloud: "mode.cloud", cloud_redacted: "mode.cloud_redacted", local_only: "mode.local_only", sensitive_local: "mode.sensitive_local", switched_to_local: "mode.switched_to_local" } as const;
const GROUP = { today: "ask.group.today", last_week: "ask.group.last_week", earlier: "ask.group.earlier" } as const;

// @cpt-component:cpt-noter-component-screen-ask:p1
// @cpt-dod:cpt-noter-dod-ui-ask-threads:p1
// @cpt-flow:cpt-noter-flow-ui-ask-question:p1
export function AskPage({ bridge, routeKey = "root" }: { bridge: Bridge; routeKey?: string }) {
  const [rows, setRows] = useState<AskThreadRow[]>([]);
  const { presets, scopeId, fresh, openRequest } = useAskState();
  const [thread, setThread] = useState<string | null>(null);
  const [turns, setTurns] = useState<AskAnswer[]>([]);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [routeError, setRouteError] = useState(false);
  const stream = useWindow(bridge, (s) => s.streams.ask_start);
  const loadError = useWindow(bridge, (s) => s.commands["ask:list"]?.state === "ERROR");

  const refresh = useCallback(async () => {
    const r = await loadRows(bridge);
    if (r) setRows(r);
  }, [bridge]);

  // the toolbar's Recent pop-up (Medium and Narrow) shows the same rows and asks this page to open one
  useEffect(() => setRecent(rows), [rows]);
  const requested = useRef(openRequest.n);
  useEffect(() => {
    const next = nextOpenRequest(openRequest, requested.current);
    requested.current = next.seen;
    if (next.open) void open(next.open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);
  // a deleted row had focus: its successor takes it once the list is read again
  const afterRowDelete = useRef<string[] | null>(null);
  useEffect(() => {
    afterRowDelete.current = keepRowFocus(document, afterRowDelete.current);
  }, [rows]);

  useEffect(() => {
    void refresh();
    void loadPresets(bridge).then((p) => p && setPresets(p));
    // @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-dispose
    return () => void bridge.unsubscribe("ask_start");
    // @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-dispose
  }, [bridge, refresh]);

  const open = (id: string | null) => {
    restoreComposer.current = false;
    setAnnounce("");
    if (busy) previousTurn.current = afterTurn(data, previousTurn.current); // the turn goes on without the page showing it
    return openThread(bridge, id, { setThread, setTurns, setAsking, setAskedScope, current: thread }, busy);
  };

  const [askedScope, setAskedScope] = useState<AskScope | undefined>(undefined);
  const previousTurn = useRef<string | null>(null);
  const data = currentStream(stream?.data ?? null, previousTurn.current);

  const firstRender = useRef(true);
  useEffect(() => {
    // New Question (button or ⌘N): the empty composer; not on arrival
    if (firstRender.current) firstRender.current = false;
    else void open(null).then(() => focusNewQuestion(document)); // a new question starts with focus in AK-R4
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh]);

  // `thread:<id>` opens that thread; the key is the route's, so Back and the core's nav:request land here
  const settledHere = useRef<string | null>(null);
  useEffect(() => {
    const id = threadOfRoute(routeKey);
    // a question asked on this page became its thread entry (issue 1068): the thread already shows, its announcement and focus stay
    if (id && id === settledHere.current) return void (settledHere.current = null);
    if (id) void open(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  // `new:<words>` (Ask Instead, a Library question) asks those words once per history entry; `new-topic:<id>` asks about that topic
  useEffect(() => {
    setRouteError(false);
    return startRoute(bridge, routeKey, ask, () => setRouteError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);
  // Commit the thread entry before the ready view can receive Back; a later effect could replace Today.
  useLayoutEffect(() => {
    settleRoute(routeKey, thread, asking === null && turns.length > 0, (route) => {
      if (routeKey === "root") settledHere.current = thread;
      navigate(route, true);
    });
  }, [routeKey, thread, asking, turns]);

  // @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-stream
  const turn: TurnView | null = data ? foldTurn(data.messages) : stream?.error && asking ? failedView(stream.error.code) : null;
  const phase = turn ? phaseOf(turn) : null;
  // a failed turn leaves its route entry askable again
  useEffect(() => releaseFailedRoute(routeKey, phase), [routeKey, phase]);
  // Stop, Widen Scope and Try Again replace the button that had focus: the composer takes it (never from a control that has it)
  const restoreComposer = useRef(false);
  useEffect(() => {
    if (!restoreComposer.current) return;
    restoreComposer.current = false;
    focusComposer(document);
  }, [asking, phase]);
  const busy = asking !== null && (phase === null || phase === "streaming") && !stream?.error;
  // @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-stream

  // A turn the user left while it answered (⌘N, another thread) has ended: Recent now has its thread
  const away = useRef<string | null>(null);
  useEffect(() => {
    const raw = stream?.data ?? null;
    const ended = endedWhileAway(raw, raw ? phaseOf(foldTurn(raw.messages)) : null, asking, away.current);
    if (!ended) return;
    away.current = ended;
    void refresh();
  }, [stream, asking, refresh]);

  // The turn is over for the thread: reload what the core stored.
  useEffect(() => {
    const key = announcementOf(phase, turn?.citations.length ?? 0);
    if (key) setAnnounce(t(key, { n: turn?.citations.length ?? 0 }));
    if (asking && data) void settleTurn(bridge, data.thread_id, phase, { setThread, setTurns, setAsking, refresh });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking, data, phase, bridge, refresh]);

  // the stream lost events: the bridge ended it as lagged
  // @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-gap
  useEffect(() => {
    if (asking && data && stream?.ended === "lagged") void recoverGap(bridge, data.thread_id, { setThread, setTurns, setAsking, refresh });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream?.ended]);
  // @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-gap

  // @cpt-begin:cpt-noter-state-ui-ask-turn:p1:inst-submit
  const ask = (question: string, scope?: AskScope) => {
    previousTurn.current = afterTurn(data, previousTurn.current); // the answered turn's data must not settle or show as the follow-up
    setAnnounce("");
    setAsking(question);
    setDraft("");
    const sent = scope ?? scopeOf(presets, scopeId);
    setAskedScope(sent); // Widen Scope follows the scope this turn was asked with, not the pop-up's later choice
    startAsk(bridge, thread, question, sent);
  };
  // @cpt-end:cpt-noter-state-ui-ask-turn:p1:inst-submit
  const widen = (question: string) => {
    restoreComposer.current = true;
    widenScope(question, ask);
  };
  // @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-follow-up
  const send = () => {
    const question = questionOf(draft, busy);
    if (question) ask(question);
  };
  // @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-follow-up
  const people = usePeople(bridge);
  const replay = useAskReplay(bridge);

  const stop = () => {
    if (!data) return;
    restoreComposer.current = true;
    stopAsk(bridge, data.turn_id);
  };
  useEffect(() => {
    if (busy) return bindStopKey(document, stop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, data?.turn_id]);

  return (
    <AskView
      bridge={bridge}
      rows={rows}
      loadError={loadError}
      routeError={routeError}
      thread={thread}
      turns={turns}
      asking={asking}
      turn={turn}
      phase={phase}
      draft={draft}
      busy={busy}
      onOpen={(id) => void open(id)}
      onCopyQuestion={(q) => void copyText(q, (s) => navigator.clipboard.writeText(s))}
      onDelete={(id) => {
        afterRowDelete.current = afterDelete(rows, id);
        void removeThread(bridge, id, thread, { open: (to) => void open(to), refresh: () => void refresh() });
      }}
      onDraft={setDraft}
      onSend={send}
      onPlay={(span) => void replay.play(span)}
      bar={<>
        <ModelDownloadNotice bridge={bridge} model="bge-m3" />
        {replay.replay && replay.bar !== "CLOSED" ? <PlaybackBar variant="search-and-ask" state={replay.bar} replay={replay.replay} position_ms={replay.position} onToggle={replay.toggle} onSeek={replay.seek} onClose={replay.close} /> : null}
      </>}
      announce={announce}
      suggestions={suggestionsOf(people, (name) => t("ask.suggest_person", { name }))}
      onSuggest={ask}
      narrowed={isNarrowed(askedScope)}
      onWiden={widen}
      onStop={stop}
      // @cpt-begin:cpt-noter-state-ui-ask-turn:p1:inst-retry
      onRetry={() => {
        if (!asking) return;
        restoreComposer.current = true;
        ask(asking);
      }}
      // @cpt-end:cpt-noter-state-ui-ask-turn:p1:inst-retry
    />
  );
}

export interface AskViewProps {
  bridge: Bridge;
  rows: AskThreadRow[];
  loadError: boolean;
  /** The topic a `new-topic:` arrival names could not be read. */
  routeError?: boolean;
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
  onSuggest: (question: string, scope?: AskScope) => void;
  /** The chosen scope is narrower than All calls · all sources: a not-found answer offers Widen Scope. */
  narrowed?: boolean;
  onWiden?: (question: string) => void;
  onStop: () => void;
  onRetry: () => void;
  onPlay: (span: TimeSpan) => void;
  /** The playback bar of the replay a citation started; null while none. */
  bar: ReactNode;
}

/** The three regions of the page: recent questions, the thread and the composer. */
export function AskView({ bridge, rows, loadError, routeError, thread, turns, asking, turn, phase, draft, busy, onOpen, onCopyQuestion, onDelete, onDraft, onSend, announce, suggestions, onSuggest, narrowed, onWiden, onStop, onRetry, onPlay, bar }: AskViewProps) {
  const empty = turns.length === 0 && !asking;
  const groups = groupThreads(rows, Date.now());
  return (
    <div className="ak-split">
      {/* @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-first */}
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
      {/* @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-first */}
      <section className="ak-thread" data-region="AK-R3" aria-label={t("ask.thread")}>
        <div role="status" className="ak-live">{announce}</div>
        {routeError && <InlineBanner banner={{ id: "ask-topic-error", severity: "error", text: t("ask.topic_error") }} />}
        {empty && <h2 className="ak-first__h">{t("ask.first_heading")}</h2>}
        {/* Keep a completed live turn mounted when its stored snapshot arrives. */}
        {[...turns.map((a) => (
          <article key={a.turn_id} className="ak-turn">
            <h3 className="ak-q">{a.question}</h3>
            {/* @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-again */}
            {/* @cpt-begin:cpt-noter-state-ui-ask-turn:p1:inst-again */}
            <Answer bridge={bridge} onPlay={onPlay} onSearch={() => searchByKeyword(a.question)} onAskAgain={() => onSuggest(a.question, a.scope ?? undefined)} onWiden={isNarrowed(a.scope ?? undefined) && onWiden && !asking && a === turns.at(-1) ? () => onWiden(a.question) : undefined} view={foldTurn([{ seq: 1, event: { type: "done", answer: a } }])} />
            {/* @cpt-end:cpt-noter-state-ui-ask-turn:p1:inst-again */}
            {/* @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-again */}
          </article>
        )), asking && (
          <article key={turn?.answer?.turn_id ?? "asking"} className="ak-turn">
            <h3 className="ak-q">{asking}</h3>
            <Answer bridge={bridge} view={turn ?? foldTurn([])} onPlay={onPlay} onRetry={onRetry} onSearch={() => searchByKeyword(asking)} onWiden={narrowed && onWiden ? () => onWiden(asking) : undefined} />
            {phase === "interrupted" && <PushButton label={t("ask.try_again")} onAction={onRetry} />}
          </article>
        )]}
        {bar}
        <div className={`ak-composer${empty ? " is-first" : ""}`} data-region="AK-R4">
          {/* @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-compose */}
          <TextField
            variant="multi"
            id={COMPOSER_ID}
            cls="ak-composer__field"
            rows={empty ? 3 : 2}
            ariaLabel={t(empty ? "ask.composer_first" : "ask.composer_follow_up")}
            placeholder={t(empty ? "ask.composer_first" : "ask.composer_follow_up")}
            value={draft}
            onChange={onDraft}
            onEnter={onSend}
          />
          {/* @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-compose */}
          {/* keyed, so Stop and Ask are two buttons: the one that had focus goes away and the composer takes it */}
          {busy ? <PushButton key="stop" label={t("ask.stop")} kbd="⌘." onAction={onStop} /> : <PushButton key="send" label={t("ask.send")} variant="primary" onAction={onSend} />}
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
export function Answer({ view, bridge, onAskAgain, onPlay, onRetry, onSearch, onWiden }: { view: TurnView; bridge: Bridge; onAskAgain?: () => void; onPlay?: (span: TimeSpan) => void; onRetry?: () => void; onSearch?: () => void; onWiden?: () => void }) {
  const phase = phaseOf(view);
  // @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-done
  const answer = view.answer;
  const notes = <>
    {answer?.answered_locally && <div className="ak-status">{t("ask.answered_locally")}</div>}
    {!!answer?.sensitive_sources_skipped && <InlineBanner banner={{ id: "ask-sensitive", severity: "info", text: t("ask.sensitive_skipped", { count: answer.sensitive_sources_skipped }), actions: [{ label: t("ask.use_local"), onAction: () => void bridge.act("window:navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "settings", pane: "models_and_runtimes" } })) }] }} />}
    {answer?.keyword_only && <div className="ak-status">{t("search.keyword_only")}</div>}
    {phase === "weak" && <InlineBanner banner={{ id: "ask-weak", severity: "warning", text: t("ask.weak_warning"), actions: [...(onWiden ? [{ label: t("ask.widen"), onAction: onWiden }] : []), ...(onSearch ? [{ label: t("ask.search_keyword"), onAction: onSearch }] : [])] }} />}
  </>;
  // @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-done
  // @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-not-found
  if (phase === "not_found")
    return (
      <div className="ak-ans" data-component="cpt-noter-component-ui-cited-answer">
        {notes}
        <p className="ak-ans__p">{t("ask.not_found")}</p>
        {/* @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-if-search */}
        {onSearch && <PushButton label={t("ask.search_keyword")} onAction={onSearch} />}
        {/* @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-if-search */}
        {/* @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-if-widen */}
        {/* @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-widen */}
        {onWiden && <PushButton label={t("ask.widen")} onAction={onWiden} />}
        {answer && <AnswerFeedback key={`${answer.turn_id}:${answer.rating}`} bridge={bridge} answer={answer} />}
        {/* @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-widen */}
        {/* @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-if-widen */}
      </div>
    );
  // @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-not-found
  return (
    <div className="ak-ans" data-component="cpt-noter-component-ui-cited-answer">
      {notes}
      {view.runtime && view.mode && <div className="ak-status">{t("mode.runtime", { runtime: runtimeLabel(view.runtime), mode: t(MODE[view.mode]) })}</div>}
      {phase === "streaming" && !view.text && <div className="ak-status">{t(view.runtime ? "ask.reading" : "ask.searching")}</div>}
      {/* @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-ready */}
      {view.text && <CitedAnswer bridge={bridge} text={view.text} citations={view.citations} live={phase === "streaming"} onAskAgain={onAskAgain} onPlay={onPlay} extra={answer && <AnswerFeedback key={`${answer.turn_id}:${answer.rating}`} bridge={bridge} answer={answer} part="rate" />} />}
      {/* @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-ready */}
      {phase === "stopped" && <div className="ak-status">{t("ask.stopped")}</div>}
      {phase === "interrupted" && <div className="ak-status">{t("ask.interrupted")}</div>}
      {phase === "error" && <ErrorBanner view={view} onRetry={onRetry} onLocal={() => void bridge.act("window:navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "settings", pane: "models_and_runtimes" } }))} />}
      {/* the thumbs are on Copy with Citations' row when there is an answer text; otherwise under the meta line */}
      {answer && <AnswerFeedback key={`${answer.turn_id}:${answer.rating}:meta`} bridge={bridge} answer={answer} part={view.text ? "meta" : undefined} />}
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
