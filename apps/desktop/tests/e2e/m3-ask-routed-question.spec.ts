// Ask reads a `new:<words>` route (Search's Ask Instead, a Library question): the question is asked once, shows on the page
// like a typed one (asked question, then its answer), and Back then Forward does not ask it again.
import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";

const QUESTION = "What did we decide about the websocket notifications?";

test.describe("cpt-noter-seq-ask-follow-up-and-copy", () => {
  test("happy path: a new:<words> route asks once, shows the question and its answer, and Back then Forward does not ask again", async ({ page }) => {
    await openWindow(page, "main", { fixedClock: true, world: (w) => W.idle(w) });
    await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
    // the route Ask Instead pushes, through the shell's navigate seam
    await page.evaluate(async (q) => {
      const { navigate } = (await import(/* @vite-ignore */ "/src/features/shell/navigate.ts")) as typeof import("../../src/features/shell/navigate");
      navigate({ section: "ask", key: `new:${encodeURIComponent(q)}` });
    }, QUESTION);

    await expect(page.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible();
    const questions = page.locator(".ak-turn .ak-q");
    await expect(questions).toHaveText([QUESTION]);
    await expect(page.locator('[data-component="cpt-noter-component-ui-cited-answer"]').last()).toBeVisible();
    await expect(page.locator('[data-region="AK-R4"]').getByRole("button", { name: "Ask", exact: true })).toBeVisible(); // answered, stored
    expect(await sent(page, "ask_start")).toHaveLength(1);

    await page.keyboard.press("Meta+BracketLeft"); // Back to Today
    await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
    await page.keyboard.press("Meta+BracketRight"); // Forward to the Ask entry
    await expect(page.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible();
    await expect(questions).toHaveText([QUESTION]);
    expect(await sent(page, "ask_start")).toHaveLength(1);
  });
});
