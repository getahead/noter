// Story scenarios: one isolated core per test, the windows a story uses, and the few
// scenario controls a story needs to put the world in its starting state.
//
//   NOTER_CORE=fake (default)  a FakeCore per window, all sharing one fixture world
//   NOTER_CORE=stdio           one noter-core-harness process per scenario (NOTER_CORE_CMD),
//                              every window talking to it over the JSON Lines wire
//
// Tests drive the contract only through the typed client (`createCore`), exactly as the UI
// does. The controls below stand for what the outside world does to the core (a display is
// unplugged, the call app lets go of the microphone, the disk fills up). The fake implements
// them with `setWorld`, `failNext` and `push`; the real core harness implements them as
// harness control requests (docs/TEST-PLAN.md › Scenario controls), which are not contract
// commands and are never recorded as exercised.
//
// Only commands that *succeeded* are recorded, as in tests/support/core.ts.

import {
  createCore,
  type ChannelCommand,
  type CommandName,
  type Core,
  type ErrorCode,
  type ErrorDetail,
  type EventName,
  type EventPayloads,
  type FakeWorld,
  type Transport,
  type WindowLabel,
} from "../../src/core/bindings";
import { FakeCore, type ChannelBody } from "../../src/core/fake/fake-core";
import { target as selectedTarget } from "./core";
import { StdioCore } from "./stdio-transport";

export type World = FakeWorld;
export type Target = "fake" | "stdio";

/**
 * Control requests the real core harness answers besides the contract commands. They are
 * sent on the same wire as commands (`{"id", "window": "main", "cmd": "harness.…", "args"}`)
 * and answered with `ok` or `error` like any request.
 */
export const HARNESS_CONTROLS = {
  /** `{}` → the whole core state as a `FakeWorld` (the fixture-parity read models). */
  worldGet: "harness.world_get",
  /** `{ world }` → replaces the state; emits a whole-state event (with a new version) per changed slice. */
  worldSet: "harness.world_set",
  /** `{ window, cmd, code, detail }` → the next `cmd` from `window` fails with that CoreError. */
  failNext: "harness.fail_next",
  /** `{ cmd, body }` → the scripted engine or runtime emits `body` on the newest open Channel of `cmd`. */
  push: "harness.push",
  /** `{}` → the next bundle fetch serves wrong bytes once: `models_download` start ends in `checksum_failed`, retry reaches `ready`. */
  corruptNextDownload: "harness.corrupt_next_download",
} as const;

/** Everything a listener of one event received, in order. */
export interface EventLog<E extends EventName> {
  readonly all: EventPayloads[E][];
  latest(): EventPayloads[E] | undefined;
}

export interface Scenario {
  readonly target: Target;
  /** Commands that succeeded in this scenario. */
  readonly exercised: ReadonlySet<CommandName>;
  /** The typed client of a window, as the UI builds it. */
  core(window: WindowLabel): Core;
  /** A new client for a window that was closed or crashed (state stays in the core). */
  reopen(window: WindowLabel): Core;
  /** Start recording an event; the log fills as events arrive. */
  events<E extends EventName>(event: E): Promise<EventLog<E>>;
  /** The outside world changes the core's state (display unplugged, disk full, notice shown…). */
  change(mutate: (world: World) => void): Promise<void>;
  /** The next call of `cmd` from `window` fails with this error (an external failure the story names). */
  failNext(window: WindowLabel, cmd: CommandName, code: ErrorCode, detail?: ErrorDetail | null): Promise<void>;
  /** The next `models_download` start ends in `checksum_failed`; the retry after it succeeds. */
  corruptNextDownload(): Promise<void>;
  /** The engine or runtime sends a message on the newest open Channel of `cmd`. */
  push(cmd: ChannelCommand, body: ChannelBody): Promise<number | null>;
  dispose(): Promise<void>;
}

export interface ScenarioOptions {
  /** Defaults to NOTER_CORE (tests/support/core.ts). */
  target?: Target;
  /** Starting state, applied before any window opens. */
  world?: (world: World) => void;
  /** Also record successful commands here (the conformance suite's per-worker log). */
  alsoRecord?: Set<CommandName>;
}

function recordInto(sets: Set<CommandName>[], inner: Transport): Transport {
  return {
    async invoke(cmd, args, onMessage) {
      const result = await inner.invoke(cmd, args, onMessage);
      sets.forEach((s) => s.add(cmd));
      return result;
    },
    listen: (event, handler) => inner.listen(event, handler),
  };
}

abstract class BaseScenario implements Scenario {
  abstract readonly target: Target;
  readonly exercised = new Set<CommandName>();
  protected readonly sinks: Set<CommandName>[];
  private readonly clients = new Map<WindowLabel, Core>();
  private readonly unlisten: Array<() => void> = [];

  constructor(alsoRecord?: Set<CommandName>) {
    this.sinks = alsoRecord ? [this.exercised, alsoRecord] : [this.exercised];
  }

  protected abstract transport(window: WindowLabel, fresh: boolean): Transport;
  abstract change(mutate: (world: World) => void): Promise<void>;
  abstract failNext(window: WindowLabel, cmd: CommandName, code: ErrorCode, detail?: ErrorDetail | null): Promise<void>;
  abstract corruptNextDownload(): Promise<void>;
  abstract push(cmd: ChannelCommand, body: ChannelBody): Promise<number | null>;
  protected abstract close(): Promise<void>;

  core(window: WindowLabel): Core {
    let client = this.clients.get(window);
    if (!client) {
      client = createCore(recordInto(this.sinks, this.transport(window, false)));
      this.clients.set(window, client);
    }
    return client;
  }

  reopen(window: WindowLabel): Core {
    const client = createCore(recordInto(this.sinks, this.transport(window, true)));
    this.clients.set(window, client);
    return client;
  }

  async events<E extends EventName>(event: E): Promise<EventLog<E>> {
    const all: EventPayloads[E][] = [];
    this.unlisten.push(await this.core("main").on(event, (p) => all.push(p)));
    return { all, latest: () => all.at(-1) };
  }

  async dispose(): Promise<void> {
    this.unlisten.splice(0).forEach((u) => u());
    await this.close();
  }
}

class FakeScenario extends BaseScenario {
  readonly target = "fake" as const;
  private readonly root: FakeCore;
  private readonly fakes = new Map<WindowLabel, FakeCore>();
  private readonly all: FakeCore[] = [];

  constructor(opts: ScenarioOptions) {
    super(opts.alsoRecord);
    this.root = new FakeCore({ window: "main" });
    opts.world?.(this.root.world);
    this.fakes.set("main", this.root);
    this.all.push(this.root);
  }

  private fake(window: WindowLabel, fresh: boolean): FakeCore {
    let fake = fresh ? undefined : this.fakes.get(window);
    if (!fake) {
      fake = new FakeCore({ window, world: this.root.world });
      this.fakes.set(window, fake);
      this.all.push(fake);
    }
    return fake;
  }

  protected transport(window: WindowLabel, fresh: boolean): Transport {
    return this.fake(window, fresh);
  }

  async change(mutate: (world: World) => void): Promise<void> {
    this.root.setWorld(mutate);
  }

  async failNext(window: WindowLabel, cmd: CommandName, code: ErrorCode, detail: ErrorDetail | null = null): Promise<void> {
    this.fake(window, false).failNext(cmd, code, detail);
  }

  async corruptNextDownload(): Promise<void> {
    const fake = this.root as FakeCore & { corruptNextDownload?: () => void };
    if (!fake.corruptNextDownload) throw new Error("the fake core has no corruptNextDownload yet (backend ask in _team/ui/e2e/M0-coverage.md)");
    fake.corruptNextDownload();
  }

  async push(cmd: ChannelCommand, body: ChannelBody): Promise<number | null> {
    for (const fake of [...this.all].reverse()) {
      const seq = fake.push(cmd, body);
      if (seq !== null) return seq;
    }
    return null;
  }

  protected async close(): Promise<void> {
    this.all.forEach((f) => f.dispose());
  }
}

class StdioScenario extends BaseScenario {
  readonly target = "stdio" as const;
  private readonly process: StdioCore;
  private readonly ready: Promise<void>;

  constructor(opts: ScenarioOptions) {
    super(opts.alsoRecord);
    const command = process.env.NOTER_CORE_CMD;
    if (!command) throw new Error("NOTER_CORE=stdio needs NOTER_CORE_CMD (path to noter-core-harness and its flags)");
    this.process = new StdioCore({ command });
    this.ready = opts.world ? this.change(opts.world) : Promise.resolve();
  }

  private control(name: string, args: unknown): Promise<unknown> {
    return this.process.invoke("main", name as CommandName, args);
  }

  protected transport(window: WindowLabel): Transport {
    const inner = this.process.transport(window);
    return {
      invoke: async (cmd, args, onMessage) => {
        await this.ready;
        return inner.invoke(cmd, args, onMessage);
      },
      listen: (event, handler) => inner.listen(event, handler),
    };
  }

  async change(mutate: (world: World) => void): Promise<void> {
    await this.ready; // undefined while the constructor applies the starting state
    const world = (await this.control(HARNESS_CONTROLS.worldGet, {})) as World;
    mutate(world);
    await this.control(HARNESS_CONTROLS.worldSet, { world });
  }

  async failNext(window: WindowLabel, cmd: CommandName, code: ErrorCode, detail: ErrorDetail | null = null): Promise<void> {
    await this.ready;
    await this.control(HARNESS_CONTROLS.failNext, { window, cmd, code, detail });
  }

  async corruptNextDownload(): Promise<void> {
    await this.ready;
    await this.control(HARNESS_CONTROLS.corruptNextDownload, {});
  }

  async push(cmd: ChannelCommand, body: ChannelBody): Promise<number | null> {
    await this.ready;
    return ((await this.control(HARNESS_CONTROLS.push, { cmd, body })) as { seq: number | null } | null)?.seq ?? null;
  }

  protected async close(): Promise<void> {
    await this.process.close();
  }
}

/** A fresh, isolated core for one test, with the selected target. */
export function openScenario(opts: ScenarioOptions = {}): Scenario {
  const target = opts.target ?? selectedTarget;
  return target === "stdio" ? new StdioScenario(opts) : new FakeScenario(opts);
}

export { ok, refused, until } from "./results";
