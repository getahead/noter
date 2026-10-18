// Keyboard pass of cpt-noter-flow-ui-accessibility-l10n-keyboard with real WebKit Tab events against
// the Tab navigation the app installs (main.tsx): controls that cannot take focus are skipped, never
// a trap, and an open sheet keeps focus inside although a closed dialog is retained after it.
import { expect, test, type Page } from "@playwright/test";

const fixture = (page: Page, html: string) =>
  page.evaluate((h) => {
    const d = document.createElement("div");
    d.innerHTML = h;
    document.body.append(d);
  }, html);
const focused = (page: Page) => page.evaluate(() => document.activeElement?.id ?? "");

test.beforeEach(async ({ page }) => {
  await page.goto("/?window=main");
  await page.waitForSelector('[data-region="window"][data-state="ready"]', { state: "attached" });
});

test("Tab skips controls that cannot take focus", async ({ page }) => {
  await fixture(
    page,
    `<button id="before">Before</button>
     <fieldset disabled><button id="in-fieldset">In a disabled fieldset</button></fieldset>
     <button id="invisible" style="visibility: hidden">Invisible</button>
     <div id="not-editable" contenteditable="false">Not editable</div>
     <button id="after">After</button>`,
  );
  await page.focus("#before");
  await page.keyboard.press("Tab");
  expect(await focused(page)).toBe("after");
  await page.keyboard.press("Shift+Tab");
  expect(await focused(page)).toBe("before");
});

test("an open sheet keeps Tab inside although a closed dialog is retained after it", async ({ page }) => {
  await fixture(
    page,
    `<button id="page">Page</button>
     <div role="dialog" aria-modal="true"><button id="one">One</button><button id="two">Two</button></div>
     <div role="dialog" aria-modal="true" hidden><button id="closed">Closed</button></div>`,
  );
  await page.focus("#two");
  await page.keyboard.press("Tab");
  expect(await focused(page)).toBe("one");
  await page.keyboard.press("Shift+Tab");
  expect(await focused(page)).toBe("two");
});
