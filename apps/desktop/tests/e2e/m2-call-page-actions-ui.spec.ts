// M2 — Call info tags and stored audio on the call page (docs/features/ui/call-page-outputs.md › Maintain tags and stored
// audio), stories of cpt-noter-seq-call-page-share-outputs: tags with the undo strip, Delete Audio Now… (the native
// alert, Cancel by default) and Delete Old Audio… (the sheet opened by the core's `nav:request`). Fake and real core.
import type { Page } from "@playwright/test";

import { openSummary, sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import { alerts, alertText, answerAlerts, watchAlerts } from "./support/native-alert";
import * as O from "./support/outputs-world";

const toolbar = (page: Page) => page.locator('[data-region="PC-R1"]');

test.describe("cpt-noter-seq-call-page-share-outputs", () => {
  test("UI — other path: Tags — Return adds, the strip offers Undo, a duplicate is refused inline, × removes", async ({ page }) => {
    const { call } = await O.openOutputs(page, "written");
    await openSummary(page, call);
    const field = page.getByLabel("Add a tag");
    await field.fill("release");
    await field.press("Enter");
    await expect(page.getByRole("button", { name: "Remove tag release" })).toBeVisible();
    expect(await sent(page, "call_tags_set")).toEqual([{ call_ids: [call], add: ["release"], remove: [] }]);
    await expect(page.getByText("Added “release”")).toBeVisible();
    await field.fill("RELEASE");
    await field.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "This call has that tag already" })).toBeVisible();
    expect(await sent(page, "call_tags_set")).toHaveLength(1); // validated in the page, no command
    await page.getByRole("button", { name: "Remove tag release" }).click();
    await expect(page.getByRole("button", { name: "Remove tag release" })).toHaveCount(0);
    expect((await sent(page, "tags_list")).length).toBeGreaterThan(0);
  });

  test("UI — other path: Delete Audio Now… — the alert asks, Cancel sends nothing, Delete Audio deletes only the audio", async ({ page }) => {
    await watchAlerts(page);
    const { call } = await O.openOutputs(page, "written");
    await openSummary(page, call);
    await toolbar(page).getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete Audio Now…" }).click();
    await expect.poll(async () => (await alerts(page)).length).toBe(1);
    expect(alertText((await alerts(page))[0]!)).toContain("Delete the audio of this call?");
    expect(await sent(page, "audio_delete")).toEqual([]); // Cancel is the default answer

    await answerAlerts(page, "confirm");
    await toolbar(page).getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete Audio Now…" }).click();
    await expect.poll(async () => (await sent(page, "audio_delete")).length).toBe(1);
    expect(await sent(page, "audio_delete")).toEqual([{ call_ids: [call] }]);
    await toolbar(page).getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete Audio Now…" })).toHaveCount(0); // the audio is gone
  });

  test("UI — other path: Delete Old Audio… — the sheet, Recording goes on, 30 days, Freed … MB across … calls from the result", async ({ page }) => {
    const { call } = await O.openOutputs(page, "written");
    await openSummary(page, call);
    await page.evaluate(async () => {
      // what the capture/disk warning's button asks of the core
      const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
      const args = { target: { type: "delete_old_audio" } };
      await (g.__noterFake ? g.__noterFake.invoke("window_navigate", args) : g.__TAURI_INTERNALS__!.invoke("window_navigate", { args }));
    });
    const sheet = page.getByRole("dialog", { name: /Delete Old Audio/ });
    await expect(sheet).toContainText("Recording goes on while this runs.");
    await sheet.getByRole("button", { name: "Delete Audio" }).click();
    expect(await sent(page, "audio_delete_older")).toEqual([{ older_than_days: 30 }]);
    await expect(page.getByText(/Freed \d+ MB across \d+ calls?/)).toBeVisible();
    await expect(sheet).toHaveCount(0);
  });
});
