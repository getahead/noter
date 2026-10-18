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

  test("every control keeps a 24 by 24 pt hit area, including checkboxes, switches and radios", async ({ page }) => {
    await open(page);
    // the visible control of each, and the label that a press on its hit area must reach
    const controls = [
      ['.np-check[data-variant="group"] .np-check__box', ".np-check"], // label-less checkbox (Select row)
      [".np-toggle--small .np-toggle__track", ".np-toggle"],
      [".np-radio .np-radio__dot", ".np-radio"],
      [".np-btn--small", ".np-btn"],
      [".np-ibtn--inline", ".np-ibtn"],
      [".np-disc", ".np-disc"],
    ];
    for (const [visible, target] of controls) {
      const hits = await page.locator(visible).first().evaluate((el, sel) => {
        el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect();
        const [cx, cy] = [r.left + r.width / 2, r.top + r.height / 2];
        const own = el.closest(sel);
        // the edges of a 24 by 24 box centred on the control, half a point inside
        return [[cx - 11.5, cy], [cx + 11.5, cy], [cx, cy - 11.5], [cx, cy + 11.5]].map(([x, y]) => document.elementFromPoint(x, y)?.closest(sel) === own);
      }, target);
      expect(hits, visible).toEqual([true, true, true, true]);
    }
  });

  test("a disabled button takes no hover feedback", async ({ page }) => {
    await open(page);
    await page.addStyleTag({ content: "* { transition: none !important; }" }); // read the hover look at once, not mid-ease
    const look = (el: Element) => {
      const s = getComputedStyle(el);
      return [s.backgroundColor, s.backgroundImage, s.filter];
    };
    const disabled = page.locator(".np-btn[disabled], .np-ibtn[disabled]");
    expect(await disabled.count()).toBeGreaterThanOrEqual(5);
    for (const button of await disabled.all()) {
      await page.mouse.move(0, 0);
      const before = await button.evaluate(look);
      await button.hover({ force: true });
      expect(await button.evaluate(look)).toEqual(before);
    }
  });
});
