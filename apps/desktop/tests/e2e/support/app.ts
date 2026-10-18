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
import type { Page } from "@playwright/test";

import { COMMANDS, type CommandName, type ErrorCode, type WindowLabel } from "../../../src/core/bindings";
import { StdioCore } from "../../support/stdio-transport";

export interface CorePlan {
  /** The window's next calls of `cmd` fail with `code`, in order (FakeCore.failNext). */
  fail?: Array<{ cmd: CommandName; code: ErrorCode }>;
  /** The snapshot reports this contract version instead of the fixture's. */
  contractVersion?: string;
  /** Artificial latency per command, in ms. */
  latency?: number;
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
    const plan = globalThis.__noterPlan;
    if (plan && !this.__noterPlanned) {
      this.__noterPlanned = true;
      (plan.fail ?? []).forEach((f) => this.failNext(f.cmd, f.code));
      if (plan.contractVersion) this.world.app.contract_version = plan.contractVersion;
      if (plan.latency) this.latency = plan.latency;
    }
    calls.push({ kind: "invoke", name: cmd, args: structuredClone(args) });
    return invoke.call(this, cmd, args, onMessage);
  };
  FakeCore.prototype.listen = function (event, handler) {
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
async function connectRealCore(page: Page, label: string, plan: CorePlan): Promise<void> {
  const command = process.env.NOTER_CORE_CMD;
  if (!command) throw new Error("NOTER_CORE=stdio needs NOTER_CORE_CMD (path to noter-core-harness and its flags)");
  const core = new StdioCore({ command });
  page.once("close", () => void core.close());
  const win = (WINDOWS.includes(label) ? label : "main") as WindowLabel; // as main.tsx reads it
  for (const f of plan.fail ?? []) {
    await core.invoke("main", "harness.fail_next" as CommandName, { window: win, cmd: f.cmd, code: f.code, detail: null });
  }
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
}

/** Open `index.html?window=<label>` with the selected core (NOTER_CORE) steered by `plan`. */
export async function openWindow(page: Page, label: WindowLabel | string, plan: CorePlan = {}): Promise<void> {
  if (process.env.NOTER_CORE === "stdio") {
    await connectRealCore(page, label, plan);
  } else {
    await page.addInitScript((p) => Object.assign(globalThis, { __noterPlan: p }), plan);
    await page.route(/\/src\/core\/fake\/fake-core\.ts(\?.*)?$/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()) + HOOK });
    });
  }
  await page.goto(`/?window=${label}`);
}

/** Every command and event subscription the window made, in order. */
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
