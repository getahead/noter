// Ask's core calls as plain async functions, so the page stays thin and the flows are unit-testable without a DOM.
import type { Bridge } from "../../app/bridge/bridge";
import type { AskAnswer, AskScope, AskThreadRow, ScopePreset } from "../../core/bindings";
import type { TurnPhase } from "./model";

export const NEW_SCOPE: AskScope = { preset: "all" };

export async function loadRows(bridge: Bridge): Promise<AskThreadRow[] | null> {
  // @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-open
  const res = await bridge.act("ask:list", "ask_threads_list", () => bridge.core.askThreadsList({}));
  return res.status === "ok" ? res.data.threads : null;
  // @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-open
}

export async function loadPresets(bridge: Bridge): Promise<ScopePreset[] | null> {
  const res = await bridge.act("ask:presets", "ask_scope_presets", () => bridge.core.askScopePresets({}));
  return res.status === "ok" ? res.data.presets : null;
}

/** The thread's stored turns, or null when it cannot be read (deleted elsewhere). */
export async function loadThread(bridge: Bridge, id: string): Promise<AskAnswer[] | null> {
  // @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-get-thread
  const res = await bridge.act("ask:thread", "ask_thread_get", () => bridge.core.askThreadGet({ thread_id: id }));
  return res.status === "ok" ? res.data.turns : null;
  // @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-get-thread
}

export function startAsk(bridge: Bridge, thread: string | null, question: string, scope: AskScope | undefined): void {
  // @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-start
  void bridge.subscribe("ask_start", { thread_id: thread, question, scope: scope ?? NEW_SCOPE });
  // @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-start
}

export function stopAsk(bridge: Bridge, turnId: string): void {
  // @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-stop
  void bridge.act("ask:stop", "ask_stop", () => bridge.core.askStop({ turn_id: turnId }));
  // @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-stop
}

export interface ThreadSetters {
  setThread: (id: string | null) => void;
  setTurns: (t: AskAnswer[]) => void;
  setAsking: (q: string | null) => void;
}

/** Show thread `id` (or the empty composer for null) with its stored turns. */
export async function openThread(bridge: Bridge, id: string | null, set: ThreadSetters): Promise<void> {
  set.setThread(id);
  set.setTurns([]);
  set.setAsking(null);
  void bridge.unsubscribe("ask_start");
  if (!id) return;
  const got = await loadThread(bridge, id);
  if (got) set.setTurns(got);
  else set.setThread(null); // deleted elsewhere: the empty composer
}

/** When a turn ends the core has stored its thread: keep the id (the next question is a follow-up) and refresh Recent; a stored answer replaces the live one, a failed or stopped partial stays on screen. */
export async function settleTurn(bridge: Bridge, id: string, phase: TurnPhase | null, set: ThreadSetters & { refresh: () => Promise<void> }): Promise<void> {
  if (phase === null || phase === "streaming") return;
  set.setThread(id);
  void set.refresh();
  if (!isStored(phase)) return;
  const got = await loadThread(bridge, id);
  if (got) {
    set.setTurns(got);
    set.setAsking(null);
  }
}

/** The trimmed question to send, or null while the draft is empty or an answer is streaming. */
export const questionOf = (draft: string, busy: boolean): string | null => (busy ? null : draft.trim() || null);

/** The thread id a route key names (`thread:<id>`), if any. */
export const threadOfRoute = (key: string): string | null => (key.startsWith("thread:") ? key.slice("thread:".length) || null : null);

/** The core stored this turn: reload the thread. A failed or stopped turn keeps its partial on screen instead. */
export const isStored = (phase: TurnPhase | null): boolean => phase === "ready" || phase === "weak" || phase === "not_found";

/** ⌘. while an answer streams. */
export const isStopKey = (e: { key: string; metaKey: boolean }): boolean => e.metaKey && e.key === ".";
