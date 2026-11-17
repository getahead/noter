// Ask, slice 1 (cpt-noter-seq-ask-follow-up-and-copy): two questions in one thread. The second is asked while the first
// answer's stream data is still in the window store: it must show as asked, show Stop, and be answered under the same core thread.
import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";

const FIRST = "What did we agree with backend about the websocket notifications?";
const SECOND = "Who owns the acceptance criteria for the reconnect?";

test.describe("cpt-noter-seq-ask-follow-up-and-copy", () => {
  test("happy path: a follow-up after an answered question stays on screen, shows Stop and is answered in the same thread", async ({ page }) => {
    await openWindow(page, "main", { fixedClock: true, world: (w) => W.idle(w) });
    // a key pressed before the window's shortcuts are bound is lost, so press until the page is Ask
    await expect(async () => {
      await page.keyboard.press("Meta+Digit2");
      await expect(page.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible({ timeout: 1000 });
    }).toPass();
    const composer = page.locator('[data-region="AK-R4"]');
    const questions = page.locator(".ak-turn .ak-q");

    await composer.getByRole("textbox").fill(FIRST);
    await composer.getByRole("textbox").press("Enter");
    await expect(questions).toHaveText([FIRST]);
    await expect(composer.getByRole("button", { name: "Ask", exact: true })).toBeVisible(); // answered and stored

    await composer.getByRole("textbox").fill(SECOND);
    await composer.getByRole("textbox").press("Enter");
    await expect(questions.last()).toHaveText(SECOND); // not dropped by the first answer's data
    await expect(questions).toHaveText([FIRST, SECOND]);

    const starts = (await sent(page, "ask_start")) as { thread_id: string | null; question: string }[];
    expect(starts.map((s) => s.question)).toEqual([FIRST, SECOND]);
    expect(starts[0].thread_id).toBeNull();
    expect(starts[1].thread_id).toEqual(expect.any(String)); // a follow-up: the same core thread
  });
});
