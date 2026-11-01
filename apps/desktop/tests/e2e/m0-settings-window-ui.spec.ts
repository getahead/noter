// M0 — Settings window › the window's own behaviour (docs/features/ui/settings.md, flow change-setting,
// DoD settings-window): a failed first read, keyboard use of the search results, a refused change and the
// card-key modifier set. The Hotkeys story paths are in m0-settings-hotkeys-ui.spec.ts.
import type { Page } from "@playwright/test";

import { calls, openWindow, type CorePlan } from "./support/app";
import { expect, test } from "./support/fixtures";

const panes = (page: Page) => page.getByRole("navigation", { name: "Settings panes" });
const pane = (page: Page) => page.locator('[data-region="ST-R2"]');
const sent = async (page: Page, name: string): Promise<unknown[]> => (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args);

test.describe("cpt-noter-flow-ui-settings-change-setting", () => {
  test("a failed first read shows a pane error with Try Again, and the pane comes back", async ({ page }) => {
    await openWindow(page, "settings", { fail: [{ cmd: "settings_get", code: "offline" }] });
    const banner = page.locator('[data-region="ST-R3"]');
    await expect(banner).toContainText("Couldn’t read your settings.");
    await banner.getByRole("button", { name: "Try Again" }).click();
    await expect(pane(page).getByText("Launch at login")).toBeVisible();
    await expect(banner).toHaveCount(0);
  });

  test("the search results are reachable by keyboard: ↓ from the field, Return opens the match", async ({ page }) => {
    await openWindow(page, "settings");
    await panes(page).getByPlaceholder("Search").fill("hotkeys");
    await page.keyboard.press("ArrowDown");
    await expect(panes(page).getByRole("listitem").filter({ hasText: "Hotkeys" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(pane(page).getByRole("heading", { name: "Hotkeys", exact: true })).toBeVisible();
  });

  test("the search results take a Tab stop from the field when the open pane is filtered out", async ({ page }) => {
    await openWindow(page, "settings");
    await panes(page).getByPlaceholder("Search").fill("hotkeys");
    await page.keyboard.press("Tab");
    await expect(panes(page).getByRole("listitem").filter({ hasText: "Hotkeys" })).toBeFocused();
  });

  test("a refused change shows under its row, the stored value stays, and a later save clears it", async ({ page }) => {
    const steer = await openWindow(page, "settings");
    const launch = pane(page).getByRole("switch", { name: "Launch at login" });
    const before = await launch.isChecked();
    await steer.failNext("settings_update", "conflict");
    await launch.click({ force: true });
    await expect(pane(page)).toContainText("Couldn’t save this change.");
    await expect(launch).toBeChecked({ checked: before });
    await launch.click({ force: true });
    await expect(launch).toBeChecked({ checked: !before });
    await expect(pane(page)).not.toContainText("Couldn’t save this change.");
  });

  test("the card-key modifier set is saved once, when the keys are released", async ({ page }) => {
    await openWindow(page, "settings");
    await panes(page).getByRole("listitem").filter({ hasText: "Hotkeys" }).click();
    await page.getByRole("button", { name: /^Pin a card: / }).click();
    await page.keyboard.down("Control");
    await page.keyboard.down("Alt");
    expect(await sent(page, "settings_update")).toHaveLength(0); // nothing is saved while the keys are down
    await page.keyboard.up("Alt");
    await page.keyboard.up("Control");
    await expect.poll(async () => (await sent(page, "settings_update")).length).toBe(1);
    expect((await sent(page, "settings_update"))[0]).toMatchObject({ section: { section: "copilot", value: { card_keys: { modifiers: { control: true, option: true, command: false } } } } });
  });

  test("Esc takes away the red hint of an invalid attempt and the old chord stays", async ({ page }) => {
    await openWindow(page, "settings");
    await panes(page).getByRole("listitem").filter({ hasText: "Hotkeys" }).click();
    const field = page.getByRole("button", { name: /^Mark moment: / });
    await field.click();
    await page.keyboard.press("KeyN");
    await expect(pane(page)).toContainText("Add Command, Option or Control");
    await page.keyboard.press("Escape");
    await expect(pane(page)).not.toContainText("Add Command, Option or Control");
    await expect(field).toContainText("⌃⌥⌘M");
  });

  test("modifiers held when the field loses focus are not saved later", async ({ page }) => {
    await openWindow(page, "settings");
    await panes(page).getByRole("listitem").filter({ hasText: "Hotkeys" }).click();
    await page.getByRole("button", { name: /^Pin a card: / }).click();
    await page.keyboard.down("Control");
    await page.getByRole("button", { name: /^Mark moment: / }).focus(); // focus leaves while Control is down
    await page.keyboard.up("Control");
    await page.getByRole("button", { name: /^Pin a card: / }).click();
    await page.keyboard.down("Alt");
    await page.keyboard.up("Alt");
    await expect.poll(async () => (await sent(page, "settings_update")).length).toBe(1);
    expect((await sent(page, "settings_update"))[0]).toMatchObject({ section: { value: { card_keys: { modifiers: { control: false, option: true, command: false } } } } });
  });
});

test.describe("cpt-noter-seq-settings-check-privacy", () => {
  test("Error — Screen Recording not allowed: the row says macOS won’t ask again and opens the Screen Recording pane", async ({ page }) => {
    const notAsked: CorePlan["world"] = (w) => {
      w.app.capture.phase = "idle";
      w.app.environment.permissions.forEach((p) => p.kind === "screen_recording" && (p.state = "not_asked"));
    };
    const steer = await openWindow(page, "settings", { world: notAsked });
    await panes(page).getByRole("listitem").filter({ hasText: "Privacy" }).first().click();
    await page.getByRole("button", { name: "Screen Share Test…" }).click();
    await page.getByRole("button", { name: "Run Capture Test" }).click();
    await steer.failNext("permission_request", "permission_denied");
    await page.getByRole("button", { name: "Continue" }).click();
    const sheet = page.getByRole("dialog", { name: "Screen Share Test" });
    await expect(sheet).toContainText("macOS won’t ask again.");
    await sheet.getByRole("button", { name: "Open System Settings…" }).click();
    await expect.poll(async () => sent(page, "open_external")).toContainEqual({ target: { type: "system_settings", permission: "screen_recording" } });
  });
});
