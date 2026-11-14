// Park one command in the page until the test lets go: a loading or working state stays on screen
// without a blanket fake-core latency that would also delay every other command.
import type { Page } from "@playwright/test";

import { coreReady } from "../e2e/support/app";

type Held = { invoke: (cmd: string, ...rest: unknown[]) => Promise<unknown> };
type Hooks = { __held?: { go: () => void } };

/** From now on every call of `cmd` waits; resolves once `__noterFake` exists. Returns `release`. */
export async function hold(page: Page, cmd: string): Promise<() => Promise<void>> {
  await coreReady(page);
  await page.evaluate((name) => {
    const fake = (globalThis as unknown as { __noterFake: Held }).__noterFake;
    const state = { go: () => {} };
    const gate = new Promise<void>((r) => (state.go = r));
    (globalThis as unknown as Hooks).__held = state;
    const invoke = fake.invoke.bind(fake);
    fake.invoke = async (c, ...rest) => {
      if (c === name) {
        await gate;
      }
      return invoke(c, ...rest);
    };
  }, cmd);
  return () => page.evaluate(() => (globalThis as unknown as Hooks).__held?.go());
}
