// Shared steps of the M2 call-page specs: open the past call's page the way the core does (`window_navigate`), read what
// the window sent, and the stable regions of the page (DESIGN.md Call page PC-R1..R3; prototype data-region IDs).
import type { Locator, Page } from "@playwright/test";

import * as W from "../../support/world-presets";
import { calls } from "./app";
import { expect } from "./fixtures";

export const PAGE_TITLE = "Backend sync";
export const banner = (page: Page) => page.locator('[data-region="PC-R2"]');
export const body = (page: Page) => page.locator('[data-region="PC-R3"]');
/** A section by its heading name (a labelled region: "Summary", "Decisions", "Action items"…). */
export const section = (page: Page, name: string | RegExp): Locator => body(page).getByRole("region", { name });

export async function sent(page: Page, name: string): Promise<Array<Record<string, unknown>>> {
  return (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => (c.args ?? {}) as Record<string, unknown>);
}

/** The core's navigation to a call page tab, as a notification click or a Calls row does it. */
export async function navigate(page: Page, tab: "summary" | "transcript" | "history" = "summary", callId: string = W.PAST_CALL) {
  await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
  await page.evaluate(
    async ([id, t]) => {
      const args = { target: { type: "call_page", call_id: id, tab: t } };
      const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
      await (g.__noterFake ? g.__noterFake.invoke("window_navigate", args) : g.__TAURI_INTERNALS__!.invoke("window_navigate", { args }));
    },
    [callId, tab] as const,
  );
}

/** The call's page open on Summary (the fixture's past call unless `call` names the one the real core recorded). */
export async function openSummary(page: Page, call: string = W.PAST_CALL) {
  await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
  await navigate(page, "summary", call);
  await expect(page.getByRole("tab", { name: "Summary", selected: true })).toBeVisible();
}
