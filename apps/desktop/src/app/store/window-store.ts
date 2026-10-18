// The window store (DESIGN › App layer — Window store): one in-memory Zustand store per WebView
// window, holding only what the core sent. Whole-state slices are kept by highest `version`,
// entities by identity, Channel messages are flushed in by the bridge every 100 ms. Nothing is
// persisted in the WebView. The reducers are pure so the bridge commits one update per change.

import { createStore } from "zustand/vanilla";

import type {
  AgentView,
  AppSnapshot,
  AskHandle,
  AskMsg,
  CallRow,
  CardMsg,
  CardsSnapshot,
  CardView,
  ChannelCommand,
  ChannelMessages,
  ErrorCode,
  EventName,
  EventPayloads,
  HandoffView,
  ItemView,
  JobRunRow,
  LevelsMsg,
  NavTarget,
  OutputsProgress,
  PersonRow,
  SelfTestMsg,
  SignInProgress,
  SourceRow,
  SpeakerView,
  StreamEndReason,
  SubscriptionHandle,
  TopicRow,
  TranscriptMsg,
  TranscriptSnapshot,
  WindowLabel,
} from "../../core/bindings";

/** Whole-state events (each payload carries a `version`) and the store slice each one fills. */
export const WHOLE_STATE = {
  "capture:state": "capture",
  "capture:detected": "detection",
  "copilot:status": "copilot",
  "degraded:changed": "degraded",
  "banners:changed": "banners",
  "proposals:counts": "proposals",
  "setup:changed": "setup",
  "env:changed": "environment",
  "settings:changed": "settings",
  "privacy:changed": "privacy",
  "accounts:changed": "accounts",
  "hotkeys:changed": "hotkeys",
  "playback:state": "playback",
  "window:call": "callWindow",
  "app:presenting": "presenting",
} as const satisfies Partial<Record<EventName, string>>;

type WholeEvent = keyof typeof WHOLE_STATE;
export type WholeSlices = { [E in WholeEvent as (typeof WHOLE_STATE)[E]]: EventPayloads[E] };
export type WholeName = keyof WholeSlices;

/** The `app_snapshot` fields that are whole-state slices (named as the store names them). */
const SNAPSHOT_SLICES = ["setup", "capture", "detection", "copilot", "privacy", "presenting", "degraded", "accounts", "proposals", "banners", "environment"] as const satisfies readonly (WholeName & keyof AppSnapshot)[];

export interface Entities {
  call: Record<string, CallRow>;
  item: Record<string, ItemView>;
  person: Record<string, PersonRow>;
  topic: Record<string, TopicRow>;
  agent: Record<string, AgentView>;
  source: Record<string, SourceRow>;
  /** Keyed by the item the handoff belongs to. */
  handoff: Record<string, HandoffView>;
  speaker: Record<string, SpeakerView>;
}

/** What each Channel's slice holds: its subscribing command's snapshot, kept current by the stream. */
export interface StreamData {
  transcript_subscribe: TranscriptSnapshot;
  levels_subscribe: SubscriptionHandle & { levels: LevelsMsg | null };
  cards_subscribe: CardsSnapshot & { feedback: { key: number; outcome: string; card_id: string | null } | null };
  ask_start: AskHandle & { messages: AskMsg[] };
  self_test_run: SubscriptionHandle & { messages: SelfTestMsg[] };
}

/** A typed error mapped to the state a screen shows (`state: "section"` is the section-level error). */
export interface ErrorState {
  code: ErrorCode | null;
  state: string;
  tryAgain: boolean;
}

export interface Stream<K extends ChannelCommand> {
  data: StreamData[K] | null;
  slow: boolean;
  ended: StreamEndReason | null;
  error: ErrorState | null;
}

// @cpt-state:cpt-noter-state-ui-core-bridge-command:p1
export interface CommandState {
  state: "IDLE" | "WAITING" | "DONE" | "ERROR";
  error: ErrorState | null;
}

// @cpt-state:cpt-noter-state-ui-core-bridge-window-store:p1
export type WindowStatus = "EMPTY" | "LOADING" | "READY" | "RESYNCING" | "FAILED" | "CLOSED";

export interface WindowState {
  label: WindowLabel;
  status: WindowStatus;
  /** The snapshot has taken longer than 300 ms (screens show skeleton rows). */
  slow: boolean;
  error: ErrorState | null;
  /** The snapshot's plain parts. */
  app: Pick<AppSnapshot, "contract_version" | "app_version" | "window" | "features" | "prefs"> | null;
  whole: Partial<WholeSlices>;
  entities: Entities;
  /** `outputs:progress`, keyed `call_id/section`. */
  outputs: Record<string, OutputsProgress>;
  jobs: Record<string, JobRunRow>;
  signin: Record<string, SignInProgress>;
  /** The core's last navigation request (`nav:request`). */
  nav: NavTarget | null;
  streams: { [K in ChannelCommand]?: Stream<K> };
  /** Controls waiting for a response, by the key the screen chose. */
  commands: Record<string, CommandState>;
}

export type AnyEvent = { [E in EventName]: { event: E; payload: EventPayloads[E] } }[EventName];

export function initialState(label: WindowLabel, status: WindowStatus = "EMPTY"): WindowState {
  return {
    label,
    status,
    slow: false,
    error: null,
    app: null,
    whole: {},
    entities: { call: {}, item: {}, person: {}, topic: {}, agent: {}, source: {}, handoff: {}, speaker: {} },
    outputs: {},
    jobs: {},
    signin: {},
    nav: null,
    streams: {},
    commands: {},
  };
}

// @cpt-component:cpt-noter-component-app-window-store:p1
// @cpt-dod:cpt-noter-dod-ui-core-bridge-store:p1
export function createWindowStore(label: WindowLabel) {
  return createStore<WindowState>(() => initialState(label));
}

export type WindowStore = ReturnType<typeof createWindowStore>;

// @cpt-algo:cpt-noter-algo-ui-core-bridge-apply-whole-state:p1
export function applyWhole<N extends WholeName>(s: WindowState, name: N, payload: WholeSlices[N] | null): WindowState {
  if (!payload) return s;
  // @cpt-begin:cpt-noter-algo-ui-core-bridge-apply-whole-state:p1:inst-read-version
  const held = s.whole[name];
  // @cpt-end:cpt-noter-algo-ui-core-bridge-apply-whole-state:p1:inst-read-version
  // @cpt-begin:cpt-noter-algo-ui-core-bridge-apply-whole-state:p1:inst-if-older
  if (held && held.version >= payload.version) {
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-apply-whole-state:p1:inst-return-unchanged
    return s;
    // @cpt-end:cpt-noter-algo-ui-core-bridge-apply-whole-state:p1:inst-return-unchanged
  }
  // @cpt-end:cpt-noter-algo-ui-core-bridge-apply-whole-state:p1:inst-if-older
  // @cpt-begin:cpt-noter-algo-ui-core-bridge-apply-whole-state:p1:inst-replace
  const whole = { ...s.whole, [name]: payload };
  // @cpt-end:cpt-noter-algo-ui-core-bridge-apply-whole-state:p1:inst-replace
  // @cpt-begin:cpt-noter-algo-ui-core-bridge-apply-whole-state:p1:inst-return-updated
  return { ...s, whole };
  // @cpt-end:cpt-noter-algo-ui-core-bridge-apply-whole-state:p1:inst-return-updated
}

export function applySnapshot(s: WindowState, snap: AppSnapshot): WindowState {
  const { contract_version, app_version, window, features, prefs } = snap;
  let next: WindowState = { ...s, app: { contract_version, app_version, window, features, prefs } };
  for (const name of SNAPSHOT_SLICES) next = applyWhole(next, name, snap[name] as never);
  return next;
}

function setEntity<K extends keyof Entities>(s: WindowState, kind: K, id: string, record: Entities[K][string]): WindowState {
  return { ...s, entities: { ...s.entities, [kind]: { ...s.entities[kind], [id]: record } } };
}

/**
 * Write the record a command returned (`{<kind>: record, change_id}`, a bare record, or a
 * speakers list), keyed like its entity:changed event; an answer older than the held `rev` is dropped.
 */
export function applyRecord(s: WindowState, kind: keyof Entities, data: unknown): WindowState {
  const d = data as Record<string, unknown>;
  const records = (kind === "speaker" ? (d.speakers ?? [d]) : [d[kind] ?? d]) as Array<{ id?: string; rev?: number | null; item?: { id: string } }>;
  return records.reduce((acc, r) => {
    const id = kind === "handoff" ? r.item!.id : r.id!;
    const held = acc.entities[kind][id] as { rev?: number | null } | undefined;
    if (held?.rev != null && r.rev != null && held.rev > r.rev) return acc;
    return setEntity(acc, kind, id, r as never);
  }, s);
}

/** Apply one of the 20 events: whole state by version, records by identity, the rest as sent. */
export function applyEvent(s: WindowState, e: AnyEvent): WindowState {
  switch (e.event) {
    case "entity:changed": {
      const c = e.payload;
      switch (c.type) {
        case "call":
          return setEntity(s, "call", c.call.id, c.call);
        case "item":
          return setEntity(s, "item", c.item.id, c.item);
        case "person":
          return setEntity(s, "person", c.person.id, c.person);
        case "topic":
          return setEntity(s, "topic", c.topic.id, c.topic);
        case "agent":
          return setEntity(s, "agent", c.agent.id, c.agent);
        case "source":
          return setEntity(s, "source", c.source.id, c.source);
        case "handoff":
          return setEntity(s, "handoff", c.handoff.item.id, c.handoff);
        case "speakers":
          return c.speakers.reduce((acc, sp) => setEntity(acc, "speaker", sp.id, sp), s);
        case "removed": {
          const slice = (s.entities as unknown as Record<string, Record<string, unknown>>)[c.kind];
          if (!slice || !(c.id in slice)) return s;
          const { [c.id]: _gone, ...rest } = slice;
          return { ...s, entities: { ...s.entities, [c.kind]: rest } };
        }
      }
    }
    case "outputs:progress":
      return { ...s, outputs: { ...s.outputs, [`${e.payload.call_id}/${e.payload.section}`]: e.payload } };
    case "jobs:progress":
      return { ...s, jobs: { ...s.jobs, [e.payload.run.id]: e.payload.run } };
    case "signin:progress":
      return { ...s, signin: { ...s.signin, [e.payload.session_id]: e.payload } };
    case "nav:request":
      return { ...s, nav: e.payload };
    default:
      return applyWhole(s, WHOLE_STATE[e.event], e.payload as never);
  }
}

/** Replace records by `id`, appending ones not held yet. */
function upsert<T extends { id: string }>(list: T[], records: T[]): T[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  const next = list.map((r) => byId.get(r.id) ?? r);
  const held = new Set(list.map((r) => r.id));
  return next.concat(records.filter((r) => !held.has(r.id)));
}

/** Insert a row after every row at or before its time. */
function insertAt<T>(list: T[], row: T, at: (r: T) => number): T[] {
  const i = list.findIndex((r) => at(r) > at(row));
  return i < 0 ? [...list, row] : [...list.slice(0, i), row, ...list.slice(i)];
}

// @cpt-algo:cpt-noter-algo-ui-core-bridge-flush-buffer:p1
function flushTranscript(d: TranscriptSnapshot, msgs: TranscriptMsg[]): TranscriptSnapshot {
  const t = { ...d };
  // @cpt-begin:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-for-each-tr
  for (const { event: e } of msgs) {
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-match-tr
    switch (e.type) {
      // @cpt-begin:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-case-confirmed
      case "confirmed":
        t.segments = [...t.segments, e.segment];
        t.hypotheses = t.hypotheses.filter((h) => h.channel !== e.segment.channel);
        break;
      // @cpt-end:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-case-confirmed
      // @cpt-begin:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-case-hypothesis
      case "hypothesis":
        t.hypotheses = [...t.hypotheses.filter((h) => h.channel !== e.segment.channel), e.segment];
        break;
      // @cpt-end:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-case-hypothesis
      // @cpt-begin:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-case-updated
      case "segments_updated":
        t.segments = upsert(t.segments, e.segments);
        break;
      case "speakers_updated":
        t.speakers = upsert(t.speakers, e.speakers);
        break;
      // @cpt-end:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-case-updated
      // @cpt-begin:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-case-gap-mark
      case "gap":
        t.gaps = insertAt(t.gaps, e.gap, (g) => g.t0_ms);
        break;
      case "mark":
        t.marks = insertAt(t.marks, e.mark, (m) => m.at_ms);
        break;
      // @cpt-end:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-case-gap-mark
    }
    // @cpt-end:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-match-tr
  }
  // @cpt-end:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-for-each-tr
  return t;
}

function flushCards(d: StreamData["cards_subscribe"], msgs: CardMsg[]): StreamData["cards_subscribe"] {
  let { visible, earlier, status, feedback } = d;
  const toEarlier = (id: string, state: CardView["state"]) => {
    const card = visible.find((c) => c.id === id);
    if (!card) return;
    visible = visible.filter((c) => c.id !== id);
    earlier = [{ ...card, state }, ...earlier];
  };
  const patch = (id: string, f: (c: CardView) => CardView) => {
    visible = visible.map((c) => (c.id === id ? f(c) : c));
    earlier = earlier.map((c) => (c.id === id ? f(c) : c));
  };
  for (const { event: e } of msgs) {
    if (e.type === "added") visible = [e.card, ...visible];
    else if (e.type === "updated") patch(e.card.id, () => e.card);
    else if (e.type === "merged") patch(e.card_id, (c) => ({ ...c, merged_agents: e.merged_agents }));
    else if (e.type === "removed") toEarlier(e.card_id, e.state);
    else if (e.type === "expired") toEarlier(e.card_id, "expired");
    else if (e.type === "key_feedback") feedback = { key: e.key, outcome: e.outcome, card_id: e.card_id };
    else if (e.type === "status") status = e.status;
  }
  return { ...d, visible, earlier, status, feedback };
}

/** Flush one Channel's buffered messages into its slice (one store update per flush, by the bridge). */
export function reduceStream<K extends ChannelCommand>(cmd: K, data: StreamData[K], msgs: ChannelMessages[K][]): StreamData[K] {
  switch (cmd) {
    case "transcript_subscribe":
      return flushTranscript(data as TranscriptSnapshot, msgs as TranscriptMsg[]) as StreamData[K];
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-levels-newest
    case "levels_subscribe":
      return { ...data, levels: (msgs as LevelsMsg[]).at(-1) ?? null } as StreamData[K];
    // @cpt-end:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-levels-newest
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-cards
    case "cards_subscribe":
      return flushCards(data as StreamData["cards_subscribe"], msgs as CardMsg[]) as StreamData[K];
    // @cpt-end:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-cards
  }
  // ask_start and self_test_run: kept in order as sent; their screens read the events.
  const d = data as StreamData["self_test_run"];
  return { ...d, messages: [...d.messages, ...(msgs as SelfTestMsg[])] } as StreamData[K];
}
