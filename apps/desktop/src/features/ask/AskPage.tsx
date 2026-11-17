// Ask: recent questions (AK-R2), the thread (AK-R3) and the composer (AK-R4); answers stream from the core.
import { useCallback, useEffect, useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { AskAnswer, AskThreadRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import { TextField } from "../../ui/primitives/text-field";
import { currentStream, isStopKey, loadPresets, loadRows, openThread, questionOf, settleTurn, startAsk, stopAsk, threadOfRoute } from "./actions";
import { setAskState, useAskState } from "./ask-state";
import { foldTurn, groupThreads, paragraphs, phaseOf, type TurnPhase, type TurnView } from "./model";
import "./ask.css";

const GROUP = { today: "ask.group.today", yesterday: "ask.group.yesterday", earlier: "ask.group.earlier" } as const;

// @cpt-component:cpt-noter-component-screen-ask:p1
// @cpt-flow:cpt-noter-flow-ui-ask-question:p1
export function AskPage({ bridge, routeKey = "root" }: { bridge: Bridge; routeKey?: string }) {
  const [rows, setRows] = useState<AskThreadRow[]>([]);
  const { presets, scopeId } = useAskState();
  const [thread, setThread] = useState<string | null>(null);
  const [turns, setTurns] = useState<AskAnswer[]>([]);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
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

  const open = (id: string | null) => openThread(bridge, id, { setThread, setTurns, setAsking });

  const previousTurn = useRef<string | null>(null);
  const data = currentStream(stream?.data ?? null, previousTurn.current);
  // `thread:<id>` opens that thread; the key is the route's, so Back and the core's nav:request land here
  useEffect(() => {
    const id = threadOfRoute(routeKey);
    if (id) void open(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  const turn: TurnView | null = data ? foldTurn(data.messages) : null;
  const phase = turn ? phaseOf(turn) : null;
  const busy = asking !== null && phase === "streaming" && !stream?.error;

  // The turn is over for the thread: reload what the core stored.
  useEffect(() => {
    if (asking && data) void settleTurn(bridge, data.thread_id, phase, { setThread, setTurns, setAsking, refresh });
  }, [asking, data, phase, bridge, refresh]);

  const send = () => {
    const question = questionOf(draft, busy);
    if (!question) return;
    setAsking(question);
    setDraft("");
    startAsk(bridge, thread, question, presets.find((p) => p.id === scopeId)?.scope);
  };

  const stop = () => data && stopAsk(bridge, data.turn_id);
  useEffect(() => {
    if (!busy) return;
    const onKey = (e: KeyboardEvent) => isStopKey(e) && (e.preventDefault(), stop());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, data?.turn_id]);

  return (
    <AskView
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
      onDraft={setDraft}
      onSend={send}
      onStop={stop}
      onRetry={() => {
        setDraft(asking ?? "");
        setAsking(null);
      }}
    />
  );
}

export interface AskViewProps {
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
  onDraft: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onRetry: () => void;
}

/** The three regions of the page: recent questions, the thread and the composer. */
export function AskView({ rows, loadError, thread, turns, asking, turn, phase, draft, busy, onOpen, onDraft, onSend, onStop, onRetry }: AskViewProps) {
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
            {g.rows.map((r) => (
              <button key={r.id} type="button" className={`ak-recent__item${r.id === thread ? " is-sel" : ""}`} aria-current={r.id === thread} title={r.title} onClick={() => onOpen(r.id)}>
                {r.title}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <section className="ak-thread" data-region="AK-R3" aria-label={t("ask.thread")}>
        {empty && <h2 className="ak-first__h">{t("ask.first_heading")}</h2>}
        {turns.map((a) => (
          <article key={a.turn_id} className="ak-turn">
            <h3 className="ak-q">{a.question}</h3>
            <Answer view={foldTurn([{ seq: 1, event: { type: "done", answer: a } }])} />
          </article>
        ))}
        {asking && turn && (
          <article className="ak-turn">
            <h3 className="ak-q">{asking}</h3>
            <Answer view={turn} />
            {(phase === "error" || phase === "interrupted") && <PushButton label={t("ask.try_again")} onAction={onRetry} />}
          </article>
        )}
        <div className={`ak-composer${empty ? " is-first" : ""}`} data-region="AK-R4">
          <TextField
            variant="multi"
            cls="ak-composer__field"
            rows={empty ? 3 : 2}
            ariaLabel={t("ask.question")}
            placeholder={t(empty ? "ask.composer_first" : "ask.composer_follow_up")}
            value={draft}
            onChange={onDraft}
            onEnter={onSend}
          />
          {busy ? <PushButton label={t("ask.stop")} kbd="⌘." onAction={onStop} /> : <PushButton label={t("ask.send")} variant="primary" onAction={onSend} />}
        </div>
      </section>
    </div>
  );
}

/** One turn's answer: its text as escaped paragraphs; citations and richer states arrive with the cited-answer slice. */
export function Answer({ view }: { view: TurnView }) {
  const phase = phaseOf(view);
  if (phase === "not_found") return <p className="ak-ans__p">{t("ask.not_found")}</p>;
  return (
    <div className="ak-ans">
      {phase === "streaming" && !view.text && <div className="ak-status">{t("ask.answering")}</div>}
      {paragraphs(view.text).map((p, i) => (
        <p key={i} className="ak-ans__p">
          {p}
        </p>
      ))}
      {phase === "stopped" && <div className="ak-status">{t("ask.stopped")}</div>}
      {phase === "interrupted" && <div className="ak-status">{t("ask.interrupted")}</div>}
      {phase === "error" && <div className="ak-status">{t("ask.error")}</div>}
    </div>
  );
}
