// M1 — Notifications (docs/features/ui/notifications.md, DESIGN.md › Screen — Notifications, Call page PC-R2,
// Settings › General). macOS draws the notifications and the core decides when to send them, so the UI half is
// the permission request on a call's page, the notifications-off line in Settings, and `window_report_view`.
// m1-library-dialogs-notifications.spec.ts proves the story at the contract; these drive the screens.
// Written before the screens exist (tests first): they fail until call-page-frame, settings and this feature
// land. Markup: the banner is in PC-R2 of the Call page; the Calls section opens a call from its row.
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const PAST_TITLE = "Backend sync";

const banner = (page: Page) => page.locator('[data-region="PC-R2"]');
const sent = async (page: Page, name: string): Promise<Array<Record<string, unknown>>> =>
  (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => (c.args ?? {}) as Record<string, unknown>);

/** Calls (⌘3), then the recorded call's page the way the core opens it (`window_navigate` → `nav:request`); the Calls list is 2.13's. */
async function openCallPage(page: Page) {
  await page.keyboard.press("Meta+Digit3");
  await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
  await page.evaluate(async (callId) => {
    const args = { target: { type: "call_page", call_id: callId, tab: "transcript" } };
    const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
    await (g.__noterFake ? g.__noterFake.invoke("window_navigate", args) : g.__TAURI_INTERNALS__!.invoke("window_navigate", { args }));
  }, W.PAST_CALL);
  await expect(page.getByRole("heading", { name: new RegExp(PAST_TITLE) }).first()).toBeVisible();
}

// the banner is for the first recorded call (D68: `first_recorded_call`) while the permission was never asked
const notAsked = (w: Parameters<typeof W.idle>[0]) => {
  W.idle(w);
  w.app.environment.notifications = "not_determined";
  W.permission(w, "notifications", "not_asked");
  const detail = w.call_details.find((d) => d.call.id === W.PAST_CALL)!;
  detail.first_recorded_call = true;
  // the real core derives the flag from the store (one call recorded), so the first call is the only one
  w.calls = w.calls.filter((c) => c.id === W.PAST_CALL);
  w.call_details = [detail];
  w.transcripts = w.transcripts.filter((t) => t.call_id === W.PAST_CALL);
};

test.describe("cpt-noter-seq-notifications-allow-notifications", () => {
  test("UI — happy path: Notify Me When Summaries Are Ready on the call's page, Allow, the banner goes and the page is reported", async ({ page }) => {
    await openWindow(page, "main", { world: notAsked });
    await openCallPage(page);
    expect((await sent(page, "window_report_view")).some((a) => a.call_id === W.PAST_CALL)).toBe(true); // lets the core skip a notification for the page on screen
    expect(await sent(page, "permission_request")).toEqual([]); // never asked at first run or on its own

    await expect(banner(page)).toContainText(/Get a notification when a summary is ready\./);
    await banner(page).getByRole("button", { name: "Notify Me When Summaries Are Ready" }).click(); // the macOS prompt is native: NATIVE test_cpt_noter_seq_notifications_allow_notifications__happy_path
    expect(await sent(page, "permission_request")).toEqual([{ kind: "notifications" }]);
    await expect(banner(page).getByRole("button", { name: "Notify Me When Summaries Are Ready" })).toHaveCount(0);
  });

  test("UI — happy path: the banner's × closes it without asking macOS", async ({ page }) => {
    await openWindow(page, "main", { world: notAsked });
    await openCallPage(page);
    await banner(page).getByRole("button", { name: /^(Dismiss|Close)/ }).click();
    await expect(banner(page).getByRole("button", { name: "Notify Me When Summaries Are Ready" })).toHaveCount(0);
    expect(await sent(page, "permission_request")).toEqual([]);
  });

  test("UI — error path: Notifications not allowed — Don't Allow drops the banner, nothing else changes, Settings then says they are off", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: notAsked });
    await openCallPage(page);
    await steer.failNext("permission_request", "permission_denied", { type: "permission", kind: "notifications" });
    await banner(page).getByRole("button", { name: "Notify Me When Summaries Are Ready" }).click();

    await expect(banner(page).getByRole("button", { name: "Notify Me When Summaries Are Ready" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: new RegExp(PAST_TITLE) }).first()).toBeVisible(); // the page still shows every state
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await steer.change((w) => (w.app.environment.notifications = "denied")); // what macOS now reports
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("UI — other path: Turn notifications on later — Settings › General says Notifications are off for Noter, Open System Settings…, the line goes once they are on", async ({ page }) => {
    const steer = await openWindow(page, "settings", { world: (w) => (W.idle(w), (w.app.environment.notifications = "denied")) });
    await expect(page.getByText("Notifications are off for Noter")).toBeVisible();

    await page.getByRole("button", { name: "Open System Settings…" }).click();
    expect(await sent(page, "open_external")).toEqual([{ target: { type: "system_settings", permission: "notifications" } }]);
    await steer.change((w) => (w.app.environment.notifications = "authorized")); // turned on in System Settings
    await expect(page.getByText("Notifications are off for Noter")).toHaveCount(0);
  });

  test("UI — other path: notifications allowed — Settings › General has no notifications-off line", async ({ page }) => {
    await openWindow(page, "settings", { world: (w) => (W.idle(w), (w.app.environment.notifications = "authorized")) });
    await expect(page.getByRole("heading", { name: "General" }).first()).toBeVisible();
    await expect(page.getByText("Notifications are off for Noter")).toHaveCount(0);
  });
});

test.describe("cpt-noter-flow-ui-notifications-receive", () => {
  test("UI — happy path: the main window reports the call it shows with window_report_view, and null once it leaves the page", async ({ page }) => {
    await openWindow(page, "main", { world: (w) => W.idle(w) });
    await openCallPage(page);
    await expect.poll(async () => (await sent(page, "window_report_view")).some((a) => a.call_id === W.PAST_CALL)).toBe(true);

    await page.keyboard.press("Meta+Digit1"); // Today
    await expect.poll(async () => (await sent(page, "window_report_view")).at(-1)?.call_id ?? null).toBeNull();
  });

  test("UI — other path: a notification click (nav:request to the call's page) opens that page in the main window", async ({ page }) => {
    await openWindow(page, "main", { world: (w) => W.idle(w) });
    await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
    // the real core emits nav:request itself when asked to navigate (what a click does); the fake can also be told to
    await page.evaluate(async (id) => {
      const g = globalThis as unknown as { __noterFake?: { emit(e: string, p: unknown): void }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
      const target = { type: "call_page", call_id: id, tab: "transcript" };
      if (g.__noterFake) g.__noterFake.emit("nav:request", target);
      else await g.__TAURI_INTERNALS__!.invoke("window_navigate", { args: { target } });
    }, W.PAST_CALL);
    await expect(page.getByRole("heading", { name: new RegExp(PAST_TITLE) }).first()).toBeVisible();
    expect((await sent(page, "window_report_view")).some((a) => a.call_id === W.PAST_CALL)).toBe(true);
  });
});
