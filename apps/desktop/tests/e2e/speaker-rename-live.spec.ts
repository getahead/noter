// Each observer stays on its original route. Steering invokes the same command another
// window sends against that page's core, without running the initiating UI's callbacks.
import { openWindow, type Steer } from "./support/app";
import { navigate, windowReady } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import * as W from "../support/world-presets";

const renameDmitri = (steer: Steer) => steer.invoke("person_update", {
  person_id: "per_dmitri", rev: 1, patch: { display_name: "Misha Smirnov" },
});

const nameSpeaker = (steer: Steer) => steer.invoke("transcript_rename_speaker", {
  call_id: W.LIVE_CALL, speaker_id: "spk_3", person: { type: "existing", person_id: "per_lena" }, scope: { type: "whole_call" },
}, "call-screen");

test("cpt-noter-seq-call-screen-name-speaker — Only this line updates the open stored transcript", async ({ page }) => {
  await openWindow(page, "main", { world: W.idle });
  await navigate(page, "transcript", W.PAST_CALL);
  const row = page.locator('[data-segment-id="seg_backend_001"]');
  await row.getByRole("button", { name: "Dmitri S." }).click();
  const pop = page.getByRole("dialog", { name: "Rename Dmitri S." });
  await pop.getByRole("radio", { name: "Only this line" }).check();
  await pop.getByRole("option", { name: /^Oleg/ }).first().click();
  await pop.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(row.getByRole("button", { name: "Oleg M." })).toBeVisible();
  await expect(page.getByText("Named Dmitri S. as Oleg M. · 1 line")).toBeVisible();
});

test("cpt-noter-seq-people-name-unnamed-speaker — editing a person's name updates the open call and stored transcript", async ({ page }) => {
  const steer = await openWindow(page, "main", { world: W.idle });
  await navigate(page, "transcript", W.PAST_CALL);
  const row = page.locator('[data-segment-id="seg_backend_001"]');
  const toolbar = page.locator('[data-region="PC-R1"]');
  await expect(row).toContainText("Dmitri S.");
  await expect(toolbar).toContainText("Dmitri S.");
  await renameDmitri(steer);
  await expect(row).toContainText("Misha S.");
  await expect(toolbar).toContainText("Misha S.");
});

test("cpt-noter-seq-call-page-name-speakers — naming on the call page updates the open live log", async ({ page }) => {
  const steer = await openWindow(page, "call-screen");
  const row = page.locator('[data-segment-id="seg_live_004"]');
  await expect(row).toContainText("Speaker 3");
  await steer.invoke("transcript_rename_speaker", {
    call_id: W.LIVE_CALL, speaker_id: "spk_3", person: { type: "existing", person_id: "per_lena" }, scope: { type: "whole_call" },
  }, "main");
  await expect(row).toContainText("Lena K.");
});

test("cpt-noter-seq-people-name-unnamed-speaker — naming from the transcript removes the open People row", async ({ page }) => {
  const steer = await openWindow(page, "main", { world: W.idle });
  await windowReady(page);
  await page.keyboard.press("Meta+Digit4");
  const unnamed = page.getByRole("region", { name: "Unnamed speakers" });
  await expect(unnamed).toContainText("Speaker 3");
  await nameSpeaker(steer);
  await expect(unnamed.getByText("Speaker 3", { exact: true })).toHaveCount(0);
});

test("cpt-noter-seq-people-name-unnamed-speaker — a first speaker assignment adds the call to the open Person page", async ({ page }) => {
  const steer = await openWindow(page, "main", { world: W.idle });
  await windowReady(page);
  await steer.invoke("window_navigate", { target: { type: "person", person_id: "per_lena" } });
  await expect(page.getByText("No calls with Lena K. yet")).toBeVisible();
  await nameSpeaker(steer);
  await expect(page.locator('[data-region="PE-R6"]')).toContainText("Planning: VHI 8.0 drawer redesign");
});

test("cpt-noter-seq-people-name-unnamed-speaker — editing a person's name updates the owner in open search results", async ({ page }) => {
  const steer = await openWindow(page, "main", { world: W.idle });
  await windowReady(page);
  await page.keyboard.press("Meta+Digit3");
  const field = page.getByRole("searchbox", { name: /Search/ });
  await field.fill("websocket");
  await field.press("Enter");
  const item = page.locator('[data-region="LS-R1"] [data-item-id="itm_replay"]');
  await expect(item).toContainText("Dmitri S.");
  const result = page.locator('[data-region="LS-R1"] li.lb-hit:has([data-item-id="itm_replay"])');
  await result.focus();
  await renameDmitri(steer);
  await expect(item).toContainText("Misha S.");
  await expect(result).toBeFocused();
});
