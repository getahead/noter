// Fake core: an in-memory implementation of the contract, so the UI can be
// built and tested before the Rust core exists (UI-first, DESIGN-core 4.1).
//
// It is a `Transport`, so the UI code is identical against the fake and the real core:
//   const core = createCore(new FakeCore({ window: "main" }));
//
// What it guarantees, because the contract tests depend on it:
// * window scoping: a command the window may not call rejects with `window_not_allowed`;
// * snapshot, then stream: Channel messages carry `seq` = last_seq + 1, + 2, …;
// * every rejection is a `CoreError` with a code from `ERROR_CODES`;
// * a command without a fake handler rejects with `not_implemented` (never silently succeeds).
//
// Scenario controls for stories and tests: `failNext`, `latency`, `emit`, `world`.

import {
  COMMANDS,
  isCoreError,
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
  type Transport,
  type WindowLabel,
} from "../bindings";
import { defaultHandlers } from "./handlers";
import worldJson from "../../../../../contracts/fixtures/world.json";

export type World = FakeWorld;

export interface HandlerCtx<K extends CommandName> {
  window: WindowLabel;
  world: World;
  fake: FakeCore;
  /** Send on this command's Channel (subscribing commands only). */
  send: K extends ChannelCommand ? (message: ChannelMessages[K]) => void : undefined;
  emit: <E extends EventName>(event: E, payload: EventPayloads[E]) => void;
}

export type Handler<K extends CommandName> = (
  args: CommandArgs[K],
  ctx: HandlerCtx<K>,
) => CommandResults[K] | Promise<CommandResults[K]>;

export type Handlers = { [K in CommandName]?: Handler<K> };

export function coreError(code: ErrorCode, message: string = code, detail: ErrorDetail | null = null, retryable = false): CoreError {
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

export class FakeCore implements Transport {
  readonly window: WindowLabel;
  world: World;
  latency: number;
  private handlers: Handlers;
  private failures = new Map<CommandName, CoreError[]>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private seqs = new Map<string, number>();

  constructor(opts: FakeCoreOptions) {
    this.window = opts.window;
    this.world = opts.world ?? structuredClone(worldJson as unknown as World);
    this.latency = opts.latency ?? 0;
    this.handlers = { ...defaultHandlers, ...opts.handlers };
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

  /** Schedule work that `dispose()` cancels. */
  later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  /** Next `seq` of a subscription, starting after `from`. */
  nextSeq(subscription: string, from = 0): number {
    const n = (this.seqs.get(subscription) ?? from) + 1;
    this.seqs.set(subscription, n);
    return n;
  }

  dispose(): void {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
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
    } as unknown as HandlerCtx<CommandName>;
    let result: unknown;
    try {
      result = await handler(args as never, ctx);
    } catch (e) {
      // The real core deserializes args with serde and refuses malformed input with
      // `invalid_input`; a handler crashing on missing fields is the fake's equivalent.
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
