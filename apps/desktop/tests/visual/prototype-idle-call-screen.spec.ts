import { expect, test, type Page } from "@playwright/test";

const prototype = new URL("../../../../docs/prototype/clickable/noter-prototype.html", import.meta.url);
const callWindow = '[data-component="cpt-noter-component-shell-call-window"]';

async function choose(page: Page, menu: "State" | "Capture", item: string) {
  await page.getByRole("button", { name: new RegExp(`^${menu}:`) }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
}

for (const layout of ["dedicated", "floating"]) {
  test(`cpt-noter-seq-floating-panel-hide-and-reopen — the prototype opens, closes and starts the ${layout} idle Call Screen`, async ({ page }) => {
    await page.goto(prototype.href + "#menubar");
    const openCall = page.getByRole("menuitem", { name: /Open Call Screen/ });
    await expect(openCall).toBeVisible();
    await openCall.click();
    if (layout === "floating") await page.getByRole("button", { name: "Floating panel", exact: true }).click();
    const panel = page.locator(callWindow);
    const heading = panel.getByRole("heading", { name: "Not recording" });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveCSS("font-size", "22px");
    await expect(heading).toHaveCSS("line-height", "28px");
    await expect(panel.getByRole("button")).toHaveText(["Close", "Start Recording"]);
    await expect(panel.getByRole("button", { name: "Start Recording" })).toHaveAttribute("data-variant", "primary");
    await expect(panel).toHaveAttribute("data-variant", layout);
    await expect(page.getByRole("button", { name: /^Capture: Idle/ })).toBeVisible();

    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await page.getByRole("navigation", { name: "Surfaces" }).getByRole("button", { name: "Menu bar" }).click();
    await openCall.click();
    await expect(heading).toBeVisible();
    await choose(page, "Capture", "Self-test not passed (call detection off)");
    const micOff = layout === "floating";
    await choose(page, "Capture", micOff ? "Microphone access off (Record still works)" : "System audio access off (Record still works)");
    await panel.getByRole("button", { name: "Start Recording" }).click();
    await expect(page.getByRole("button", { name: /^Capture: Recording/ })).toBeVisible();
    await expect(heading).toHaveCount(0);
    await expect(panel).toHaveAttribute("data-variant", layout);
    await expect(panel.getByText(micOff ? /Microphone off/ : /System audio silent/).first()).toBeVisible();

    await choose(page, "State", "Not recording");
    await expect(heading).toBeVisible();
    await expect(page.getByRole("button", { name: /^Capture: Idle/ })).toBeVisible();
  });
}

for (const [state, reason, pane] of [
  ["Not recording · speech model missing", /until the speech model is downloaded/, "Models & Runtimes"],
  ["Not recording · less than 500 MB free", /less than 500 MB of disk space is free/, "Maintenance"],
] as const) {
  test(`cpt-noter-seq-floating-panel-hide-and-reopen — the prototype links a blocked start to ${pane}`, async ({ page }) => {
    await page.goto(prototype.href + "#call");
    await choose(page, "State", state);
    const panel = page.locator(callWindow);
    await expect(panel.getByRole("button", { name: "Start Recording" })).toBeDisabled();
    await expect(panel.getByText(reason)).toBeVisible();
    await page.keyboard.press("Control+Alt+Meta+r");
    await panel.getByRole("link", { name: pane }).click();
    await expect(page.getByRole("heading", { name: pane, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Capture: Idle/ })).toBeVisible();
  });
}
