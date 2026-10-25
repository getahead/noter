// Drive the real UI in the browser and steer the core behind it. Both targets record every
// command and event subscription the window makes, in order, and apply the test's plan (forced
// failures, latency, contract version) before the window's first command.
//
//   NOTER_CORE=fake   Vite serves the app with VITE_FAKE_CORE=1 and main.tsx builds a FakeCore;
//                     the test appends a small hook to the fake-core module as Vite serves it.
//   NOTER_CORE=stdio  Vite serves the app without the fake, so main.tsx builds the bridge over
//                     the real tauri-transport. The page gets a stand-in for Tauri's IPC internals
//                     that forwards every call to a noter-core-harness process (NOTER_CORE_CMD)
//                     this test starts, as the Tauri host would (docs/HARNESS.md).
import { expect, type Locator, type Page } from "@playwright/test";

import { COMMANDS, type ChannelCommand, type CommandName, type ErrorCode, type ErrorDetail, type WindowLabel } from "../../../src/core/bindings";
import type { ChannelBody } from "../../../src/core/fake/fake-core";
import type { World } from "../../support/scenario";
import { StdioCore } from "../../support/stdio-transport";

export interface CorePlan {
  /** The window's next calls of `cmd` fail with `code`, in order (FakeCore.failNext). */
  fail?: Array<{ cmd: CommandName; code: ErrorCode }>;
  /** The snapshot reports this contract version instead of the fixture's. */
  contractVersion?: string;
  /** Artificial latency per command, in ms. */
  latency?: number;
  /** The story's starting state (tests/support/world-presets.ts), applied before the window's first command. */
  world?: (world: World) => void;
  /** The window's first bundle download ends in `checksum_failed` once (harness.corrupt_next_download), set before the page loads. */
  corruptNextDownload?: boolean;
  /** The window's first bundle download stops serving at this percent until `steer.releaseDownload()` (real core only: harness.hold_next_download; the fake's downloads finish at once). */
  holdDownloadAt?: number;
}

/** What the outside world does to the core behind an open window, as the scenario controls do. */
export interface Steer {
  change(mutate: (world: World) => void): Promise<void>;
  failNext(cmd: CommandName, code: ErrorCode, detail?: ErrorDetail | null): Promise<void>;
  push(cmd: ChannelCommand, body: ChannelBody): Promise<void>;
  /** A download held by `holdDownloadAt` serves the rest (a no-op on the fake). */
  releaseDownload(): Promise<void>;
}

export interface Call {
  kind: "invoke" | "listen";
  name: string;
  args?: unknown;
}

const HOOK = `
;{
  const invoke = FakeCore.prototype.invoke;
  const listen = FakeCore.prototype.listen;
  const calls = (globalThis.__noterCalls ??= []);
  FakeCore.prototype.invoke = function (cmd, args, onMessage) {
    globalThis.__noterFake = this;
    const plan = globalThis.__noterPlan;
    if (plan && !this.__noterPlanned) {
      this.__noterPlanned = (async () => {
        if (globalThis.__noterSeed) this.world = await globalThis.__noterSeed(this.world);
        (plan.fail ?? []).forEach((f) => this.failNext(f.cmd, f.code));
        if (plan.contractVersion) this.world.app.contract_version = plan.contractVersion;
        if (plan.latency) this.latency = plan.latency;
        if (plan.corruptNextDownload) {
          if (!this.corruptNextDownload) throw new Error("the fake core has no corruptNextDownload yet (backend ask in _team/ui/e2e/M0-coverage.md)");
          this.corruptNextDownload();
        }
      })();
    }
    calls.push({ kind: "invoke", name: cmd, args: structuredClone(args) });
    return Promise.resolve(this.__noterPlanned).then(() => invoke.call(this, cmd, args, onMessage));
  };
  FakeCore.prototype.listen = function (event, handler) {
    globalThis.__noterFake = this;
    calls.push({ kind: "listen", name: event });
    return listen.call(this, event, handler);
  };
}
`;

type Callback = (x: unknown) => void;
type Answer = { ok: unknown } | { error: unknown };
interface PageIpc {
  __noterCalls?: Call[];
  __noterDeliver?: (doc: string, id: number, x: unknown) => void;
  __noterInvoke: (doc: string, cmd: string, args: unknown, channel: number | null) => Promise<Answer>;
  __noterListen: (doc: string, event: string, handler: number) => Promise<void>;
  __noterUnlisten: (doc: string, handler: number) => Promise<void>;
}

/**
 * Page side of the stdio target: the part of `window.__TAURI_INTERNALS__` that @tauri-apps/api
 * uses for `invoke`, `Channel` and `listen`. Callback ids restart with every document, so each
 * document tags its calls and ignores deliveries meant for the one before a reload.
 */
function tauriIpcStandIn(): void {
  const w = window as unknown as PageIpc & Record<string, unknown>;
  const doc = crypto.randomUUID();
  const callbacks = new Map<number, Callback>();
  const calls = (w.__noterCalls ??= []);
  let next = 1;
  w.__noterDeliver = (d, id, x) => void (d === doc && callbacks.get(id)?.(x));
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  w.__TAURI_INTERNALS__ = {
    transformCallback(cb: Callback, once = false) {
      const id = next++;
      callbacks.set(id, (x) => (once && callbacks.delete(id), cb(x)));
      return id;
    },
    unregisterCallback: (id: number) => callbacks.delete(id),
    async invoke(cmd: string, payload: { args?: unknown; channel?: { id: number }; event?: string; handler?: number; eventId?: number }) {
      if (cmd === "plugin:event|listen") {
        calls.push({ kind: "listen", name: payload.event! });
        await w.__noterListen(doc, payload.event!, payload.handler!);
        return payload.handler;
      }
      if (cmd === "plugin:event|unlisten") return w.__noterUnlisten(doc, payload.eventId!);
      calls.push({ kind: "invoke", name: cmd, args: structuredClone(payload.args) });
      const answer = await w.__noterInvoke(doc, cmd, payload.args, payload.channel?.id ?? null);
      if ("error" in answer) throw answer.error;
      return answer.ok;
    },
  };
}

const WINDOWS = COMMANDS.app_snapshot.windows as readonly string[];

/** Node side of the stdio target: one core process per page, closed with the page. */
async function connectRealCore(page: Page, label: string, plan: CorePlan): Promise<Steer> {
  const command = process.env.NOTER_CORE_CMD;
  if (!command) throw new Error("NOTER_CORE=stdio needs NOTER_CORE_CMD (path to noter-core-harness and its flags)");
  const core = new StdioCore({ command });
  page.once("close", () => void core.close());
  const win = (WINDOWS.includes(label) ? label : "main") as WindowLabel; // as main.tsx reads it
  // Harness control requests (tests/support/scenario.ts › HARNESS_CONTROLS), not contract commands.
  const control = (name: string, args: unknown) => core.invoke("main", name as CommandName, args);
  const steer: Steer = {
    async change(mutate) {
      const world = (await control("harness.world_get", {})) as World;
      mutate(world);
      await control("harness.world_set", { world });
    },
    failNext: async (cmd, code, detail = null) => void (await control("harness.fail_next", { window: win, cmd, code, detail })),
    push: async (cmd, body) => void (await control("harness.push", { cmd, body })),
    releaseDownload: async () => void (await control("harness.release_download", {})),
  };
  if (plan.world) await steer.change(plan.world);
  if (plan.corruptNextDownload) await control("harness.corrupt_next_download", {});
  if (plan.holdDownloadAt !== undefined) await control("harness.hold_next_download", { at_percent: plan.holdDownloadAt });
  for (const f of plan.fail ?? []) await steer.failNext(f.cmd, f.code);
  // A delivery may race a reload or the page closing; the new document ignores it anyway.
  const deliver = (doc: string, id: number, x: unknown) =>
    page.evaluate(([d, i, v]) => (globalThis as unknown as PageIpc).__noterDeliver?.(d, i, v), [doc, id, x] as const).catch(() => {});
  const listeners = new Map<string, () => void>();
  await page.exposeFunction("__noterListen", (doc: string, event: string, handler: number) => {
    listeners.set(`${doc}/${handler}`, core.listen(event as never, (payload) => deliver(doc, handler, { event, id: handler, payload })));
  });
  await page.exposeFunction("__noterUnlisten", (doc: string, handler: number) => {
    listeners.get(`${doc}/${handler}`)?.();
    listeners.delete(`${doc}/${handler}`);
  });
  await page.exposeFunction("__noterInvoke", async (doc: string, cmd: CommandName, args: unknown, channel: number | null): Promise<Answer> => {
    if (plan.latency) await new Promise((r) => setTimeout(r, plan.latency));
    let index = 0;
    const onMessage = channel === null ? undefined : (message: unknown) => void deliver(doc, channel, { index: index++, message });
    try {
      const ok = await core.invoke(win, cmd, args, onMessage);
      // The test plays a core of another contract version.
      return { ok: cmd === "app_snapshot" && plan.contractVersion ? { ...(ok as object), contract_version: plan.contractVersion } : ok };
    } catch (error) {
      return { error };
    }
  });
  await page.addInitScript(tauriIpcStandIn);
  return steer;
}

interface PageFake {
  __noterFake: { world: World; setWorld(w: World): void; failNext(c: string, k: string, d: unknown): void; push(c: string, b: unknown): void };
}

/** The fake target's controls: the FakeCore the page built, reached through the hook. */
function fakeSteer(page: Page): Steer {
  return {
    async change(mutate) {
      const world = await page.evaluate(() => (globalThis as unknown as PageFake).__noterFake.world);
      mutate(world);
      await page.evaluate((w) => (globalThis as unknown as PageFake).__noterFake.setWorld(w), world);
    },
    failNext: (cmd, code, detail = null) =>
      page.evaluate(([c, k, d]) => void (globalThis as unknown as PageFake).__noterFake.failNext(c, k, d), [cmd, code, detail] as const),
    push: (cmd, body) => page.evaluate(([c, b]) => void (globalThis as unknown as PageFake).__noterFake.push(c, b), [cmd, body] as const),
    releaseDownload: async () => {},
  };
}

/**
 * Open `index.html?window=<label>` with the selected core (NOTER_CORE) steered by `plan`, and
 * return the controls a story uses while the window is open.
 */
export async function openWindow(page: Page, label: WindowLabel | string, plan: CorePlan = {}): Promise<Steer> {
  let steer: Steer;
  if (process.env.NOTER_CORE === "stdio") {
    steer = await connectRealCore(page, label, plan);
  } else {
    const { world, ...wire } = plan;
    if (world) await page.exposeFunction("__noterSeed", (w: World) => (world(w), w));
    await page.addInitScript((p) => Object.assign(globalThis, { __noterPlan: p }), wire);
    await page.route(/\/src\/core\/fake\/fake-core\.ts(\?.*)?$/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()) + HOOK });
    });
    steer = fakeSteer(page);
  }
  await page.goto(`/?window=${label}`);
  return steer;
}

/** Every command and event subscription the window made, in order. */
/** Wheel the transcript `log` up until `row` is in view: Linux Chromium animates a wheel scroll and the log's row-height
 *  correction cuts it short (CI), so one wheel may not get there. */
export async function wheelUpTo(log: Locator, row: Locator) {
  await log.hover();
  await expect(async () => {
    await log.page().mouse.wheel(0, -20_000);
    await expect(row).toBeInViewport({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

export function calls(page: Page): Promise<Call[]> {
  return page.evaluate(() => (globalThis as unknown as { __noterCalls?: Call[] }).__noterCalls ?? []);
}

/** Console errors and uncaught exceptions of the page, collected from now on. */
export function pageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}
