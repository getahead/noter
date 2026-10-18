// M1 — Dialogs, sheets and alerts (docs/features/ui/dialogs-host.md, DESIGN.md › Screen — Dialogs, sheets and popovers).
// UI half of cpt-noter-seq-dialogs-delete-call and of the inline confirmation of
// cpt-noter-seq-call-screen-recover-capture; m1-library-dialogs-notifications.spec.ts proves the
// same paths at the contract. The alert itself is drawn by macOS: the page only asks for it through
// the dialog plugin, so support/native-alert.ts records the request and answers it. Written before
// the screens exist (tests first). Markup follows the prototype: sheets are `[data-primitive="sheet"]`
// (role dialog, aria-modal), call rows `data-component="cpt-noter-component-ui-call-row"`.
// NATIVE (apps/desktop/tests/native): test_cpt_noter_seq_dialogs_delete_call__error_return_pressed_by_habit
//   (NSAlert with Cancel as default, Return keeps the call) and
//   test_cpt_noter_seq_menu_bar_control_recording__quit_while_recording (the Quit Noter alert with Stop and Quit).
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { alertText, alerts, answerAlerts, watchAlerts } from "./support/native-alert";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const ROW = '[data-component="cpt-noter-component-ui-call-row"][data-variant="table-row"]';
const rowOf = (page: Page, title: string) => page.locator(ROW).filter({ hasText: title });
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const sent = async (page: Page, name: string): Promise<unknown[]> =>
  (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args);

const TITLE = "Backend sync";
const ONE = "This removes its audio, transcript, summary, items and cards. You can't undo this.";
const MANY = "This removes their audio, transcripts, summaries, items and cards. You can't undo this.";

/** The main window on the Calls list with nobody recording. */
async function openCalls(page: Page, world: (w: Parameters<typeof W.idle>[0]) => void = () => {}) {
  await watchAlerts(page);
  const steer = await openWindow(page, "main", { world: (w) => (W.idle(w), world(w)) });
  await page.keyboard.press("Meta+Digit3");
  await expect(rowOf(page, TITLE).first()).toBeVisible();
  return steer;
}

/** Calls → the call's page (double-click on its row). */
async function openCallPage(page: Page, title = TITLE) {
  await rowOf(page, title).first().dblclick();
  await expect(page.locator('[data-region="MW-R1"]').getByRole("heading", { name: title })).toBeVisible();
}

test.describe("cpt-noter-seq-dialogs-delete-call", () => {
  test("UI — happy path: Delete Call… in the ⋯ menu asks first, Delete removes the call and the Calls list takes its place", async ({ page }) => {
    await openCalls(page);
    await openCallPage(page);

    await button(page, "More").click();
    await page.getByRole("menuitem", { name: /^Delete Call…/ }).click();
    await expect.poll(async () => (await alerts(page)).length).toBe(1);
    const [alert] = await alerts(page);
    const text = alertText(alert);
    expect(text).toContain(`Delete “${TITLE}”?`);
    expect(text).toContain(ONE);
    expect(text).toContain("Cancel");
    expect(text).toContain("Delete");
    expect(await sent(page, "calls_delete")).toHaveLength(0); // nothing goes before the destructive button

    await answerAlerts(page, "confirm");
    await page.keyboard.press("Meta+Backspace"); // the shortcut asks again; the answer is Delete this time
    await expect.poll(() => sent(page, "calls_delete")).toContainEqual({ call_ids: [W.PAST_CALL] });
    await expect(page.locator('[data-region="MW-R2"]').locator('[aria-current="page"]')).toContainText("Calls");
    await expect(rowOf(page, TITLE)).toHaveCount(0);
    await expect(rowOf(page, W.LIVE_TITLE)).toHaveCount(1);
  });

  test("UI — error path: Return pressed by habit chooses Cancel, the call is kept and focus is back on ⋯ More", async ({ page }) => {
    await openCalls(page);
    await openCallPage(page);

    await button(page, "More").click();
    await page.getByRole("menuitem", { name: /^Delete Call…/ }).click();
    await expect.poll(async () => (await alerts(page)).length).toBe(1);
    // The dialog answers Cancel (Return or Esc in the NSAlert, see NATIVE above).
    await expect(button(page, "More")).toBeFocused();
    expect(await sent(page, "calls_delete")).toHaveLength(0);
    await expect(page.locator('[data-region="MW-R1"]').getByRole("heading", { name: TITLE })).toBeVisible();

    await page.keyboard.press("Meta+BracketLeft");
    await expect(rowOf(page, TITLE)).toHaveCount(1);
  });

  test("UI — other path: Several calls selected, ⌘⌫ asks Delete 3 calls? and Delete 3 Calls removes exactly those rows", async ({ page }) => {
    let extra: string[] = [];
    await openCalls(page, (w) => (extra = W.morePastCalls(w, 2)));
    await rowOf(page, TITLE).first().click();
    await rowOf(page, `${TITLE} #2`).click({ modifiers: ["Meta"] });
    await rowOf(page, `${TITLE} #3`).click({ modifiers: ["Meta"] });
    await expect(page.locator('[data-region="LC-R1"]')).toContainText("· 3 selected");

    await page.keyboard.press("Meta+Backspace");
    await expect.poll(async () => (await alerts(page)).length).toBe(1);
    const [alert] = await alerts(page);
    const text = alertText(alert);
    expect(text).toContain("Delete 3 calls?");
    expect(text).toContain(MANY);
    expect(text).toContain("Delete 3 Calls");

    await answerAlerts(page, "confirm");
    await page.keyboard.press("Meta+Backspace");
    const ids = [W.PAST_CALL, ...extra];
    await expect
      .poll(async () => (await sent(page, "calls_delete")).map((a) => [...(a as { call_ids: string[] }).call_ids].sort()))
      .toContainEqual([...ids].sort());
    await expect(page.locator(ROW)).toHaveCount(1);
    await expect(rowOf(page, W.LIVE_TITLE)).toHaveCount(1);
    await expect(page.locator('[data-region="LC-R1"]')).not.toContainText("selected");
  });

  test("UI — error path: the delete fails, the call stays listed and its page shows the section error", async ({ page }) => {
    const steer = await openCalls(page);
    await openCallPage(page);
    await answerAlerts(page, "confirm");
    await steer.failNext("calls_delete", "internal");
    await page.keyboard.press("Meta+Backspace");
    await expect.poll(() => sent(page, "calls_delete")).toHaveLength(1);
    await expect(page.getByRole("alert").or(page.locator('[data-component="cpt-noter-component-ui-inline-banner"]')).first()).toBeVisible();
    await page.keyboard.press("Meta+BracketLeft");
    await expect(rowOf(page, TITLE)).toHaveCount(1); // listed until the core reports it gone
  });
});

test.describe("cpt-noter-flow-ui-dialogs-host-sheet", () => {
  test("UI — keyboard only: a sheet keeps focus inside, Esc cancels and focus returns to the control that opened it", async ({ page }) => {
    await openWindow(page, "main", { world: (w) => (W.idle(w), W.selfTestSkipped(w)) });
    const opener = page.locator('[data-region="MW-R5"], [data-region="TD-R2"]').getByRole("button", { name: "Run Audio Self-Test…" }).first();
    await opener.focus();
    await page.keyboard.press("Enter");

    const sheet = page.locator('[data-primitive="sheet"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("role", "dialog");
    await expect(sheet).toHaveAttribute("aria-modal", "true");
    expect((await sheet.boundingBox())!.width).toBeGreaterThanOrEqual(480);
    expect((await sheet.boundingBox())!.width).toBeLessThanOrEqual(640);
    for (let i = 0; i < 15; i++) {
      await page.keyboard.press("Tab");
      expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("UI — error path: a sheet command that fails leaves the busy state and the sheet stays open", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: (w) => (W.idle(w), W.selfTestSkipped(w)) });
    await page.getByRole("button", { name: "Run Audio Self-Test…" }).first().click();
    const sheet = page.locator('[data-primitive="sheet"]');
    await steer.failNext("self_test_run", "internal");
    await sheet.getByRole("button", { name: "Run Test" }).click();
    await expect(sheet).toHaveAttribute("data-state", "open"); // back from busy once the command answered
    await expect(sheet).toBeVisible();
  });
});

test.describe("cpt-noter-flow-ui-dialogs-host-inline-confirm", () => {
  const nothingHeard = (w: Parameters<typeof W.idle>[0]) => W.notice(w, { type: "nothing_heard", since: Date.now() - 5 * W.MIN });

  test("UI — happy path (cpt-noter-seq-call-screen-recover-capture, Empty — Nothing heard yet): Discard Recording asks inline, Back has focus, Discard sends capture_discard, no alert", async ({ page }) => {
    await watchAlerts(page);
    await openWindow(page, "call-screen", { world: nothingHeard });
    await button(page, "Discard Recording").click();

    await expect(page.getByText("Discard this recording? This can't be undone.")).toBeVisible();
    await expect(button(page, "Back")).toBeFocused(); // and no default button on Discard
    await expect(button(page, "Discard Recording")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0); // never an alert or a sheet in the call window
    expect(await sent(page, "capture_discard")).toHaveLength(0);

    await button(page, "Discard").click();
    await expect.poll(() => sent(page, "capture_discard")).toContainEqual({ call_id: W.LIVE_CALL });
    expect(await alerts(page)).toHaveLength(0);
  });

  test("UI — error path: Back returns to the notice's actions and nothing is deleted", async ({ page }) => {
    await openWindow(page, "call-screen", { world: nothingHeard });
    await button(page, "Discard Recording").click();
    await expect(button(page, "Back")).toBeFocused();
    await page.keyboard.press("Enter"); // Return on the focused Back, not on Discard

    await expect(button(page, "Discard Recording")).toBeVisible();
    await expect(button(page, "Keep Recording")).toBeVisible();
    await expect(page.getByText("Discard this recording?")).toHaveCount(0);
    expect(await sent(page, "capture_discard")).toHaveLength(0);
  });

  test("UI — error path (cpt-noter-seq-call-screen-recover-capture, Disk nearly full): Delete Old Audio… opens no sheet or alert in the call window and deletes nothing", async ({ page }) => {
    await watchAlerts(page);
    await openWindow(page, "call-screen", {
      world: (w) => {
        w.app.environment.disk_free_mb = 2_000;
        W.degrade(w, { type: "disk_low", free_mb: 2_000 });
      },
    });
    await expect(page.getByText("2 GB free on this Mac. Recording continues.")).toBeVisible();
    await page.getByRole("button", { name: "Delete Old Audio…" }).or(page.getByRole("link", { name: "Delete Old Audio…" })).first().click();
    await expect(page.getByRole("dialog")).toHaveCount(0); // the sheet opens in the main window, never here
    expect(await alerts(page)).toHaveLength(0);
    expect(await sent(page, "audio_delete_older")).toHaveLength(0);
  });
});
