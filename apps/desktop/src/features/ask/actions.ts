// Ask's core calls as plain async functions, so the page stays thin and the flows are unit-testable without a DOM.
import type { Bridge } from "../../app/bridge/bridge";
import type { AskAnswer, AskScope, AskThreadRow, ScopePreset, TimeSpan } from "../../core/bindings";
import { t } from "../../i18n/format";
import { setAskState } from "./ask-state";
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
  // @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-start-follow-up
  void bridge.subscribe("ask_start", { thread_id: thread, question, scope: scope ?? NEW_SCOPE });
  // @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-start-follow-up
  // @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-start
}

export function stopAsk(bridge: Bridge, turnId: string): void {
  // @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-stop
  // @cpt-begin:cpt-noter-state-ui-ask-turn:p1:inst-stop
  void bridge.act("ask:stop", "ask_stop", () => bridge.core.askStop({ turn_id: turnId }));
  // @cpt-end:cpt-noter-state-ui-ask-turn:p1:inst-stop
  // @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-stop
}

export interface ThreadSetters {
  setThread: (id: string | null) => void;
  setTurns: (t: AskAnswer[]) => void;
  setAsking: (q: string | null) => void;
}

/** Show thread `id` (or the empty composer for null) with its stored turns. */
export async function openThread(bridge: Bridge, id: string | null, set: ThreadSetters, keepStream = false): Promise<void> {
  // @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-return-follow-up
  set.setThread(id);
  // @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-return-follow-up
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
  // @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-return-question
  set.setThread(id);
  // @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-return-question
  void set.refresh();
  if (!isStored(phase)) return;
  const got = await loadThread(bridge, id);
  if (got) {
    set.setTurns(got);
    set.setAsking(null);
  }
}

// @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-compose
/** The trimmed question to send, or null while the draft is empty or an answer is streaming. */
export const questionOf = (draft: string, busy: boolean): string | null => (busy ? null : draft.trim() || null);
// @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-compose

/** The thread id a route key names (`thread:<id>`), if any. */
export const threadOfRoute = (key: string): string | null => (key.startsWith("thread:") ? key.slice("thread:".length) || null : null);

/** The core stored this turn: reload the thread. A failed turn keeps its partial on screen instead. */
export const isStored = (phase: TurnPhase | null): boolean => phase === "ready" || phase === "weak" || phase === "not_found" || phase === "stopped"; // a stopped turn is stored with its partial answer

/** ⌘. while an answer streams. */
export const isStopKey = (e: { key: string; metaKey: boolean }): boolean => e.metaKey && e.key === ".";

// @cpt-begin:cpt-noter-algo-ui-ask-stream:p1:inst-scope
/** The ask_start stream of the turn now being asked: the previous turn's data stays in the slice until the new subscription replaces it, and must not settle or render as the new answer. */
export const currentStream = <T extends { turn_id: string }>(data: T | null, previousTurn: string | null): T | null => (data && data.turn_id !== previousTurn ? data : null);
// @cpt-end:cpt-noter-algo-ui-ask-stream:p1:inst-scope

/** The turn a new question follows: the one whose data the stream slice holds now (or the one before it while that has not arrived). */
export const afterTurn = (current: { turn_id: string } | null, previous: string | null): string | null => current?.turn_id ?? previous;
/** Write the turn as Markdown to the clipboard; a rejected write is reported, never thrown. */
export async function copyTurn(answer: Pick<AskAnswer, "answer_md" | "citations">, write: (text: string) => Promise<void>): Promise<"copied" | "failed"> {
  // @cpt-begin:cpt-noter-state-ui-ask-turn:p1:inst-copy
  try {
    // @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-clipboard
    await write(toMarkdown(answer));
    return "copied";
    // @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-clipboard
  } catch {
    return "failed";
  }
  // @cpt-end:cpt-noter-state-ui-ask-turn:p1:inst-copy
}

/** Delete a thread; true when the core removed it, so the list refreshes and an open thread closes. */
export async function deleteThread(bridge: Bridge, id: string): Promise<boolean> {
  // @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-deleted-thread
  const res = await bridge.act("ask:delete", "ask_thread_delete", () => bridge.core.askThreadDelete({ thread_id: id }));
  return res.status === "ok";
  // @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-deleted-thread
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
  // @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-if-stop
  const onKey = (e: KeyboardEvent) => isStopKey(e) && (e.preventDefault(), stop());
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
  // @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-if-stop
}

// @cpt-begin:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-manage
/** Copy a question's text; a refused write is ignored (the menu closes either way). */
export const copyText = (text: string, write: (s: string) => Promise<void>): Promise<void> => write(text).catch(() => {});
// @cpt-end:cpt-noter-flow-ui-ask-follow-up-copy:p1:inst-manage

// @cpt-begin:cpt-noter-flow-ui-ask-question:p1:inst-search
/** Open a cited document (at its chunk) in the app that holds it; the core reports an unreachable one. */
export const openDocument = (bridge: Bridge, document_id: string, chunk_id: string) =>
  bridge.act("ask:open_document", "open_external", () => bridge.core.openExternal({ target: { type: "document", document_id, chunk_id } }));

/** Search by Keyword: the Library's search for the question's own words. */
export const searchByKeyword = (question: string): void => navigate(searchRoute(question));
// @cpt-end:cpt-noter-flow-ui-ask-question:p1:inst-search

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

// The route keys already asked. A module set, not a ref: the shell unmounts the page on a section change and history
// keeps the `new:<words>` entry, so Back, Forward or the sidebar remount it and must not ask again.
const routed = new Set<string>();

/** Ask the routed question once per history entry; false when the key carries none or was asked already. */
export function startFromRoute(key: string, ask: (question: string) => void): boolean {
  const question = questionOfRoute(key);
  if (!question || routed.has(key)) return false;
  routed.add(key);
  ask(question);
  return true;
}

/** The scope of the core's `topic:<id>` preset. */
export const topicScope = (id: string): AskScope => ({ preset: `topic:${id}`, topic_id: id });

/** The scope a question is sent with: the chosen preset's, or for a `topic:<id>` choice the preset list does not carry (yet), the topic's own. */
export const scopeOf = (presets: readonly ScopePreset[], scopeId: string): AskScope | undefined =>
  presets.find((p) => p.id === scopeId)?.scope ?? (scopeId.startsWith("topic:") ? topicScope(scopeId.slice("topic:".length)) : undefined);

/** The topic id a `new-topic:<id>` route names (Library's Ask About This Thread), or null for any other route. */
export const topicOfRoute = (key: string): string | null => (key.startsWith("new-topic:") ? key.slice("new-topic:".length) || null : null);

/** Ask about the routed topic once per history entry: its name makes the question, its id the scope. False when the key names no topic, was asked already, or the topic cannot be read (the key stays askable). */
export async function startFromTopicRoute(bridge: Bridge, key: string, ask: (question: string, scope: AskScope) => void, alive: () => boolean = () => true, onError: () => void = () => {}): Promise<boolean> {
  const id = topicOfRoute(key);
  if (!id || routed.has(key)) return false;
  routed.add(key);
  const res = await bridge.act("ask:topic", "topic_get", () => bridge.core.topicGet({ topic_id: id }));
  if (res.status !== "ok" || !alive()) {
    routed.delete(key);
    if (alive()) onError();
    return false;
  }
  setAskState({ scopeId: `topic:${id}` }); // the toolbar pop-up shows the topic scope, and follow-ups keep it
  ask(t("ask.topic_question", { name: res.data.topic.name }), topicScope(id));
  return true;
}

/** Start what a `new:` or `new-topic:` route asks, from a timer the returned cleanup cancels: a development double mount (effect, cleanup, effect) must not leave the asked-once guard set while the cleanup has dropped the stream, and a page left at once asks nothing. */
export function startRoute(bridge: Bridge, key: string, ask: (question: string, scope?: AskScope) => void, onError?: () => void): () => void {
  let alive = true;
  const h = setTimeout(() => {
    startFromRoute(key, ask);
    void startFromTopicRoute(bridge, key, ask, () => alive, onError);
  }, 0);
  return () => {
    alive = false;
    clearTimeout(h);
  };
}

/** A routed turn failed: forget that its entry was asked, so Back, Forward or a remount asks it again (Try Again already does). */
export function releaseFailedRoute(key: string, phase: TurnPhase | null): void {
  if (phase === "error") routed.delete(key);
}

/** Once the routed question is stored its history entry becomes the thread: Back then reopens that thread, and a later Ask Instead with the same words asks again. */
export function settleRoute(key: string, threadId: string | null, stored: boolean, replace: (route: { section: "ask"; key: string }) => void): void {
  if (!(key.startsWith("new:") || key.startsWith("new-topic:")) || !threadId || !stored) return;
  routed.delete(key);
  replace({ section: "ask", key: `thread:${threadId}` });
}

/** The ask_start stream lost events (the bridge ended it as lagged): the applied deltas cannot be trusted, so drop the live turn and show what the core stored. */
export async function recoverGap(bridge: Bridge, threadId: string, set: ThreadSetters & { refresh: () => Promise<void> }): Promise<void> {
  set.setThread(threadId);
  void set.refresh();
  const got = await loadThread(bridge, threadId);
  if (got) set.setTurns(got);
  set.setAsking(null);
}

/** Widen Scope: choose All calls · all sources and ask the same question again with it. */
export function widenScope(question: string, ask: (question: string, scope: AskScope) => void): void {
  setAskState({ scopeId: "all" });
  ask(question, NEW_SCOPE);
}
