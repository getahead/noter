// Live and stored transcript (cpt-noter-feature-ui-live-transcript): following, detached, waiting for speech, replay on
// headphones, recording on speakers, output not identified, and the stored transcript, rendered against the fake core.
import { expect, test, type Page } from "@playwright/test";

import { openWindow, type Steer } from "../e2e/support/app";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";

const ANNA_LINE = "drawer redesign до пятницы";
const log = (page: Page) => page.getByRole("log", { name: "Transcript" });
const row = (page: Page, text: string) => log(page).locator('[data-component="cpt-noter-component-ui-transcript-segment-row"]').filter({ hasText: text });
/** The live call without its scripted lines, so nothing moves while the shot is taken. */
const still = (w: World) => void (w.live_script = []);
function route(w: World, r: "headphones" | "speakers" | "unknown") {
  still(w);
  w.app.environment.output_route = r;
  w.app.capture.output_route = r;
  w.app.capture.replay_available = r === "headphones";
}

async function live(page: Page, world: (w: World) => void): Promise<Steer> {
  const steer = await openWindow(page, "call-screen", { world });
  await expect(page.locator('[data-component="cpt-noter-component-ui-transcript-view"]')).toBeVisible();
  return steer;
}
const shot = (page: Page, name: string) => expect(page).toHaveScreenshot(`${name}.png`);

test.describe("cpt-noter-dod-ui-live-transcript-view transcript view", () => {
  test("following: the live log at its end with the hypothesis last", async ({ page }) => {
    await live(page, still);
    await expect(log(page)).toHaveAttribute("data-state", "following");
    await shot(page, "following");
  });

  test("detached: scrolled up, Jump to Live counts the new lines", async ({ page }) => {
    const steer = await live(page, (w) => {
      still(w);
      const t = w.transcripts.find((x) => x.call_id === W.LIVE_CALL)!;
      const last = t.segments.at(-1)!;
      for (let i = 0; i < 40; i++) t.segments.push({ ...last, id: `seg_more_${i}`, t0_ms: last.t0_ms + (i + 1) * 8000, t1_ms: last.t1_ms + (i + 1) * 8000 });
      t.last_seq += 40;
    });
    await log(page).hover();
    await page.mouse.wheel(0, -20_000);
    for (const i of [1, 2, 3]) {
      const segment = { id: `seg_v${i}`, call_id: W.LIVE_CALL, channel: "sys" as const, speaker: { speaker_id: "spk_1", label: { type: "unnamed" as const, n: 1 } }, crosstalk_with: [], t0_ms: 1_500_000 + i * 8000, t1_ms: 1_506_000 + i * 8000, text: `New line ${i}`, lang: "en" as const, lang_p: 0.9, confidence: 0.9, state: "confirmed" as const, pass: "live" as const, corrections: [] };
      await steer.push("transcript_subscribe", { event: { type: "confirmed", segment } });
    }
    await expect(page.getByRole("button", { name: "Jump to Live · 3 new lines" })).toBeVisible();
    await page.mouse.move(0, 0);
    await shot(page, "detached");
  });

  test("nothing heard: the You and Others meters with Waiting for speech…", async ({ page }) => {
    await live(page, (w) => {
      still(w);
      Object.assign(w.transcripts.find((t) => t.call_id === W.LIVE_CALL)!, { segments: [], hypotheses: [], marks: [], gaps: [] });
    });
    await expect(page.getByText("Waiting for speech…")).toBeVisible();
    // the meters move with the fake's random levels
    await expect(page).toHaveScreenshot("nothing-heard.png", { mask: [page.locator('[data-primitive="level-meter"]')] });
  });

  test("stored: the call's transcript with its audio line", async ({ page }) => {
    await openWindow(page, "main", { world: (w) => (W.idle(w), void (w.app.capture.phase = "idle")) });
    await page.evaluate((id) => (location.hash = `transcript=${id}`), W.PAST_CALL);
    await expect(page.locator('[data-region="PC-R5"]')).toContainText(/audio kept until/);
    await shot(page, "stored");
  });
});

test.describe("cpt-noter-dod-ui-live-transcript-replay replay", () => {
  test("replay: Anna K.'s line on headphones with the live playback bar", async ({ page }) => {
    await live(page, (w) => route(w, "headphones"));
    await row(page, ANNA_LINE).hover();
    await row(page, ANNA_LINE).getByRole("button", { name: "Play this line" }).click();
    await expect(page.locator('[data-region="CS-R2b"]')).toContainText("Replaying while recording · headphones");
    await page.mouse.move(0, 0);
    await expect(page).toHaveScreenshot("replay.png", { mask: [page.locator(".cw-pb__time, .cw-pb__scrub")] });
  });

  for (const [name, r] of [
    ["speakers", "speakers"],
    ["unknown-route", "unknown"],
  ] as const) {
    test(`${name}: the play control disabled with its reason`, async ({ page }) => {
      await live(page, (w) => route(w, r));
      await row(page, ANNA_LINE).hover();
      await row(page, ANNA_LINE).getByRole("button", { name: "Play this line" }).focus();
      await page.keyboard.press("Space");
      await expect(row(page, ANNA_LINE).getByRole("status")).toBeVisible();
      await shot(page, name);
    });
  }
});
