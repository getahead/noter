// The primitives page of cpt-noter-feature-ui-primitives (tests/visual/pages/primitives.tsx): every primitive and
// the empty state, inline banner and inline status in their static states, in the four appearance states of
// cpt-noter-state-ui-tokens-theming-appearance, plus the hover, keyboard-focus and help-tag states the CSS draws.
import { expect, test, type Page } from "@playwright/test";

const states = {
  light: { colorScheme: "light", contrast: "no-preference" },
  dark: { colorScheme: "dark", contrast: "no-preference" },
  "light-contrast": { colorScheme: "light", contrast: "more" },
  "dark-contrast": { colorScheme: "dark", contrast: "more" },
} as const;

async function open(page: Page) {
  await page.goto("/tests/visual/pages/primitives.html");
  await page.locator('[data-gallery="key-cap"]').waitFor();
  // the sheet, menu and popover take focus when they mount, as they do on a screen; the page shows no focus ring
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
}

test.describe("cpt-noter-dod-ui-primitives-controls primitives page", () => {
  for (const [state, media] of Object.entries(states)) {
    test(`renders every primitive and feedback component (${state})`, async ({ page }) => {
      await page.emulateMedia(media);
      await open(page);
      await expect(page).toHaveScreenshot(`primitives-${state}.png`, { fullPage: true, timeout: 15_000 }); // amd64 emulation on Apple Silicon is slow
    });
  }

  test("draws hover and the keyboard-only focus ring (cpt-noter-flow-ui-primitives-operate-control)", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Shift"); // the last input is the keyboard, so focus is keyboard focus (Tab skips buttons in macOS WebKit)
    await page.locator("#btn-focus").focus();
    await expect(page.locator("#btn-focus")).toBeFocused();
    await page.locator("#btn-hover").hover();
    await expect(page.locator('[data-gallery="push-button"]')).toHaveScreenshot("push-button-pointer-keyboard.png");
  });

  test("shows the help tag on keyboard focus", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Shift");
    await page.locator("#tooltip-target").focus();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await expect(page.locator('[data-gallery="tooltip"]')).toHaveScreenshot("tooltip-focus.png");
  });

  test("opens the popover under its anchor; Esc closes it", async ({ page }) => {
    await open(page);
    await page.locator("#popover-anchor").click();
    const popover = page.getByRole("dialog", { name: "Speakers" });
    await expect(popover).toBeVisible();
    await expect(page).toHaveScreenshot("popover-open.png");
    await page.keyboard.press("Escape");
    await expect(popover).toHaveCount(0);
  });
});
