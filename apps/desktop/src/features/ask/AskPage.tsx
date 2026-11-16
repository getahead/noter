// Ask: recent questions (AK-R2), the thread (AK-R3) and the composer (AK-R4); answers stream from the core.
import { useCallback, useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { AskAnswer, AskScope, AskThreadRow, ScopePreset } from "../../core/bindings";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import { TextField } from "../../ui/primitives/text-field";
import { foldTurn, groupThreads, paragraphs, phaseOf, type TurnView } from "./model";
import "./ask.css";

const GROUP = { today: "ask.group.today", yesterday: "ask.group.yesterday", earlier: "ask.group.earlier" } as const;
const NEW_SCOPE: AskScope = { preset: "all" };

// @cpt-component:cpt-noter-component-screen-ask:p1
// @cpt-dod:cpt-noter-dod-ui-ask-threads:p1
// @cpt-flow:cpt-noter-flow-ui-ask-question:p1
export function AskPage({ bridge, routeKey = "root" }: { bridge: Bridge; routeKey?: string }) {
  const [rows, setRows] = useState<AskThreadRow[]>([]);
  const [presets, setPresets] = useState<ScopePreset[]>([]);
  const [scope, setScope] = useState(0);
  const [thread, setThread] = useState<string | null>(null);
  const [turns, setTurns] = useState<AskAnswer[]>([]);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const stream = useWindow(bridge, (s) => s.streams.ask_start);
  const loadError = useWindow(bridge, (s) => s.commands["ask:list"]?.state === "ERROR");

  const refresh = useCallback(async () => {
    // @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-open
    const res = await bridge.act("ask:list", "ask_threads_list", () => bridge.core.askThreadsList({}));
    if (res.status === "ok") setRows(res.data.threads);
    // @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-open
  }, [bridge]);

  useEffect(() => {
    void refresh();
    void bridge.act("ask:presets", "ask_scope_presets", () => bridge.core.askScopePresets({})).then((r) => r.status === "ok" && setPresets(r.data.presets));
    // @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-dispose
    return () => void bridge.unsubscribe("ask_start");
    // @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-dispose
  }, [bridge, refresh]);

  const open = async (id: string | null) => {
    setThread(id);
    setTurns([]);
    setAsking(null);
    void bridge.unsubscribe("ask_start");
    if (!id) return;
    // @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-get-thread
    const res = await bridge.act("ask:thread", "ask_thread_get", () => bridge.core.askThreadGet({ thread_id: id }));
    if (res.status === "ok") setTurns(res.data.turns);
    else setThread(null); // deleted elsewhere: the empty composer
    // @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-get-thread
  };

  const data = stream?.data ?? null;
  // `thread:<id>` opens that thread; the key is the route's, so Back and the core's nav:request land here
  useEffect(() => {
    if (routeKey.startsWith("thread:")) void open(routeKey.slice("thread:".length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  const turn: TurnView | null = data ? foldTurn(data.messages) : null;
  const phase = turn ? phaseOf(turn) : null;
  const busy = asking !== null && phase === "streaming" && !stream?.error;

  // The turn is over for the thread: reload what the core stored.
  useEffect(() => {
    if (!asking || !data || phase === "streaming") return;
    const id = data.thread_id;
    // a failed or stopped turn keeps its partial on screen until the user moves on
    if (phase === "ready" || phase === "weak" || phase === "not_found") {
      setThread(id);
      void bridge.act("ask:thread", "ask_thread_get", () => bridge.core.askThreadGet({ thread_id: id })).then((r) => {
        if (r.status === "ok") {
          setTurns(r.data.turns);
          setAsking(null);
        }
      });
      void refresh();
    }
  }, [asking, data, phase, bridge, refresh]);

  const send = () => {
    const question = draft.trim();
    if (!question || busy) return;
    // @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-start
    setAsking(question);
    setDraft("");
    void bridge.subscribe("ask_start", { thread_id: thread, question, scope: presets[scope]?.scope ?? NEW_SCOPE });
    // @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-start
  };

  const stop = () => {
    // @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-stop
    if (data) void bridge.act("ask:stop", "ask_stop", () => bridge.core.askStop({ turn_id: data.turn_id }));
    // @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-stop
  };

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
              <button key={r.id} type="button" className={`ak-recent__item${r.id === thread ? " is-sel" : ""}`} aria-current={r.id === thread} title={r.title} onClick={() => void open(r.id)}>
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
            {(phase === "error" || phase === "interrupted") && <PushButton label={t("ask.try_again")} onAction={() => { setDraft(asking); setAsking(null); }} />}
          </article>
        )}
        <div className={`ak-composer${empty ? " is-first" : ""}`} data-region="AK-R4">
          {presets.length > 0 && (
            <select aria-label={t("ask.scope")} value={scope} onChange={(e) => setScope(Number(e.target.value))}>
              {presets.map((p, i) => (
                <option key={p.id} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          <TextField
            variant="multi"
            cls="ak-composer__field"
            rows={empty ? 3 : 2}
            ariaLabel={t("ask.question")}
            placeholder={t(empty ? "ask.composer_first" : "ask.composer_follow_up")}
            value={draft}
            onChange={setDraft}
          />
          {busy ? <PushButton label={t("ask.stop")} kbd="⌘." onAction={stop} /> : <PushButton label={t("ask.send")} variant="primary" onAction={send} />}
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
