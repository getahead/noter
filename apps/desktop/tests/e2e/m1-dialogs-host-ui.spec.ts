// Only the paths that need nothing but the Calls list are here; the call page's ⋯ menu, the call window's notice and Today's self-test opener bring the rest with their features.
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
import {
  alertText,
  alerts,
  answerAlerts,
  watchAlerts,
} from "./support/native-alert";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const ROW =
  '[data-component="cpt-noter-component-ui-call-row"][data-variant="table-row"]';
const rowOf = (page: Page, title: string) =>
  page.locator(ROW).filter({ hasText: title });
const sent = async (page: Page, name: string): Promise<unknown[]> =>
  (await calls(page))
    .filter((c) => c.kind === "invoke" && c.name === name)
    .map((c) => c.args);

const TITLE = "Backend sync";
const MANY =
  "This removes their audio, transcripts, summaries, items and cards. You can't undo this.";

/** The main window on the Calls list with nobody recording. */
async function openCalls(
  page: Page,
  world: (w: Parameters<typeof W.idle>[0]) => void = () => {},
) {
  await watchAlerts(page);
  const steer = await openWindow(page, "main", {
    world: (w) => (W.idle(w), world(w)),
  });
  await page.keyboard.press("Meta+Digit3");
  await expect(rowOf(page, TITLE).first()).toBeVisible();
  return steer;
}

test.describe("cpt-noter-seq-dialogs-delete-call", () => {
  test("UI — other path: Several calls selected, ⌘⌫ asks Delete 3 calls? and Delete 3 Calls removes exactly those rows", async ({
    page,
  }) => {
    let extra: string[] = [];
    await openCalls(page, (w) => (extra = W.morePastCalls(w, 2)));
    await rowOf(page, TITLE).first().click();
    await rowOf(page, `${TITLE} #2`).click({ modifiers: ["Meta"] });
    await rowOf(page, `${TITLE} #3`).click({ modifiers: ["Meta"] });
    await expect(page.locator('[data-region="LC-R1"]')).toContainText(
      "· 3 selected",
    );

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
      .poll(async () =>
        (await sent(page, "calls_delete")).map((a) =>
          [...(a as { call_ids: string[] }).call_ids].sort(),
        ),
      )
      .toContainEqual([...ids].sort());
    await expect(page.locator(ROW)).toHaveCount(1);
    await expect(rowOf(page, W.LIVE_TITLE)).toHaveCount(1);
    await expect(page.locator('[data-region="LC-R1"]')).not.toContainText(
      "selected",
    );
  });
});

test.describe("cpt-noter-flow-ui-dialogs-host-sheet", () => {});

test.describe("cpt-noter-flow-ui-dialogs-host-inline-confirm", () => {
});
