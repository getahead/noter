// The core bridge (DESIGN › App layer — Core bridge): one per WebView window, over the
// generated client `createCore()`. It owns every command call, event and Channel subscription
// of its window, writes what the core sends into the window store, and turns typed errors into
// named states. It never retries on its own and never logs content (src/core/README.md).

import {
  CONTRACT_VERSION,
  createCore,
  EVENTS,
  type ChannelCommand,
  type ChannelMessages,
  type CommandArgs,
  type CommandName,
  type CommandResults,
  type CoreError,
  type ErrorCode,
  type EventName,
  type Result,
  type StreamEndReason,
  type Transport,
  type WindowLabel,
} from "../../core/bindings";
import {
  applyEvent,
  applySnapshot,
  applyWhole,
  createWindowStore,
  initialState,
  reduceStream,
  type AnyEvent,
  type CommandState,
  type ErrorState,
  type Stream,
  type StreamData,
  type WholeName,
  type WindowState,
} from "../store/window-store";

const FLUSH_MS = 100;
const SLOW_MS = 300;

/** A screen's States table: the named state it shows for an error code. */
export type NamedStates = Partial<Record<ErrorCode, string>>;

export interface ActOptions {
  named?: NamedStates;
  /** The screen that sent the command, for the log (defaults to the window label). */
  screen?: string;
  /** Write the returned whole-state payload into this slice (highest `version` wins). */
  slice?: WholeName;
}

type StreamMsg = { seq: number; event?: { type: string; reason?: StreamEndReason } };
type Subscribe<K extends ChannelCommand> = (args: CommandArgs[K], onMessage: (m: ChannelMessages[K]) => void) => Promise<Result<CommandResults[K]>>;

const major = (version: string) => version.split(".")[0];

function initialData<K extends ChannelCommand>(cmd: K, r: CommandResults[K]): StreamData[K] {
  if (cmd === "transcript_subscribe") return r as StreamData[K];
  if (cmd === "levels_subscribe") return { ...r, levels: null } as StreamData[K];
  if (cmd === "cards_subscribe") return { ...r, feedback: null } as StreamData[K];
  return { ...r, messages: [] } as unknown as StreamData[K];
}

/** Report `slow` once `p` has taken longer than 300 ms, and clear it when it settles. */
async function slowAfter<T>(p: Promise<T>, mark: (slow: boolean) => void): Promise<T> {
  // @cpt-begin:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-if-slow
  const timer = setTimeout(() => mark(true), SLOW_MS);
  // @cpt-end:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-if-slow
  try {
    return await p;
  } finally {
    clearTimeout(timer);
    mark(false);
  }
}

// @cpt-component:cpt-noter-component-app-core-bridge:p1
// @cpt-dod:cpt-noter-dod-ui-core-bridge-bridge:p1
// @cpt-dod:cpt-noter-dod-ui-core-bridge-errors:p1
export function createBridge(label: WindowLabel, transport: Transport) {
  const core = createCore(transport);
  // @cpt-begin:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-create-store
  const store = createWindowStore(label);
  // @cpt-end:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-create-store
  const set = store.setState;
  const subscribers: { [K in ChannelCommand]: Subscribe<K> } = {
    transcript_subscribe: core.transcriptSubscribe,
    levels_subscribe: core.levelsSubscribe,
    cards_subscribe: core.cardsSubscribe,
    ask_start: core.askStart,
    self_test_run: core.selfTestRun,
  };
  const subs = new Map<ChannelCommand, { token: number; id: string | null }>();
  const buffers = new Map<ChannelCommand, StreamMsg[]>();
  const retries = new Map<string, () => Promise<unknown>>();
  let listening: Promise<(() => void)[]> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let token = 0;
  let resyncing = 0;
  let closed = false;

  const log = (level: "warn" | "error", code: ErrorCode | null, message: string, screen: string = label) =>
    void core.logUi({ level, screen, code, message });

  // @cpt-algo:cpt-noter-algo-ui-core-bridge-map-error:p1
  function mapError(error: CoreError, cmd: CommandName, named: NamedStates = {}, screen?: string): ErrorState {
    const { code, retryable } = error;
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-map-error:p1:inst-if-named
    const state = named[code];
    if (state) {
      // @cpt-begin:cpt-noter-algo-ui-core-bridge-map-error:p1:inst-return-named
      return { code, state, tryAgain: retryable };
      // @cpt-end:cpt-noter-algo-ui-core-bridge-map-error:p1:inst-return-named
    }
    // @cpt-end:cpt-noter-algo-ui-core-bridge-map-error:p1:inst-if-named
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-map-error:p1:inst-if-bug
    const bug = code === "window_not_allowed" || code === "invalid_input";
    // @cpt-end:cpt-noter-algo-ui-core-bridge-map-error:p1:inst-if-bug
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-map-error:p1:inst-log-bug
    log(bug ? "error" : "warn", code, cmd, screen); // the command and the code, never content
    // @cpt-end:cpt-noter-algo-ui-core-bridge-map-error:p1:inst-log-bug
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-map-error:p1:inst-return-generic
    return { code, state: "section", tryAgain: retryable };
    // @cpt-end:cpt-noter-algo-ui-core-bridge-map-error:p1:inst-return-generic
  }

  // @cpt-state:cpt-noter-state-ui-core-bridge-window-store:p1
  function failWindow(error: ErrorState): void {
    // @cpt-begin:cpt-noter-state-ui-core-bridge-window-store:p1:inst-loading-failed
    set({ status: "FAILED", error });
    // @cpt-end:cpt-noter-state-ui-core-bridge-window-store:p1:inst-loading-failed
  }

  const setStream = <K extends ChannelCommand>(cmd: K, patch: Partial<Stream<K>>) =>
    set((s) => ({ streams: { ...s.streams, [cmd]: { data: null, slow: false, ended: null, error: null, ...s.streams[cmd], ...patch } } }));

  const setCommand = (key: string, c: CommandState) => set((s) => ({ commands: { ...s.commands, [key]: c } }));

  // @cpt-flow:cpt-noter-flow-ui-core-bridge-open-window:p1
  async function open(): Promise<void> {
    if (closed) return;
    // @cpt-begin:cpt-noter-state-ui-core-bridge-window-store:p1:inst-empty-loading
    // @cpt-begin:cpt-noter-state-ui-core-bridge-window-store:p1:inst-failed-loading
    set({ status: "LOADING", error: null });
    // @cpt-end:cpt-noter-state-ui-core-bridge-window-store:p1:inst-failed-loading
    // @cpt-end:cpt-noter-state-ui-core-bridge-window-store:p1:inst-empty-loading
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-subscribe-events
    listening ??= Promise.all(
      (Object.keys(EVENTS) as EventName[]).map((event) =>
        core.on(event, (payload) => {
          if (!closed) set((s) => applyEvent(s, { event, payload } as AnyEvent));
        }),
      ),
    );
    await listening;
    // @cpt-end:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-subscribe-events
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-api-snapshot
    const res = await slowAfter(core.appSnapshot({}), (slow) => set({ slow }));
    // @cpt-end:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-api-snapshot
    if (closed) return;
    if (res.status === "error") return failWindow(mapError(res.error, "app_snapshot"));
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-if-version
    const theirs = res.data.contract_version;
    if (major(theirs) !== major(CONTRACT_VERSION)) {
      // @cpt-begin:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-version-stop
      log("error", null, `app_snapshot: contract ${theirs}, bindings ${CONTRACT_VERSION}`);
      return failWindow({ code: null, state: "section", tryAgain: false });
      // @cpt-end:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-version-stop
    }
    // @cpt-end:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-if-version
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-apply-snapshot
    // @cpt-begin:cpt-noter-state-ui-core-bridge-window-store:p1:inst-loading-ready
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-return-window
    set((s) => ({ ...applySnapshot(s, res.data), status: "READY" }));
    // @cpt-end:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-return-window
    // @cpt-end:cpt-noter-state-ui-core-bridge-window-store:p1:inst-loading-ready
    // @cpt-end:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-apply-snapshot
  }

  function flush(): void {
    flushTimer = null;
    const batch = [...buffers];
    buffers.clear();
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-commit
    set((s) => {
      const streams = { ...s.streams } as Record<ChannelCommand, Stream<ChannelCommand> | undefined>;
      for (const [cmd, msgs] of batch) {
        const st = streams[cmd];
        if (!st?.data) continue;
        const last = msgs.at(-1)?.event;
        const ended = last?.type === "ended" ? (last.reason ?? null) : st.ended;
        streams[cmd] = { ...st, data: reduceStream(cmd, st.data, msgs as never), ended };
      }
      // @cpt-begin:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-return-flush
      return { streams: streams as WindowState["streams"] };
      // @cpt-end:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-return-flush
    });
    // @cpt-end:cpt-noter-algo-ui-core-bridge-flush-buffer:p1:inst-commit
  }

  function buffer(cmd: ChannelCommand, m: StreamMsg): void {
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-buffer
    buffers.set(cmd, [...(buffers.get(cmd) ?? []), m]);
    // @cpt-end:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-buffer
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-flush
    flushTimer ??= setTimeout(flush, FLUSH_MS);
    // @cpt-end:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-flush
  }

  function resync<K extends ChannelCommand>(cmd: K, args: CommandArgs[K], named?: NamedStates): void {
    resyncing++;
    // @cpt-begin:cpt-noter-state-ui-core-bridge-window-store:p1:inst-ready-resync
    if (store.getState().status === "READY") set({ status: "RESYNCING" });
    // @cpt-end:cpt-noter-state-ui-core-bridge-window-store:p1:inst-ready-resync
    void subscribe(cmd, args, named).finally(() => {
      // @cpt-begin:cpt-noter-state-ui-core-bridge-window-store:p1:inst-resync-ready
      if (--resyncing === 0 && store.getState().status === "RESYNCING") set({ status: "READY" });
      // @cpt-end:cpt-noter-state-ui-core-bridge-window-store:p1:inst-resync-ready
    });
  }

  /** Snapshot, then stream: fill the Channel's slice from the result, then keep it current. */
  // @cpt-algo:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1
  async function subscribe<K extends ChannelCommand>(cmd: K, args: CommandArgs[K], named?: NamedStates): Promise<void> {
    if (closed) return;
    const previous = subs.get(cmd)?.id;
    const mine = ++token;
    subs.set(cmd, { token: mine, id: null });
    buffers.delete(cmd);
    if (previous) await core.streamUnsubscribe({ subscription_id: previous });
    const current = () => !closed && subs.get(cmd)?.token === mine;
    let lastSeq: number | null = null;
    const early: StreamMsg[] = [];
    const receive = (m: StreamMsg): void => {
      if (!current()) return;
      // Messages the generated client releases before the result is ours wait for `last_seq`.
      if (lastSeq === null) return void early.push(m);
      // @cpt-begin:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-for-each-msg
      // @cpt-begin:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-if-gap
      // @cpt-begin:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-if-ended
      // @cpt-begin:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-map-ended
      const lagged = m.event?.type === "ended" && m.event.reason === "lagged";
      // @cpt-end:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-map-ended
      // @cpt-end:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-if-ended
      if (m.seq !== lastSeq + 1 || lagged) {
        // @cpt-begin:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-resubscribe
        return resync(cmd, args, named);
        // @cpt-end:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-resubscribe
      }
      // @cpt-end:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-if-gap
      lastSeq = m.seq;
      if (m.event?.type === "ended") subs.delete(cmd); // the core ended it: nothing to unsubscribe
      buffer(cmd, m);
      // @cpt-end:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-for-each-msg
    };
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-call-subscribing
    const subscribing = (subscribers[cmd] as Subscribe<K>)(args, receive as (m: ChannelMessages[K]) => void);
    const res = await slowAfter(subscribing, (slow) => setStream(cmd, { slow }));
    // @cpt-end:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-call-subscribing
    if (!current()) {
      // Superseded or closed while waiting: end the Channel this call opened.
      const id = res.status === "ok" ? res.data.subscription_id : null;
      if (id) await core.streamUnsubscribe({ subscription_id: id });
      return;
    }
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-if-sub-error
    if (res.status === "error") {
      subs.delete(cmd);
      // @cpt-begin:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-return-sub-error
      return setStream(cmd, { error: mapError(res.error, cmd, named) });
      // @cpt-end:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-return-sub-error
    }
    // @cpt-end:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-if-sub-error
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-store-snapshot
    subs.set(cmd, { token: mine, id: res.data.subscription_id });
    lastSeq = (res.data as { last_seq?: number }).last_seq ?? 0;
    setStream(cmd, { data: initialData(cmd, res.data), ended: null, error: null });
    // @cpt-end:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-store-snapshot
    // @cpt-begin:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-return-live
    early.splice(0).forEach(receive);
    // @cpt-end:cpt-noter-algo-ui-core-bridge-snapshot-then-stream:p1:inst-return-live
  }

  /** End one Channel (the screen showing it went away) and drop its slice. */
  async function unsubscribe(cmd: ChannelCommand): Promise<void> {
    const id = subs.get(cmd)?.id;
    subs.delete(cmd);
    buffers.delete(cmd);
    set((s) => ({ streams: { ...s.streams, [cmd]: undefined } }));
    if (id) await core.streamUnsubscribe({ subscription_id: id });
  }

  /**
   * Run a command for a control keyed `key`: WAITING until the core answers, then DONE, or ERROR
   * with the mapped named state. Send the wanted state and the record's `rev`; never a toggle.
   */
  // @cpt-flow:cpt-noter-flow-ui-core-bridge-act:p1
  async function act<T>(key: string, cmd: CommandName, run: () => Promise<Result<T>>, opts: ActOptions = {}): Promise<Result<T>> {
    retries.set(key, () => act(key, cmd, run, opts));
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-act:p1:inst-loading
    // @cpt-begin:cpt-noter-state-ui-core-bridge-command:p1:inst-idle-waiting
    setCommand(key, { state: "WAITING", error: null });
    // @cpt-end:cpt-noter-state-ui-core-bridge-command:p1:inst-idle-waiting
    // @cpt-end:cpt-noter-flow-ui-core-bridge-act:p1:inst-loading
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-act:p1:inst-api-command
    const res = await run();
    // @cpt-end:cpt-noter-flow-ui-core-bridge-act:p1:inst-api-command
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-act:p1:inst-if-ok
    if (res.status === "ok") {
      // @cpt-begin:cpt-noter-flow-ui-core-bridge-act:p1:inst-write-result
      if (opts.slice) set((s) => applyWhole(s, opts.slice!, res.data as never));
      // @cpt-end:cpt-noter-flow-ui-core-bridge-act:p1:inst-write-result
      // @cpt-begin:cpt-noter-flow-ui-core-bridge-act:p1:inst-render-result
      // @cpt-begin:cpt-noter-state-ui-core-bridge-command:p1:inst-waiting-done
      setCommand(key, { state: "DONE", error: null });
      // @cpt-end:cpt-noter-state-ui-core-bridge-command:p1:inst-waiting-done
      // @cpt-end:cpt-noter-flow-ui-core-bridge-act:p1:inst-render-result
      // @cpt-end:cpt-noter-flow-ui-core-bridge-act:p1:inst-if-ok
    } else {
      // @cpt-begin:cpt-noter-flow-ui-core-bridge-act:p1:inst-else-error
      // @cpt-begin:cpt-noter-flow-ui-core-bridge-act:p1:inst-map-error
      const error = mapError(res.error, cmd, opts.named, opts.screen);
      // @cpt-end:cpt-noter-flow-ui-core-bridge-act:p1:inst-map-error
      // @cpt-begin:cpt-noter-flow-ui-core-bridge-act:p1:inst-show-error
      // @cpt-begin:cpt-noter-state-ui-core-bridge-command:p1:inst-waiting-error
      setCommand(key, { state: "ERROR", error });
      // @cpt-end:cpt-noter-state-ui-core-bridge-command:p1:inst-waiting-error
      // @cpt-end:cpt-noter-flow-ui-core-bridge-act:p1:inst-show-error
      // @cpt-end:cpt-noter-flow-ui-core-bridge-act:p1:inst-else-error
    }
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-act:p1:inst-return-act
    return res;
    // @cpt-end:cpt-noter-flow-ui-core-bridge-act:p1:inst-return-act
  }

  /** The user chose **Try Again** on a control: only a retryable error runs again. */
  async function retry(key: string): Promise<void> {
    const c = store.getState().commands[key];
    // @cpt-begin:cpt-noter-state-ui-core-bridge-command:p1:inst-error-waiting
    if (c?.state === "ERROR" && c.error?.tryAgain) await retries.get(key)?.();
    // @cpt-end:cpt-noter-state-ui-core-bridge-command:p1:inst-error-waiting
  }

  // @cpt-flow:cpt-noter-flow-ui-core-bridge-close-window:p1
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    if (flushTimer) clearTimeout(flushTimer);
    const ids = [...subs.values()].flatMap((s) => (s.id ? [s.id] : []));
    subs.clear();
    buffers.clear();
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-close-window:p1:inst-for-each-sub
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-close-window:p1:inst-api-unsubscribe
    await Promise.all(ids.map((id) => core.streamUnsubscribe({ subscription_id: id }))); // a refusal is ignored
    // @cpt-end:cpt-noter-flow-ui-core-bridge-close-window:p1:inst-api-unsubscribe
    // @cpt-end:cpt-noter-flow-ui-core-bridge-close-window:p1:inst-for-each-sub
    (await listening)?.forEach((off) => off());
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-close-window:p1:inst-drop-store
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-close-window:p1:inst-return-closed
    // @cpt-begin:cpt-noter-state-ui-core-bridge-window-store:p1:inst-ready-closed
    set(initialState(label, "CLOSED"), true);
    // @cpt-end:cpt-noter-state-ui-core-bridge-window-store:p1:inst-ready-closed
    // @cpt-end:cpt-noter-flow-ui-core-bridge-close-window:p1:inst-return-closed
    // @cpt-end:cpt-noter-flow-ui-core-bridge-close-window:p1:inst-drop-store
  }

  return {
    label,
    /** The typed client: shared calls such as `windowNavigate`, `windowAnnounce` and `openExternal` are plain pass-throughs. */
    core,
    store,
    open,
    // @cpt-begin:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-screen-reads
    subscribe,
    // @cpt-end:cpt-noter-flow-ui-core-bridge-open-window:p1:inst-screen-reads
    unsubscribe,
    act,
    retry,
    close,
  };
}

export type Bridge = ReturnType<typeof createBridge>;
