// M0 — Settings window › Hotkeys (docs/features/ui/settings.md, DESIGN.md › Screen — Settings, ST-R1..R3).
// The UI half of `cpt-noter-seq-settings-set-hotkeys`: m0-settings-hotkeys.spec.ts proves each
// path at the contract; these drive the Settings window over the selected core (support/app.ts).
// Written before the window exists (tests first): they fail until the settings feature lands,
// and the feature's PR carries them. Markup follows the prototype (`surface('settings')`): the
// pane list is the navigation "Settings panes", each chord field is a button labelled
// "<row>: <chord>. Click to record a new shortcut", the pane is `data-region="ST-R2"`.
// The new chord beside Catch Me Up in the menu bar and on the call screen is checked by the
// native suite (`test_cpt_noter_seq_settings_set_hotkeys__new_chord_fires`) and the M1 windows.
import type { Page } from "@playwright/test";

import type { CoreError } from "../../src/core/bindings";
import { calls, openWindow, type Steer } from "./support/app";
import { expect, test } from "./support/fixtures";

// D-2: the search word must match no pane keyword; align with the word DESIGN.md picks.
const NO_MATCH = "xylophone";

const panes = (page: Page) => page.getByRole("navigation", { name: "Settings panes" });
const pane = (page: Page) => page.locator('[data-region="ST-R2"]');
const field = (page: Page, row: string) => pane(page).getByRole("button", { name: new RegExp(`^${row}: `) });
const sent = async (page: Page, name: string): Promise<unknown[]> =>
  (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args);

async function openHotkeys(page: Page): Promise<void> {
  await panes(page).getByRole("listitem").filter({ hasText: "Hotkeys" }).click();
  await expect(pane(page).getByRole("heading", { name: "Hotkeys" })).toBeVisible();
}

test.describe("cpt-noter-seq-settings-set-hotkeys", () => {
  test("UI — happy path: the Catch me up field reads Type a shortcut…, ⌃⌥⌘U is pressed and shown in the row", async ({ page }) => {
    await openWindow(page, "settings");
    await openHotkeys(page);
    expect(await sent(page, "hotkeys_list")).toHaveLength(1); // the core test-registers the set when the pane opens

    await expect(field(page, "Catch me up")).toContainText("⌃⌥⌘C");
    await field(page, "Catch me up").click();
    await expect(field(page, "Catch me up")).toContainText("Type a shortcut…");
    await expect(field(page, "Catch me up")).toBeFocused();
    await page.keyboard.press("Control+Alt+Meta+KeyU");

    expect(await sent(page, "hotkey_set")).toContainEqual({ action: "catch_me_up", shortcut: "Ctrl+Alt+Super+U" });
    await expect(field(page, "Catch me up")).toContainText("⌃⌥⌘U");
    await expect(pane(page)).not.toContainText("Type a shortcut…");
  });

  test("UI — error path: Shortcut used by VoiceOver — Used by VoiceOver under the row, another chord clears it", async ({ page }) => {
    const steer = await openWindow(page, "settings");
    await openHotkeys(page);
    await steer.failNext("hotkey_set", "hotkey_reserved", { type: "hotkey_owner", owner: "VoiceOver" }); // VoiceOver is running

    await field(page, "Mark moment").click();
    await page.keyboard.press("Control+Alt+Meta+KeyH");
    await expect(pane(page)).toContainText("Used by VoiceOver");
    await expect(field(page, "Mark moment")).toContainText("⌃⌥⌘M"); // the old chord stays

    await field(page, "Mark moment").click();
    await page.keyboard.press("Control+Alt+Meta+KeyJ");
    await expect(field(page, "Mark moment")).toContainText("⌃⌥⌘J");
    await expect(pane(page)).not.toContainText("Used by VoiceOver");
  });

  test("UI — error path: Card key used by another app — the warning under Pin a card, gone when Hotkeys is reopened", async ({ page }) => {
    let steer: Steer;
    try {
      steer = await openWindow(page, "settings", { world: (w) => (w.copilot.card_keys.conflicts = ["Ctrl+Alt+Super+3"]) });
    } catch (e) {
      if ((e as CoreError | null)?.code === "not_implemented") return; // card keys are the copilot's (M4); changeAhead's rule after D-4
      throw e;
    }
    await openHotkeys(page);
    await expect(pane(page)).toContainText(/Card key\s*⌃⌥⌘3\s*is used by another app/);

    await steer.change((w) => (w.copilot.card_keys.conflicts = [])); // a different shortcut chosen in Raycast
    await panes(page).getByRole("listitem").filter({ hasText: "General" }).click();
    await openHotkeys(page);
    await expect(pane(page)).not.toContainText("is used by another app");
  });

  test("UI — error path: Shortcut without a modifier — Add Command, Option or Control, the old chord stays, then ⌃⌥⌘O", async ({ page }) => {
    await openWindow(page, "settings");
    await openHotkeys(page);

    await field(page, "Open call screen").click();
    await page.keyboard.press("KeyN");
    await expect(pane(page)).toContainText("Add Command, Option or Control");
    await expect(field(page, "Open call screen")).toContainText("⌃⌥⌘N");
    expect(await sent(page, "hotkey_set")).not.toContainEqual({ action: "open_call_screen", shortcut: "N" }); // refused locally

    await field(page, "Open call screen").click();
    await page.keyboard.press("Control+Alt+Meta+KeyO");
    await expect(field(page, "Open call screen")).toContainText("⌃⌥⌘O");
    await expect(pane(page)).not.toContainText("Add Command, Option or Control");
  });

  test("UI — empty path: No setting matches the search — the empty state, × brings the panes back, Restore Defaults", async ({ page }) => {
    await openWindow(page, "settings");
    const search = panes(page).getByPlaceholder("Search");

    await search.fill(NO_MATCH);
    await expect(panes(page)).toContainText(`No settings match “${NO_MATCH}”`);
    await expect(panes(page).getByRole("listitem")).toHaveCount(0);
    await search.fill(""); // ×
    await expect(panes(page).getByRole("listitem").filter({ hasText: "Hotkeys" })).toBeVisible();

    await openHotkeys(page);
    await field(page, "Pause or resume").click();
    await page.keyboard.press("Control+Alt+Meta+KeyY");
    await expect(field(page, "Pause or resume")).toContainText("⌃⌥⌘Y");
    await pane(page).getByRole("button", { name: "Restore Defaults" }).click();
    expect(await sent(page, "hotkeys_reset")).toHaveLength(1);
    await expect(field(page, "Pause or resume")).toContainText("⌃⌥⌘P");
  });

  test("UI — keyboard only: ↓ to Hotkeys, Return on a chord field records, Esc cancels with the old chord and focus kept", async ({ page }) => {
    await openWindow(page, "settings");
    const hotkeys = panes(page).getByRole("listitem").filter({ hasText: "Hotkeys" });
    await panes(page).getByRole("listitem").first().focus();
    for (let i = 0; i < 12 && !(await hotkeys.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("ArrowDown");
    await expect(hotkeys).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(pane(page).getByRole("heading", { name: "Hotkeys" })).toBeVisible();

    await field(page, "Catch me up").focus();
    await page.keyboard.press("Enter");
    await expect(field(page, "Catch me up")).toContainText("Type a shortcut…");
    await page.keyboard.press("Escape");
    await expect(field(page, "Catch me up")).toContainText("⌃⌥⌘C");
    await expect(field(page, "Catch me up")).toBeFocused();
    expect(await sent(page, "hotkey_set")).toHaveLength(0);
  });
});
