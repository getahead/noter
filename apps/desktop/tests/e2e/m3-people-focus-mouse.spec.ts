// M3 People — mouse paths of AC2 (docs/features/ui/people.md §6): WebKit does not focus a button on a click, so every
// surface below must hand focus back to the control that opened it (or its successor), and Cancel must work on the first click.
import type { Page } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";
import { alerts, answerAlerts, watchAlerts } from "./support/native-alert";

const button = (page: Page, name: string | RegExp) => page.getByRole("button", { name });
async function openPeople(page: Page, world: (w: World) => void = W.idle) {
  const steer = await openWindow(page, "main", { world });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit4");
    await expect(page.getByRole("heading", { name: "People", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  return steer;
}
const noVoiceProfile = (w: World) => {
  W.idle(w);
  w.people.find((p) => p.id === "per_anna")!.voice_profile = false;
};
const openAnna = async (page: Page) => {
  await openPeople(page, noVoiceProfile);
  await page.getByRole("table", { name: /People/ }).getByRole("row", { name: /Anna K\./ }).click();
  await page.keyboard.press("Enter");
  await expect(button(page, "Set Up Voice Profile…")).toBeVisible();
};

test.describe("cpt-noter-seq-people-name-unnamed-speaker — focus with the mouse", () => {
  test("UI — happy path: Cancel in a fresh New person form closes on the first click and focus goes back to Add Person", async ({ page }) => {
    await openPeople(page);
    await button(page, "Add Person").click();
    const form = page.getByRole("dialog", { name: "New person" });
    await expect(form).toBeVisible();
    await form.getByRole("button", { name: "Cancel" }).click(); // no typing: the name field's blur must not move the button first
    await expect(form).toHaveCount(0);
    await expect(button(page, "Add Person")).toBeFocused();
  });

  test("UI — other path: Esc on the Name Speaker popover returns focus to Name…, and naming moves it on once the row is gone", async ({ page }) => {
    await openPeople(page);
    const unnamed = page.getByRole("region", { name: "Unnamed speakers" });
    await unnamed.getByRole("button", { name: "Name…" }).click();
    const pop = page.getByRole("dialog", { name: "Name Speaker 3" });
    await expect(pop).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    await expect(unnamed.getByRole("button", { name: "Name…" })).toBeFocused();
    await unnamed.getByRole("button", { name: "Name…" }).click();
    await pop.getByRole("combobox", { name: "Name…" }).fill("Dmitri");
    await pop.getByRole("option", { name: /Dmitri Sokolov/ }).click();
    await expect(unnamed).toHaveCount(0); // the only unnamed speaker is named: no row is left to focus
    await expect(button(page, "Add Person")).toBeFocused();
  });
});

test.describe("cpt-noter-seq-dialogs-set-up-voice-profile — focus with the mouse", () => {
  test("UI — happy path: Esc and Cancel on the voice sheet return focus to Set Up Voice Profile…", async ({ page }) => {
    await openAnna(page);
    const sheet = page.getByRole("dialog", { name: "Set Up Voice Profile" });
    await button(page, "Set Up Voice Profile…").click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(button(page, "Set Up Voice Profile…")).toBeFocused();
    await button(page, "Set Up Voice Profile…").click();
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(button(page, "Set Up Voice Profile…")).toBeFocused();
  });

  test("UI — other path: Create Profile hands focus to Delete Profile…, and a confirmed Delete Profile hands it back to Set Up Voice Profile…", async ({ page }) => {
    await watchAlerts(page);
    await openAnna(page);
    await button(page, "Set Up Voice Profile…").click();
    await page.getByRole("dialog", { name: "Set Up Voice Profile" }).getByRole("button", { name: "Create Profile" }).click();
    await expect(button(page, "Delete Profile…")).toBeFocused();
    await answerAlerts(page, "confirm");
    await button(page, "Delete Profile…").click();
    await expect(button(page, "Set Up Voice Profile…")).toBeFocused();
  });

  test("UI — other path: Cancel on the Delete Profile alert, and a confirmed delete that fails, leave focus on Delete Profile…", async ({ page }) => {
    await watchAlerts(page);
    const steer = await openPeople(page);
    await page.getByRole("table", { name: /People/ }).getByRole("row", { name: /Anna K\./ }).click();
    await page.keyboard.press("Enter");
    await expect(button(page, "Delete Profile…")).toBeVisible();
    await button(page, "Delete Profile…").click(); // the alert answers Cancel
    await expect.poll(() => alerts(page)).toHaveLength(1);
    await expect(button(page, "Delete Profile…")).toBeFocused();
    await steer.failNext("voice_profile_delete", "internal");
    await answerAlerts(page, "confirm");
    await button(page, "Delete Profile…").click();
    await expect(page.getByText("Couldn’t delete the voice profile. It was not changed.")).toBeVisible();
    await expect(button(page, "Delete Profile…")).toBeFocused();
  });
});
