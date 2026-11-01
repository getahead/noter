// The native alert (Tauri dialog plugin) as a browser test sees it: macOS draws it, so the page only
// sends `plugin:dialog|*` through Tauri's IPC. This init script wraps whatever `__TAURI_INTERNALS__`
// the target installs (the stdio target's stand-in, support/app.ts) or supplies a bare one (fake
// target), records each alert request and answers it as the test chooses. Register it BEFORE openWindow.
import type { Page } from "@playwright/test";

export interface AlertRequest {
  cmd: string;
  payload: Record<string, unknown>;
}

function install(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.__noterAlerts = [];
  g.__noterAlertAnswer = "cancel";
  let internals: Record<string, unknown> | undefined;
  const wrap = (base: Record<string, unknown>) => ({
    ...base,
    invoke(cmd: string, payload: Record<string, unknown> = {}, options?: unknown) {
      if (!cmd.startsWith("plugin:dialog|")) return (base.invoke as (...a: unknown[]) => unknown)?.(cmd, payload, options);
      (g.__noterAlerts as unknown[]).push({ cmd, payload });
      const confirm = g.__noterAlertAnswer === "confirm";
      // ask/confirm answer a boolean; message answers the chosen button's label. With two custom buttons the
      // first is the default (Cancel), so "cancel" chooses it and "confirm" the other one.
      const custom = (payload.buttons as { OkCancelCustom?: [string, string] } | undefined)?.OkCancelCustom;
      if (cmd.endsWith("|message") && custom) return Promise.resolve(confirm ? custom[1] : custom[0]);
      return Promise.resolve(cmd.endsWith("|message") ? (confirm ? (payload.okLabel ?? "Ok") : (payload.cancelLabel ?? "Cancel")) : confirm);
    },
  });
  internals = wrap({ transformCallback: () => 0, unregisterCallback: () => {} });
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    get: () => internals,
    set: (v: Record<string, unknown>) => void (internals = wrap(v)),
  });
}

/** Alerts the page requests from now on; each is answered with Cancel until `answerAlerts(page, "confirm")`. */
export const watchAlerts = async (page: Page): Promise<void> => void (await page.addInitScript(install));

export const answerAlerts = (page: Page, answer: "confirm" | "cancel"): Promise<void> =>
  page.evaluate((a) => void ((globalThis as unknown as Record<string, unknown>).__noterAlertAnswer = a), answer);

export const alerts = (page: Page): Promise<AlertRequest[]> =>
  page.evaluate(() => ((globalThis as unknown as Record<string, unknown>).__noterAlerts as AlertRequest[]) ?? []);

/** Everything the alert request says (title, message, button labels) as one string, so a test names the visible copy only. */
export const alertText = (a: AlertRequest): string => JSON.stringify(a.payload);
