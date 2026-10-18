// Drive the real UI in the browser (Vite with VITE_FAKE_CORE=1) and steer the fake core that
// main.tsx builds inside the page. The page's fake is out of reach of the `scenario` fixture, so
// the test appends a small hook to the fake-core module as Vite serves it: before the window's
// first command it applies the test's plan (forced failures, latency, contract version), and it
// records every command and event subscription the window makes, in order.
//
// shortcut: page flows run against the fake core only, because outside Tauri the page has no
// transport to the real core; upgrade when the harness offers the page one.
import type { Page } from "@playwright/test";

import type { CommandName, ErrorCode, WindowLabel } from "../../../src/core/bindings";

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

/** Open `index.html?window=<label>` with the fake core steered by `plan`. */
export async function openWindow(page: Page, label: WindowLabel | string, plan: CorePlan = {}): Promise<void> {
  await page.addInitScript((p) => Object.assign(globalThis, { __noterPlan: p }), plan);
  await page.route(/\/src\/core\/fake\/fake-core\.ts(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + HOOK });
  });
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
