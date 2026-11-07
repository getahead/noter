// Screenshot specs of speaker naming (docs/features/ui/speakers.md › Definitions of Done): the Call page's naming panel
// (PC-R9) with its rows, hidden, with a skipped speaker and with a person picked, and the Fix Term popover, rendered
// against the fake core on the live call's transcript (the one with unnamed speakers). Baselines come from the
// update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { openWindow } from "../e2e/support/app";
import { navigate } from "../e2e/support/call-page";
import * as S from "../e2e/support/speakers-world";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";

const quiet = (w: World) => {
  W.idle(w);
  w.app.setup.self_test = { type: "passed", at: 1 };
  S.unnamed(w, 2);
};
const panel = (page: Page) => page.locator('[data-region="PC-R9"]');
const rowOf = (page: Page, label: string) => panel(page).getByRole("group", { name: label });

async function open(page: Page) {
  await openWindow(page, "main", { world: quiet });
  await navigate(page, "transcript", S.CALL);
  await expect(panel(page)).toContainText("3 not named");
}
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.describe("cpt-noter-dod-ui-speakers-naming speaker naming panel", () => {
  test("Name speakers: a row per unnamed speaker", async ({ page }) => {
    await open(page);
    await shot(page, "naming-panel-rows");
  });

  test("a person picked: Name enabled", async ({ page }) => {
    await open(page);
    const row = rowOf(page, "Speaker 3");
    await row.getByRole("combobox", { name: "Name…" }).fill("Pav");
    await row.getByRole("option", { name: /^Pavel/ }).click();
    await shot(page, "naming-panel-picked");
  });

  test("Skipped (1) opened", async ({ page }) => {
    await open(page);
    await rowOf(page, "Speaker 4").getByRole("button", { name: "Skip" }).click();
    await panel(page).getByRole("button", { name: /Skipped \(1\)/ }).click();
    await expect(panel(page).getByRole("button", { name: "Name…" })).toBeVisible();
    await shot(page, "naming-panel-skipped");
  });

  test("Hide ▴: the one-line summary", async ({ page }) => {
    await open(page);
    await panel(page).getByRole("button", { name: "Hide ▴" }).click();
    await expect(panel(page)).toContainText("3 speakers not named");
    await shot(page, "naming-panel-hidden");
  });
});

test.describe("cpt-noter-dod-ui-speakers-corrections fix term popover", () => {
  test("a selected word opens Fix term with the correction field", async ({ page }) => {
    await open(page);
    const text = page.locator('[data-component="cpt-noter-component-ui-transcript-segment-row"] .cw-seg__text').first();
    await text.dblclick();
    await text.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Fix Term…", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Fix term" })).toBeVisible();
    await shot(page, "fix-term-popover");
  });
});
