// Fake core: an in-memory implementation of the contract, so the UI can be
// built and tested before the Rust core exists (UI-first, DESIGN-core 4.1).
//
// It is a `Transport`, so the UI code is identical against the fake and the real core:
//   const core = createCore(new FakeCore({ window: "main" }));
//
// What it guarantees, because the contract tests depend on it:
// * window scoping: a command the window may not call rejects with `window_not_allowed`;
// * snapshot, then stream: Channel messages carry `seq` = last_seq + 1, + 2, …; like the real
//   core, the first message of a live transcript can arrive before the snapshot resolves
//   (the generated client buffers it, R23);
// * every rejection is a `CoreError` with a code from `ERROR_CODES`, `retryable` as the core sets it;
// * whole-state events carry a `version` that only grows;
// * every command has a handler; `not_implemented` is only what a story asks for with `failNext`.
//
// Scenario controls for stories and tests: `failNext`, `latency`, `emit`, `publish`, `push`,
// `setWorld`, `world`.

import {
  COMMANDS,
  DEFAULT_RETRYABLE,
  isCoreError,
  type CallWindowState,
  type ChannelCommand,
  type ChannelMessages,
  type CommandArgs,
  type CommandName,
  type CommandResults,
  type CoreError,
  type ErrorCode,
  type ErrorDetail,
  type EventName,
  type EventPayloads,
  type FakeWorld,
  type PlaybackState,
  type Transport,
  type WindowLabel,
} from "../bindings";
import { defaultHandlers } from "./handlers";
import worldJson from "../../../../../contracts/fixtures/world.json";

export type World = FakeWorld;

/** Events whose payload is a whole state with a `version`. */
export type StateEvent =
  | "capture:state"
  | "capture:detected"
  | "copilot:status"
  | "degraded:changed"
  | "banners:changed"
  | "proposals:counts"
  | "setup:changed"
  | "env:changed"
  | "settings:changed"
  | "privacy:changed"
  | "accounts:changed"
  | "hotkeys:changed"
  | "playback:state"
  | "window:call"
  | "app:presenting";

export interface HandlerCtx<K extends CommandName> {
  window: WindowLabel;
  world: World;
  fake: FakeCore;
  /** Send on this command's Channel (subscribing commands only). Prefer `fake.openChannel`. */
  send: K extends ChannelCommand ? (message: ChannelMessages[K]) => void : undefined;
  emit: <E extends EventName>(event: E, payload: EventPayloads[E]) => void;
  /** Stamp the next `version` on a whole-state slice of the world and emit it. */
  publish: (event: StateEvent) => void;
}

export type Handler<K extends CommandName> = (
  args: CommandArgs[K],
  ctx: HandlerCtx<K>,
) => CommandResults[K] | Promise<CommandResults[K]>;

export type Handlers = { [K in CommandName]?: Handler<K> };

/** A `CoreError` as the core builds it: `retryable` defaults to the generated `DEFAULT_RETRYABLE`. */
export function coreError(
  code: ErrorCode,
  message: string = code,
  detail: ErrorDetail | null = null,
  retryable: boolean = DEFAULT_RETRYABLE.includes(code),
): CoreError {
  return { code, message, retryable, detail };
}

export interface FakeCoreOptions {
  window: WindowLabel;
  /** Start from a modified copy of the fixture world. */
  world?: World;
  handlers?: Handlers;
  /** Artificial latency per command, in ms (default 0). */
  latency?: number;
}

type Listener = (payload: unknown) => void;

/** One shared bus so several FakeCore windows in one test see each other's events. */
const bus = new Map<EventName, Set<Listener>>();

interface OpenChannel {
  cmd: ChannelCommand;
  send: (message: unknown) => void;
  seq: number;
}

type Versioned = { version: number };

/** A message of any Channel, without its `seq` (the fake stamps it). */
export type ChannelBody = { [K in ChannelCommand]: Omit<ChannelMessages[K], "seq"> }[ChannelCommand] & { seq?: number };

// @cpt-interface:cpt-noter-interface-ui-core-ipc:p1
export class FakeCore implements Transport {
  readonly window: WindowLabel;
  world: World;
  latency: number;
  /** Replay state (`playback:state`); the core keeps it, not the world. */
  playback: PlaybackState;
  /** The call window (`window:call`). */
  callWindow: CallWindowState;
  /** The call the main window reported with `window_report_view`. */
  viewedCall: string | null = null;
  /** Highest `seq` acknowledged per subscription (`stream_ack`). */
  readonly acks = new Map<string, number>();
  private handlers: Handlers;
  private failures = new Map<CommandName, CoreError[]>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private channels = new Map<string, OpenChannel>();

  constructor(opts: FakeCoreOptions) {
    this.window = opts.window;
    this.world = opts.world ?? structuredClone(worldJson as unknown as World);
    this.latency = opts.latency ?? 0;
    this.handlers = { ...defaultHandlers, ...opts.handlers };
    const cap = this.world.app.capture;
    this.playback = { version: 1, playing: false, call_id: null, position_ms: 0, to_ms: null, route: cap.output_route, stopped_reason: null };
    this.callWindow = { version: 1, visible: cap.phase === "recording", key: false, layout: "dedicated", collapsed: false, display_id: this.world.settings.call_screen.display_id ?? null, chosen_display_missing: false, show_share_warning: false };
  }

  /** The next call of `cmd` rejects with this error (stories: "Key rejected", "Search failed", …). */
  failNext(cmd: CommandName, code: ErrorCode, detail: ErrorDetail | null = null): this {
    const list = this.failures.get(cmd) ?? [];
    list.push(coreError(code, `fake: forced ${code}`, detail));
    this.failures.set(cmd, list);
    return this;
  }

  /** Emit an event to every listener (all fake windows). */
  emit<E extends EventName>(event: E, payload: EventPayloads[E]): void {
    bus.get(event)?.forEach((h) => h(structuredClone(payload)));
  }

  /** The world slice (or core state) a whole-state event carries. */
  slice(event: StateEvent): Versioned {
    const w = this.world;
    switch (event) {
      case "capture:state":
        return w.app.capture;
      case "capture:detected":
        return w.app.detection;
      case "copilot:status":
        return w.copilot;
      case "degraded:changed":
        return w.app.degraded;
      case "banners:changed":
        return w.app.banners;
      case "proposals:counts":
        return w.app.proposals;
      case "setup:changed":
        return w.app.setup;
      case "env:changed":
        return w.app.environment;
      case "settings:changed":
        return w.settings;
      case "privacy:changed":
        return w.app.privacy;
      case "accounts:changed":
        return w.app.accounts;
      case "hotkeys:changed":
        return w.hotkeys;
      case "playback:state":
        return this.playback;
      case "window:call":
        return this.callWindow;
      case "app:presenting":
        return w.app.presenting;
    }
  }

  /** Stamp the next version on a whole-state slice and emit it (R25: versions only grow). */
  publish(event: StateEvent): void {
    const s = this.slice(event);
    s.version += 1;
    if (event === "copilot:status") this.world.app.copilot = this.world.copilot;
    this.emit(event, s as never);
  }

  /**
   * Change the world the way the core would, and emit an event (with a new version) for every
   * whole-state slice that changed. Pass a mutator or a whole new world.
   */
  setWorld(change: World | ((world: World) => void)): this {
    const events: StateEvent[] = [
      "capture:state", "capture:detected", "copilot:status", "degraded:changed", "banners:changed", "proposals:counts",
      "setup:changed", "env:changed", "settings:changed", "privacy:changed", "accounts:changed", "hotkeys:changed",
      "playback:state", "window:call", "app:presenting",
    ];
    const strip = (v: Versioned) => JSON.stringify({ ...v, version: 0 });
    const before = new Map(events.map((e) => [e, strip(this.slice(e))]));
    const versions = new Map(events.map((e) => [e, this.slice(e).version]));
    if (typeof change === "function") change(this.world);
    else this.world = structuredClone(change);
    for (const e of events) {
      const s = this.slice(e);
      if (s.version < versions.get(e)!) s.version = versions.get(e)!;
      if (strip(s) !== before.get(e)) this.publish(e);
    }
    return this;
  }

  /** Register a Channel opened by a subscribing command; messages start after `fromSeq`. */
  openChannel(subscription: string, cmd: ChannelCommand, send: (message: unknown) => void, fromSeq = 0): void {
    this.channels.set(subscription, { cmd, send, seq: fromSeq });
  }

  /** End a Channel (`stream_unsubscribe`); later pushes to it are ignored. */
  closeChannel(subscription: string): boolean {
    return this.channels.delete(subscription);
  }

  /** The newest open subscription of a command, if any. */
  latestSubscription(cmd: ChannelCommand): string | null {
    let last: string | null = null;
    this.channels.forEach((c, id) => {
      if (c.cmd === cmd) last = id;
    });
    return last;
  }

  /**
   * Push a message on an existing Channel. `target` is a subscription id, or a subscribing
   * command name for its newest subscription. The fake stamps the next `seq`; pass `seq` in
   * the body to send a specific one (to test gaps and duplicates). Returns the seq, or null
   * when there is no such open Channel.
   */
  push<K extends ChannelCommand>(target: K, body: Omit<ChannelMessages[K], "seq"> & { seq?: number }): number | null;
  push(target: string, body: ChannelBody): number | null;
  push(target: string, body: ChannelBody): number | null {
    const id = this.channels.has(target) ? target : this.latestSubscription(target as ChannelCommand);
    const ch = id ? this.channels.get(id) : undefined;
    if (!ch) return null;
    const seq = body.seq ?? ch.seq + 1;
    ch.seq = Math.max(ch.seq, seq);
    ch.send(structuredClone({ ...body, seq }));
    return seq;
  }

  /** Schedule work that `dispose()` cancels. */
  later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  dispose(): void {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.channels.clear();
  }

  async invoke(cmd: CommandName, args: unknown, onMessage?: (message: unknown) => void): Promise<unknown> {
    const spec = COMMANDS[cmd];
    if (!spec) throw coreError("not_found", `unknown command ${String(cmd)}`);
    if (!(spec.windows as readonly WindowLabel[]).includes(this.window)) {
      throw coreError("window_not_allowed", `${cmd} is not allowed from ${this.window}`);
    }
    if (spec.channel && !onMessage) throw coreError("invalid_input", `${cmd} needs a channel`);
    if (this.latency) await new Promise((r) => setTimeout(r, this.latency));
    const forced = this.failures.get(cmd)?.shift();
    if (forced) throw forced;
    const handler = this.handlers[cmd] as Handler<CommandName> | undefined;
    if (!handler) throw coreError("not_implemented", `fake core has no handler for ${cmd}`);
    const ctx = {
      window: this.window,
      world: this.world,
      fake: this,
      send: onMessage,
      emit: (e: EventName, p: unknown) => this.emit(e, p as never),
      publish: (e: StateEvent) => this.publish(e),
    } as unknown as HandlerCtx<CommandName>;
    let result: unknown;
    try {
      result = await handler(args as never, ctx);
    } catch (e) {
      // The real core reads args as JSON and refuses malformed input with `invalid_input`;
      // a handler crashing on missing fields is the fake's equivalent.
      if (isCoreError(e)) throw e;
      throw coreError("invalid_input", `fake: ${cmd} could not read its args: ${String(e)}`);
    }
    // Return a copy: the UI must never hold references into the core's state.
    return structuredClone(result);
  }

  async listen(event: EventName, handler: (payload: unknown) => void): Promise<() => void> {
    const set = bus.get(event) ?? new Set<Listener>();
    set.add(handler);
    bus.set(event, set);
    return () => set.delete(handler);
  }
}
