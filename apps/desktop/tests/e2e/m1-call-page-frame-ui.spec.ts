// M1 — Call page frame (docs/features/ui/call-page-frame.md, DESIGN.md › Screen — Call page PC-R1, PC-R2, PC-R4, PC-R5).
// The frame ships in M1 for two stories that start on a call's page: `cpt-noter-seq-dialogs-delete-call` (⋯ menu) and
// `cpt-noter-seq-notifications-allow-notifications` (banner). m1-library-dialogs-notifications.spec.ts proves them at the contract;
// these drive the page. Written before the page exists (tests first): they fail until call-page-frame lands, and its PR carries
// them. Markup follows the prototype (`screen('call-page')`): toolbar PC-R1, banner slot PC-R2, Call info in the inspector slot
// (MW-R4/PC-R4), the transcript in PC-R5; the calls are opened from Library › Calls (double-click), as the user does.
// Native, not here: the delete NSAlert (Cancel default, Return keeps the call) is XCUITest
// `test_cpt_noter_seq_dialogs_delete_call__alert_has_cancel_as_default`; the macOS notifications prompt is on the manual
// checklist; the page loading without activating the window after a stop is XCUITest
// `test_cpt_noter_seq_call_screen_stop_at_call_end__call_page_loads_without_taking_focus`.
import type { Page } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const TITLE = "Backend sync"; // call_backend: Zoom, 52 min, Dmitri S., Oleg M., You, audio kept
const toolbar = (page: Page) => page.locator('[data-region="PC-R1"]');
const banner = (page: Page) => page.locator('[data-region="PC-R2"], [data-region="MW-R5"]').filter({ hasText: /summary is ready/ });
const info = (page: Page) => page.locator('[data-region="PC-R4"], [data-region="MW-R4"]').filter({ hasText: "Call info" });
const button = (page: Page, name: string | RegExp) => page.getByRole("button", { name });
const menuItem = (page: Page, name: string | RegExp) => page.getByRole("menuitem", { name }).or(page.getByRole("menuitemcheckbox", { name }));
const sent = async (page: Page, name: string) => (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args);
const NOTIFY = "Notify Me When Summaries Are Ready";
const ASK = /Get a notification when a call[’']s summary is ready\./;

/** Both copies of the call (list row and the detail `call_get` serves). */
function patchCall(w: World, id: string, fn: (c: World["calls"][number]) => void): void {
  fn(w.calls.find((c) => c.id === id)!);
  const detail = w.call_details.find((d) => d.call.id === id);
  if (detail) fn(detail.call);
}
/** No call is recording; the Backend sync page opens as the first recorded call when `first` is set. */
const quiet =
  (first = false, more: (w: World) => void = () => {}) =>
  (w: World) => {
    W.idle(w);
    const detail = w.call_details.find((d) => d.call.id === W.PAST_CALL)!;
    detail.first_recorded_call = first;
    // The real core derives first_recorded_call from the DB: exactly one stored call makes it the first.
    if (first) {
      w.calls = w.calls.filter((c) => c.id === W.PAST_CALL);
      w.call_details = [detail];
    }
    more(w);
  };
/** Library › Calls (⌘3), then the call's page: Return or a double-click opens it. */
async function openCall(page: Page, title = TITLE) {
  await page.keyboard.press("Meta+Digit3");
  await page.locator('[data-region="MW-R3"]').getByText(title, { exact: true }).first().dblclick();
  await expect(toolbar(page)).toContainText(title);
}
const openMore = async (page: Page) => {
  await toolbar(page).getByRole("button", { name: "More" }).click();
};

test.describe("cpt-noter-flow-ui-call-page-frame-open", () => {
  test("UI — happy path: the page shows title, subtitle, only the Transcript view, Call info docked and the stored transcript", async ({ page }) => {
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    await expect(toolbar(page)).toContainText(/52 min(?: · Dmitri S\., Oleg M\., You)?/); // CallRow.participants is empty on the real core in M1 (speakers M2)
    await expect(button(page, "Back")).toBeEnabled();
    await expect(toolbar(page).getByText("Transcript", { exact: true })).toBeVisible(); // the view control lists what is delivered
    for (const later of ["Summary", "Agent Reviews", "History"]) await expect(toolbar(page).getByText(later, { exact: true })).toHaveCount(0);
    await expect(toolbar(page).getByRole("button", { name: "Share" })).toBeVisible(); // placeholder until M2
    await expect(button(page, /^(Hide|Show) Inspector/)).toBeVisible();

    for (const section of ["Participants", "Call", "Privacy", "Audio", "Processing"])
      await expect(info(page).getByRole("heading", { name: section, exact: true })).toBeVisible();
    for (const row of ["Type", "App", "When", "Length", "Languages"]) await expect(info(page).getByText(row, { exact: true })).toBeVisible();
    await expect(info(page)).toContainText("Kept until");
    await expect(info(page).getByRole("switch", { name: "Sensitive" })).not.toBeChecked();
    await expect(page.locator('[data-region="PC-R5"]')).toBeVisible();

    // The core knows which call this window shows, so it sends no notification for it; null once the page closes.
    expect(await sent(page, "call_get")).toContainEqual({
      call_id: W.PAST_CALL,
    });
    expect(await sent(page, "window_report_view")).toContainEqual({
      call_id: W.PAST_CALL,
    });
    await button(page, "Back").click();
    await expect.poll(async () => (await sent(page, "window_report_view")).at(-1)).toEqual({ call_id: null });
  });

  test("UI — empty path: Audio no longer kept — Call info says so and the page offers no way to delete it again", async ({ page }) => {
    await openWindow(page, "main", {
      world: quiet(false, (w) => patchCall(w, W.PAST_CALL, (c) => ((c.audio_deleted = true), (c.audio_kept_until = null)))),
    });
    await openCall(page);
    await expect(info(page)).toContainText(/Audio deleted on .+ · transcript kept/);
    await expect(info(page)).not.toContainText("Kept until");
    await expect(button(page, "Delete Audio Now…")).toHaveCount(0);
  });

  test("UI — error path: the call is gone, the page shows its empty state and Back returns to Calls", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: quiet() });
    await steer.failNext("call_get", "not_found");
    await openCall(page).catch(() => {}); // no title to wait for: the page is its empty state
    await expect(page.locator('[data-component="cpt-noter-component-ui-empty-state"]')).toBeVisible();
    await button(page, "Back").click();
    await expect(page.locator('[data-region="MW-R3"]').getByRole("heading", { name: "Calls" })).toBeVisible();
  });

  test("UI — error path: the read fails, the section error offers Try Again", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: quiet() });
    await steer.failNext("call_get", "internal");
    await openCall(page).catch(() => {});
    await button(page, "Try Again").click();
    await expect(toolbar(page)).toContainText(TITLE);
    expect((await sent(page, "call_get")).length).toBe(2);
  });
});

test.describe("cpt-noter-flow-ui-call-page-frame-more-menu", () => {
  test("UI — happy path: ⋯ offers Rename…, Call Type ▸, Mark as Sensitive, Show in Finder and Delete Call… (⌘⌫), no later-milestone items", async ({
    page,
  }) => {
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    await openMore(page);
    for (const name of ["Rename…", "Call Type", "Mark as Sensitive", "Show in Finder", "Delete Call…"]) await expect(menuItem(page, name)).toBeVisible();
    await expect(menuItem(page, "Delete Call…")).toContainText("⌘⌫");
    for (const later of ["Regenerate Outputs…", "Show Performance"]) await expect(menuItem(page, later)).toHaveCount(0); // M2, M5
    expect(await sent(page, "calls_delete")).toHaveLength(0); // never without the native alert (XCUITest)
  });

  test("UI — happy path: Rename… edits the title in place, Return saves with call_update", async ({ page }) => {
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    await openMore(page);
    await menuItem(page, "Rename…").click();
    const field = toolbar(page).getByRole("textbox");
    await field.fill("Backend sync, retro");
    await field.press("Enter");
    expect(await sent(page, "call_update")).toContainEqual({
      call_id: W.PAST_CALL,
      rev: 5,
      title: "Backend sync, retro",
    });
    await expect(toolbar(page)).toContainText("Backend sync, retro");
  });

  test("UI — error path: rename after the core changed the call (conflict) — the page shows the core's current values", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    await steer.change((w) => patchCall(w, W.PAST_CALL, (c) => ((c.title = "Backend sync (renamed elsewhere)"), (c.rev = 6)))); // behind the page's back
    await openMore(page);
    await menuItem(page, "Rename…").click();
    const field = toolbar(page).getByRole("textbox");
    await field.fill("My title");
    await field.press("Enter");
    await expect(toolbar(page)).toContainText("Backend sync (renamed elsewhere)");
    await expect(toolbar(page)).not.toContainText("My title");
  });

  test("UI — happy path: Call Type ▸ lists the core's types and call_update sets the one chosen", async ({ page }) => {
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    await openMore(page);
    await menuItem(page, "Call Type").hover();
    expect((await calls(page)).some((c) => c.kind === "invoke" && c.name === "call_types_list")).toBe(true);
    await menuItem(page, /standup/i).click();
    expect(await sent(page, "call_update")).toContainEqual({
      call_id: W.PAST_CALL,
      rev: 5,
      call_type: "standup",
    });
    await expect(info(page).getByText("Type", { exact: true }).locator("..")).toContainText(/standup/i);
  });

  test("UI — happy path: Mark as Sensitive turns the call sensitive, the menu then shows a checked Sensitive and Call info agrees", async ({ page }) => {
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    await openMore(page);
    await menuItem(page, "Mark as Sensitive").click();
    expect(await sent(page, "capture_set_sensitive")).toContainEqual({
      call_id: W.PAST_CALL,
      sensitive: true,
    });
    await expect(info(page).getByRole("switch", { name: "Sensitive" })).toBeChecked();
    await openMore(page);
    await expect(page.getByRole("menuitemcheckbox", { name: "Sensitive" })).toBeChecked();
  });

  test("UI — happy path: the Call info Sensitive switch sends the same command, on and off", async ({ page }) => {
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    const sw = info(page).getByRole("switch", { name: "Sensitive" });
    await sw.click();
    await expect(sw).toBeChecked();
    await sw.click();
    await expect(sw).not.toBeChecked();
    expect(await sent(page, "capture_set_sensitive")).toEqual([
      { call_id: W.PAST_CALL, sensitive: true },
      { call_id: W.PAST_CALL, sensitive: false },
    ]);
  });

  test("UI — happy path: Show in Finder reveals the call's folder", async ({ page }) => {
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    await openMore(page);
    await menuItem(page, "Show in Finder").click();
    expect(await sent(page, "open_external")).toContainEqual({
      target: {
        type: "reveal_in_finder",
        path: expect.stringContaining(W.PAST_CALL),
      },
    });
  });
});

test.describe("cpt-noter-seq-notifications-allow-notifications", () => {
  test("UI — happy path: Notify Me When Summaries Are Ready asks for the permission, Allow, the banner is gone", async ({ page }) => {
    await openWindow(page, "main", { world: quiet(true) });
    await openCall(page);
    await expect(banner(page)).toContainText(ASK);
    await banner(page).getByRole("button", { name: NOTIFY }).click();
    expect(await sent(page, "permission_request")).toContainEqual({
      kind: "notifications",
    }); // macOS shows its prompt (checklist)
    await expect(banner(page)).toHaveCount(0);
  });

  test("UI — error path — Notifications not allowed: Don't Allow, the banner goes away and the page keeps working", async ({ page }) => {
    await openWindow(page, "main", {
      world: quiet(true, (w) => W.permission(w, "notifications", "denied")),
    });
    await openCall(page);
    await banner(page).getByRole("button", { name: NOTIFY }).click();
    expect(await sent(page, "permission_request")).toHaveLength(1);
    await expect(banner(page)).toHaveCount(0);
    await expect(toolbar(page)).toContainText(TITLE);
    await expect(page.locator('[data-region="PC-R5"]')).toBeVisible();
  });

  test("UI — other path: × closes the banner without asking and it stays closed for this window", async ({ page }) => {
    await openWindow(page, "main", { world: quiet(true) });
    await openCall(page);
    await banner(page)
      .getByRole("button", { name: /^(Dismiss|Close)/ })
      .click();
    await expect(banner(page)).toHaveCount(0);
    await button(page, "Back").click();
    await openCall(page);
    await expect(banner(page)).toHaveCount(0); // local view state: no command, no persistence
    expect(await sent(page, "permission_request")).toHaveLength(0);
    expect(await sent(page, "banner_dismiss")).toHaveLength(0);
  });

  test("UI — empty path: no banner on a call that is not the first recorded one", async ({ page }) => {
    await openWindow(page, "main", { world: quiet(false) });
    await openCall(page);
    await expect(toolbar(page)).toContainText(TITLE);
    await expect(banner(page)).toHaveCount(0);
  });

  test("UI — empty path: never during a meeting — the call being recorded shows no banner", async ({ page }) => {
    await openWindow(page, "main", {
      world: (w) => {
        const row = w.calls.find((c) => c.id === W.LIVE_CALL)!;
        w.calls = [row]; // the only stored call: first on the real core too
        w.call_details = [{
          call: structuredClone(row),
          calendar_event: null,
          speakers: [],
          marks: [],
          gaps: [],
          mode_used: w.app.privacy.effective,
          audio_not_stored: false,
          first_recorded_call: true,
        }];
      },
    });
    await openCall(page, W.LIVE_TITLE);
    await expect(banner(page)).toHaveCount(0);
  });
});
