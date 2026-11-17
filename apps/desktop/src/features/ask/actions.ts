// Ask's core calls as plain async functions, so the page stays thin and the flows are unit-testable without a DOM.
import type { Bridge } from "../../app/bridge/bridge";
import type { AskAnswer, AskScope, AskThreadRow, ScopePreset, TimeSpan } from "../../core/bindings";
import { navigate } from "../shell/navigate";
import { searchRoute } from "../shell/sections";
import type { Replay } from "../transcript/playback";
import { toMarkdown } from "./copy";
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
export async function openThread(bridge: Bridge, id: string | null, set: ThreadSetters, keepStream = false): Promise<void> {
  set.setThread(id);
  set.setTurns([]);
  set.setAsking(null);
  if (!keepStream) void bridge.unsubscribe("ask_start"); // a turn still answering is kept listened to, so Recent can learn it ended
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

/** The core stored this turn: reload the thread. A failed turn keeps its partial on screen instead. */
export const isStored = (phase: TurnPhase | null): boolean => phase === "ready" || phase === "weak" || phase === "not_found" || phase === "stopped"; // a stopped turn is stored with its partial answer

/** ⌘. while an answer streams. */
export const isStopKey = (e: { key: string; metaKey: boolean }): boolean => e.metaKey && e.key === ".";

/** The ask_start stream of the turn now being asked: the previous turn's data stays in the slice until the new subscription replaces it, and must not settle or render as the new answer. */
export const currentStream = <T extends { turn_id: string }>(data: T | null, previousTurn: string | null): T | null => (data && data.turn_id !== previousTurn ? data : null);

/** The turn a new question follows: the one whose data the stream slice holds now (or the one before it while that has not arrived). */
export const afterTurn = (current: { turn_id: string } | null, previous: string | null): string | null => current?.turn_id ?? previous;
/** Write the turn as Markdown to the clipboard; a rejected write is reported, never thrown. */
export async function copyTurn(answer: Pick<AskAnswer, "answer_md" | "citations">, write: (text: string) => Promise<void>): Promise<"copied" | "failed"> {
  // @cpt-begin:cpt-noter-state-ui-ask-turn:p1:inst-copy
  try {
    await write(toMarkdown(answer));
    return "copied";
  } catch {
    return "failed";
  }
  // @cpt-end:cpt-noter-state-ui-ask-turn:p1:inst-copy
}

/** Delete a thread; true when the core removed it, so the list refreshes and an open thread closes. */
export async function deleteThread(bridge: Bridge, id: string): Promise<boolean> {
  const res = await bridge.act("ask:delete", "ask_thread_delete", () => bridge.core.askThreadDelete({ thread_id: id }));
  return res.status === "ok";
}

/** Ask the core to play from `from_ms` (to `to_ms`, or the segment's end); its `playback:state` reports back. */
export const playAudio = (bridge: Bridge, callId: string, from_ms: number, to_ms: number | null) =>
  bridge.act("audio_play", "audio_play", () => bridge.core.audioPlay({ call_id: callId, from_ms, to_ms }), { slice: "playback" });

export const stopAudio = (bridge: Bridge) => bridge.act("audio_stop", "audio_stop", () => bridge.core.audioStop({}), { slice: "playback" });

/** The replay a citation's span starts. */
export const replayOf = (span: TimeSpan, version: number): Replay => ({ key: `${span.call_id}:${span.t0_ms}`, call_id: span.call_id, from_ms: span.t0_ms, to_ms: span.t1_ms, speaker: "", since: version, paused: false });

/** Delete a thread; when it was open, show the empty composer, and refresh Recent. */
export async function removeThread(bridge: Bridge, id: string, openId: string | null, h: { open: (id: string | null) => void; refresh: () => void }): Promise<void> {
  if (!(await deleteThread(bridge, id))) return;
  if (id === openId) h.open(null);
  h.refresh();
}

/** Listen for ⌘. on `doc` and stop; returns the unlisten function. */
export function bindStopKey(doc: Pick<Document, "addEventListener" | "removeEventListener">, stop: () => void): () => void {
  const onKey = (e: KeyboardEvent) => isStopKey(e) && (e.preventDefault(), stop());
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
}

/** Copy a question's text; a refused write is ignored (the menu closes either way). */
export const copyText = (text: string, write: (s: string) => Promise<void>): Promise<void> => write(text).catch(() => {});

/** Search by Keyword: the Library's search for the question's own words. */
export const searchByKeyword = (question: string): void => navigate(searchRoute(question));

/** A turn the user left while it was answering has ended: its id, once, so Recent refreshes to show it; null otherwise. */
export function endedWhileAway(raw: { turn_id: string } | null, phase: TurnPhase | null, asking: string | null, handled: string | null): string | null {
  if (!raw || asking !== null || phase === null || phase === "streaming" || raw.turn_id === handled) return null;
  return raw.turn_id;
}

/** The question a `new:<words>` route carries (Search's **Ask Instead**, a Library question), or null for any other route. */
export function questionOfRoute(key: string): string | null {
  if (!key.startsWith("new:")) return null;
  const words = key.slice("new:".length);
  let text = words;
  try {
    text = decodeURIComponent(words);
  } catch {
    // malformed escapes: the words as they came
  }
  return text.trim() || null;
}

/** Ask the routed question once: returns the route key now handled, so a re-render on the same key does not ask again. */
export function startFromRoute(key: string, handled: string | null, ask: (question: string) => void): string | null {
  const question = questionOfRoute(key);
  if (!question || key === handled) return handled;
  ask(question);
  return key;
}
