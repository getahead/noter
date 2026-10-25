// M1 — Call page frame (docs/features/ui/call-page-frame.md, DESIGN.md › Screen — Call page PC-R1, PC-R2, PC-R4, PC-R5).
// The frame ships in M1 for two stories that start on a call's page: `cpt-noter-seq-dialogs-delete-call` (⋯ menu) and
// `cpt-noter-seq-notifications-allow-notifications` (banner). m1-library-dialogs-notifications.spec.ts proves them at the contract;
// these drive the page. Written before the page exists (tests first): they fail until call-page-frame lands, and its PR carries
// them. Markup follows the prototype (`screen('call-page')`): toolbar PC-R1, banner slot PC-R2, Call info in the inspector slot
// (MW-R4/PC-R4), the transcript in PC-R5; the call is opened as the core opens it (`window_navigate` → `nav:request`); the Calls list is 2.13's.
// Native, not here: the delete NSAlert (Cancel default, Return keeps the call) is XCUITest
// `test_cpt_noter_seq_dialogs_delete_call__alert_has_cancel_as_default`; the macOS notifications prompt is on the manual
// checklist; the page loading without activating the window after a stop is XCUITest
// `test_cpt_noter_seq_call_screen_stop_at_call_end__call_page_loads_without_taking_focus`.
import type { Page } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { alerts, alertText, answerAlerts, watchAlerts } from "./support/native-alert";
import { expect, test } from "./support/fixtures";

const STDIO = process.env.NOTER_CORE === "stdio";
const TITLE = "Backend sync"; // call_backend: Zoom, 52 min, Dmitri S., Oleg M., You, audio kept
const toolbar = (page: Page) => page.locator('[data-region="PC-R1"]');
const banner = (page: Page) => page.locator('[data-region="PC-R2"], [data-region="MW-R5"]').filter({ hasText: /summary is ready/ });
const info = (page: Page) => page.locator('[data-region="PC-R4"], [data-region="MW-R4"]').filter({ hasText: "Call info" });
const button = (page: Page, name: string | RegExp) => page.getByRole("button", { name });
const menuItem = (page: Page, name: string | RegExp) => page.getByRole("menuitem", { name }).or(page.getByRole("menuitemcheckbox", { name }));
const sent = async (page: Page, name: string) => (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args);
const pane = (page: Page) => page.locator('[data-region="PC-R5"]');
const head = (page: Page) => pane(page).locator(".pc-tr__head");
const storedRows = (page: Page) => pane(page).getByRole("log", { name: "Transcript" }).locator('[data-component="cpt-noter-component-ui-transcript-segment-row"]');
const NOTIFY = "Notify Me When Summaries Are Ready";
const ASK = /Get a notification when a summary is ready\./; // D-16

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
    // the real core derives the flag from the store (one call recorded), so the first call is the only one
    if (first) {
      w.calls = w.calls.filter((c) => c.id === W.PAST_CALL);
      w.call_details = [detail];
      w.transcripts = w.transcripts.filter((t) => t.call_id === W.PAST_CALL);
    }
    more(w);
  };
/**
 * Library › Calls (⌘3), then the call's page the way the core opens it: a `window_navigate` to the call page (a
 * `nav:request`, as Open in Noter, Open Last Summary and a notification do). The Calls list (2.13) is not part of
 * this feature, so Back lands on Library › Calls whatever it shows. Works on the fake core and the real one.
 */
async function openCall(page: Page, title = TITLE) {
  await page.keyboard.press("Meta+Digit3");
  const id = title === TITLE ? W.PAST_CALL : W.LIVE_CALL;
  await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
  await page.evaluate(async (callId) => {
    const args = { target: { type: "call_page", call_id: callId, tab: "transcript" } };
    const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
    await (g.__noterFake ? g.__noterFake.invoke("window_navigate", args) : g.__TAURI_INTERNALS__!.invoke("window_navigate", { args }));
  }, id);
  await expect(toolbar(page)).toContainText(title);
}
const openMore = async (page: Page) => {
  await toolbar(page).getByRole("button", { name: "More" }).click();
};

test.describe("cpt-noter-flow-ui-call-page-frame-open", () => {
  test("UI — happy path: the page shows title, subtitle, only the Transcript view, Call info docked and the stored transcript", async ({ page }) => {
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    // the real core sends no participants yet (CallRow.participants is empty), so its subtitle ends at the length
    await expect(toolbar(page)).toContainText(STDIO ? /52 min/ : /52 min · Dmitri S\., Oleg M\., You/);
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
    // PC-R5: the header (Transcript, a tag per call language, the audio line) and the stored transcript under it
    await expect(head(page).getByText("Transcript", { exact: true })).toBeVisible();
    await expect(head(page).locator('[data-component="cpt-noter-component-ui-language-tag"][data-variant="call"]').first()).toBeVisible();
    await expect(head(page)).toContainText(/52 min · audio kept until /);
    await expect(storedRows(page).first()).toBeVisible();
    await expect(pane(page)).not.toContainText("The transcript appears here.");

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
    await expect(head(page)).toContainText("Audio deleted · transcript kept"); // D-36: no deletion date in M1
    await expect(storedRows(page).first()).toBeVisible(); // the transcript stays readable
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

  test("UI — other path: Rename… then Esc, or a click outside the field, keeps the title and sends nothing", async ({ page }) => {
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    for (const leave of [() => page.keyboard.press("Escape"), () => page.locator('[data-region="PC-R5"]').click()]) {
      await openMore(page);
      await menuItem(page, "Rename…").click();
      await toolbar(page).getByRole("textbox").fill("Not this");
      await leave();
      await expect(toolbar(page).getByRole("textbox")).toHaveCount(0);
      await expect(toolbar(page)).toContainText(TITLE);
    }
    expect(await sent(page, "call_update")).toEqual([]);
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
    await expect(info(page).getByRole("combobox", { name: "Type" })).toHaveValue("standup");
  });

  test("UI — happy path: the Call info Type pop-up lists the core's types and call_update sets the one chosen", async ({ page }) => {
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    const type = info(page).getByRole("combobox", { name: "Type" });
    await expect(type.getByRole("option", { name: /standup/i })).toHaveCount(1);
    await type.selectOption("standup");
    expect(await sent(page, "call_update")).toContainEqual({ call_id: W.PAST_CALL, rev: 5, call_type: "standup" });
    await expect(type).toHaveValue("standup");
  });

  test("UI — happy path: Call Type ▸ by keyboard — → opens it on its first type, ← goes back, Return sets a type", async ({ page }) => {
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    await openMore(page);
    await menuItem(page, "Call Type").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menu", { name: "Call Type" }).getByRole("menuitemcheckbox").first()).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(menuItem(page, "Call Type")).toBeFocused();
    await expect(page.getByRole("menu", { name: "Call Type" })).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await page.getByRole("menu", { name: "Call Type" }).getByRole("menuitemcheckbox", { name: /standup/i }).focus();
    await page.keyboard.press("Enter");
    expect(await sent(page, "call_update")).toContainEqual({ call_id: W.PAST_CALL, rev: 5, call_type: "standup" });
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

test.describe("cpt-noter-seq-dialogs-delete-call", () => {
  test("UI — other path: Cancel in the alert keeps the call and its page", async ({ page }) => {
    await watchAlerts(page);
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    await openMore(page);
    await menuItem(page, "Delete Call…").click();
    await expect.poll(async () => (await alerts(page)).length).toBe(1);
    expect(await sent(page, "calls_delete")).toHaveLength(0);
    await expect(toolbar(page)).toContainText(TITLE);
  });

  test("UI — other path: ⌘⌫ on the page asks Delete “Backend sync”?, Delete lands on Library › Calls", async ({ page }) => {
    await watchAlerts(page);
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    await answerAlerts(page, "confirm");
    await page.keyboard.press("Meta+Backspace");
    await expect.poll(async () => (await alerts(page)).length).toBe(1);
    expect(alertText((await alerts(page))[0]!)).toContain(`Delete “${TITLE}”?`);
    await expect.poll(async () => sent(page, "calls_delete")).toContainEqual({ call_ids: [W.PAST_CALL] });
    await expect(page.locator('[data-region="MW-R3"]').getByRole("heading", { name: "Calls" })).toBeVisible();
  });

  test("UI — other path: ⌘⌫ while renaming edits the title field, it does not delete", async ({ page }) => {
    await watchAlerts(page);
    await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    await openMore(page);
    await menuItem(page, "Rename…").click();
    await expect(page.getByRole("textbox", { name: /title/i })).toBeFocused();
    await page.keyboard.press("Meta+Backspace");
    expect(await alerts(page)).toHaveLength(0);
    expect(await sent(page, "calls_delete")).toHaveLength(0);
  });

  test("UI — error path: the delete fails, the page shows its section error and Try Again deletes again", async ({ page }) => {
    await watchAlerts(page);
    const steer = await openWindow(page, "main", { world: quiet() });
    await openCall(page);
    await steer.failNext("calls_delete", "internal");
    await answerAlerts(page, "confirm");
    await openMore(page);
    await menuItem(page, "Delete Call…").click();
    const error = page.getByRole("alert").filter({ hasText: "Couldn’t delete this call." });
    await expect(error).toBeVisible();
    await expect(toolbar(page)).toContainText(TITLE);
    await error.getByRole("button", { name: "Try Again" }).click();
    await expect.poll(async () => (await sent(page, "calls_delete")).length).toBe(2);
    await expect(page.locator('[data-region="MW-R3"]').getByRole("heading", { name: "Calls" })).toBeVisible();
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
        w.call_details.push({
          call: structuredClone(row),
          calendar_event: null,
          speakers: [],
          marks: [],
          gaps: [],
          mode_used: w.app.privacy.effective,
          audio_not_stored: false,
          first_recorded_call: true,
          folder: "/tmp/noter/live",
        });
      },
    });
    await openCall(page, W.LIVE_TITLE);
    await expect(banner(page)).toHaveCount(0);
  });
});
