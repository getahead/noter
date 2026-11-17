// M3 — People (docs/features/ui/people.md; DESIGN.md stories cpt-noter-seq-people-prepare-one-on-one,
// -people-name-unnamed-speaker, cpt-noter-seq-dialogs-set-up-voice-profile). Real-core flows written before the screens exist
// (tests first); copy is DESIGN's. The world fixture is smaller than DESIGN's: its one unnamed speaker is Speaker 3 in the
// planning call (read from people_list, not DESIGN's "Speaker 2 · 3 calls"), Anna K. has 1 call (not 31), Lena K. is the person
// without calls. Native surfaces (the NSAlert Delete Profile…) are XCUITest test_cpt_noter_seq_dialogs_set_up_voice_profile.
import type { Page } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import { alertText, alerts, answerAlerts, watchAlerts } from "./support/native-alert";

const button = (page: Page, name: string | RegExp) => page.getByRole("button", { name });
const table = (page: Page) => page.getByRole("table", { name: /People/ });
const personRow = (page: Page, name: string | RegExp) => table(page).getByRole("row", { name });

async function openPeople(page: Page, world: (w: World) => void = W.idle) {
  const steer = await openWindow(page, "main", { world });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit4");
    await expect(page.getByRole("heading", { name: "People", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  return steer;
}
const openPerson = async (page: Page, name: string | RegExp, world?: (w: World) => void) => {
  const steer = await openPeople(page, world);
  await personRow(page, name).click();
  await page.keyboard.press("Enter");
  return steer;
};
// The fake core cannot do these two (contract lane): its people_list errors on a world with no calls, and a rename to a new
// person adds no person. The real core is the arbiter of E2E coverage.
const fake = process.env.NOTER_CORE !== "stdio";
const noVoiceProfile = (w: World) => {
  W.idle(w);
  w.people.find((p) => p.id === "per_anna")!.voice_profile = false;
};

test.describe("cpt-noter-seq-people-prepare-one-on-one", () => {
  test("UI — happy path: Anna K.'s row opens Overview from one person_get with her commitments, what you owe and topics; ⌘[ comes back; Last calls opens the call", async ({ page }) => {
    await openPeople(page);
    await expect.poll(() => sent(page, "people_list")).toHaveLength(1);
    await personRow(page, /Anna K\./).click();
    await page.keyboard.press("Enter");
    await expect.poll(() => sent(page, "person_get")).toEqual([{ person_id: "per_anna" }]);
    await expect(page.getByRole("heading", { name: "Anna Kuznetsova" })).toBeVisible();
    await expect(page.getByText(/Open commitments · \d+/)).toBeVisible();
    await expect(page.getByText(/Asked you · \d+/)).toBeVisible();
    await expect(page.getByText("Drawer redesign spec by Friday")).toBeVisible();

    await page.getByRole("button", { name: /Drawer redesign/ }).first().click(); // Topics you keep returning to
    await expect.poll(() => sent(page, "topic_get")).toContainEqual(expect.objectContaining({ topic_id: "top_drawer" }));
    await page.keyboard.press("Meta+BracketLeft");
    await expect(page.getByRole("heading", { name: "Anna Kuznetsova" })).toBeVisible();
    await expect(page.getByText("Last calls")).toBeVisible();
    await page.getByRole("row", { name: /Planning: VHI 8\.0 drawer redesign/ }).click();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Planning: VHI 8.0 drawer redesign" })).toBeVisible();
  });

  test("UI — empty path: a person without calls shows No calls with Lena K. yet, and History shows No changes yet", async ({ page }) => {
    await openPerson(page, /Lena K\./);
    await expect(page.getByText("No calls with Lena K. yet")).toBeVisible();
    await expect(page.getByText("Their commitments, questions and topics appear after your first call together.")).toBeVisible();
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByText("No changes yet")).toBeVisible();
    await expect(page.getByText("Changes to Lena K.'s items, names and voice profile appear here, each with Undo.")).toBeVisible();
  });

  test("UI — empty path: no people shows No people yet and Add Person creates one with person_create", async ({ page }) => {
    test.skip(fake, "the fake core cannot serve this world; the real core runs it");
    await openPeople(page, (w) => {
      W.idle(w);
      // Before the first recorded call: the core refuses to drop a person a call, item or speaker still points at.
      w.people = w.people.filter((p) => p.is_you);
      w.calls = [];
      w.call_details = [];
      w.items = [];
      Object.assign(w.today, { today: [], this_week: [], live_call: null, due_without_call: [], done_today: [], review_calls: [], unnamed_speakers: 0 });
    });
    await expect(page.getByRole("region", { name: "People" }).getByText("No people yet")).toBeVisible();
    await expect(page.getByText("People appear when you record calls or add them.")).toBeVisible();
    await button(page, "Add Person").first().click();
    const form = page.getByRole("dialog", { name: "New person" });
    await expect(form.getByRole("textbox", { name: "Role" })).toBeDisabled();
    await form.getByRole("textbox", { name: "Name" }).fill("Anna K.");
    await form.getByRole("button", { name: "Create" }).click();
    await expect.poll(() => sent(page, "person_create")).toEqual([expect.objectContaining({ display_name: "Anna K." })]);
    await expect(personRow(page, /Anna K\./)).toBeVisible();
  });
});

test.describe("cpt-noter-seq-people-name-unnamed-speaker", () => {
  test("UI — happy path: Unnamed speakers lists Speaker 3, Name… shows the sample, Дима is not a person, Dmitri S. is clicked, the strip says Named Speaker 3 as Dmitri S. · N lines, the row is gone", async ({ page }) => {
    await openPeople(page);
    const unnamed = page.getByRole("region", { name: "Unnamed speakers" });
    await expect(unnamed).toContainText("Speaker 3");
    await unnamed.getByRole("button", { name: "Name…" }).click();
    const pop = page.getByRole("dialog", { name: "Name Speaker 3" });
    await expect(pop).toContainText("Names Speaker 3 in this call as one change you can undo.");
    await pop.getByRole("combobox", { name: "Name…" }).fill("Dmitri");
    await pop.getByRole("option", { name: /Dmitri Sokolov/ }).click();
    await expect.poll(() => sent(page, "transcript_rename_speaker")).toEqual([
      expect.objectContaining({ speaker_id: expect.stringMatching(/./), person: { type: "existing", person_id: "per_dmitri" } }),
    ]);
    await expect(page.getByText(/Named Speaker 3 as Dmitri S\. · \d+ lines?/)).toBeVisible();
    await expect(unnamed.getByText("Speaker 3")).toHaveCount(0);
  });

  test("UI — empty path: search Zoya shows No people match “Zoya”, Clear Search brings Speaker 3 back, New Person “Zoya”… creates and names it without a voice profile", async ({ page }) => {
    test.skip(fake, "the fake core cannot serve this world; the real core runs it");
    await openPeople(page);
    await page.getByRole("searchbox", { name: /Search/ }).fill("Zoya");
    await expect(page.getByText("No people match “Zoya”")).toBeVisible();
    await button(page, "Clear Search").click();
    const unnamed = page.getByRole("region", { name: "Unnamed speakers" });
    await unnamed.getByRole("button", { name: "Name…" }).click();
    const pop = page.getByRole("dialog", { name: "Name Speaker 3" });
    await pop.getByRole("combobox", { name: "Name…" }).fill("Zoya");
    await expect(pop).toContainText("No one called “Zoya”");
    await pop.getByRole("option", { name: "New Person “Zoya”…" }).click();
    await expect(page.getByRole("dialog", { name: "New person for Speaker 3" }).getByRole("textbox", { name: "Name" })).toHaveValue("Zoya");
    await button(page, "Create and Name").click();
    await expect.poll(() => sent(page, "transcript_rename_speaker")).toEqual([
      expect.objectContaining({ person: expect.objectContaining({ type: "new", display_name: "Zoya" }) }),
    ]);
    await expect(personRow(page, /Zoya/)).toBeVisible();
    await expect.poll(() => sent(page, "voice_profile_create")).toHaveLength(0);
  });

  test("UI — error path: Undo in the named person's History restores Speaker 3 under Unnamed speakers", async ({ page }) => {
    await openPeople(page);
    const unnamed = page.getByRole("region", { name: "Unnamed speakers" });
    await unnamed.getByRole("button", { name: "Name…" }).click();
    const pop = page.getByRole("dialog", { name: "Name Speaker 3" });
    await pop.getByRole("combobox", { name: "Name…" }).fill("Dmitri");
    await pop.getByRole("option", { name: /Dmitri Sokolov/ }).click();
    await expect(page.getByText(/Named Speaker 3 as Dmitri S\./)).toBeVisible();
    await personRow(page, /Dmitri S\./).click();
    await page.keyboard.press("Enter");
    await page.getByRole("tab", { name: "History" }).click();
    await expect(page.getByText(/Named Speaker 3/)).toBeVisible();
    await button(page, "Undo").first().click();
    await expect.poll(() => sent(page, "change_undo")).toHaveLength(1);
    await expect(page.getByText("Undone 1 change")).toBeVisible();
    await expect(button(page, "Redo")).toBeVisible();
    await page.keyboard.press("Meta+BracketLeft");
    await expect(page.getByRole("region", { name: "Unnamed speakers" })).toContainText("Speaker 3");
  });

  test("UI — other path: Edit Details… renames Pavel with Keep “Pavel Romanov” as an alias ticked, person_update carries the rev and the alias", async ({ page }) => {
    await openPerson(page, /Pavel/);
    await button(page, "More").click();
    await page.getByRole("menuitem", { name: "Edit Details…" }).click();
    const sheet = page.getByRole("dialog", { name: "Edit details" });
    for (const f of ["Name", "Also known as", "Email", "Role", "Organisation", "Notes"]) await expect(sheet.getByRole("textbox", { name: f })).toBeVisible();
    await sheet.getByRole("textbox", { name: "Name" }).fill("Pavel R.");
    await expect(sheet.getByRole("checkbox", { name: "Keep “Pavel Romanov” as an alias" })).toBeChecked();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect.poll(() => sent(page, "person_update")).toEqual([
      expect.objectContaining({ person_id: "per_pavel", rev: expect.any(Number), patch: expect.objectContaining({ display_name: "Pavel R.", aliases: ["Pavel Romanov"] }) }),
    ]);
    await expect(page.getByRole("heading", { name: "Pavel R." })).toBeVisible();
  });

  test("UI — other path: ⌘-click two entries, Merge 2 People… previews What moves and people_merge keeps the chosen one with Merged … · Undo", async ({ page }) => {
    await openPeople(page);
    await personRow(page, /Oleg M\./).click();
    await personRow(page, /Lena K\./).click({ modifiers: ["Meta"] });
    await personRow(page, /Lena K\./).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Merge 2 People…" }).click();
    const sheet = page.getByRole("dialog", { name: /^Merge .* with another entry$/ });
    await expect(sheet).toContainText(/What moves to /);
    await sheet.getByRole("button", { name: "Merge" }).click();
    await expect.poll(() => sent(page, "people_merge")).toEqual([{ source: expect.stringMatching(/^per_(oleg|lena)$/), target: expect.stringMatching(/^per_(oleg|lena)$/) }]);
    await expect(page.getByText(/Merged .* into .* · Undo|Merged .* into /)).toBeVisible();
    await button(page, "Undo").click();
    await expect.poll(() => sent(page, "change_undo")).toHaveLength(1);
  });

  test("UI — other path: Delete Person… asks with a native alert before person_delete, and a failure keeps the person", async ({ page }) => {
    await watchAlerts(page);
    const steer = await openPerson(page, /Oleg M\./);
    await steer.failNext("person_delete", "internal");
    await button(page, "More").click();
    await page.getByRole("menuitem", { name: "Delete Person…" }).click();
    expect(alertText((await alerts(page))[0])).toContain("Delete Oleg M.?");
    await expect.poll(() => sent(page, "person_delete")).toHaveLength(0); // Cancel is the default answer
    await answerAlerts(page, "confirm"); // the next request is answered Delete
    await button(page, "More").click();
    await page.getByRole("menuitem", { name: "Delete Person…" }).click();
    await expect.poll(async () => (await sent(page, "person_delete")).length).toBe(1);
    await expect(page.getByRole("heading", { name: "Oleg Morozov" })).toBeVisible();
    await expect(page.getByRole("alert")).toBeVisible();
  });
});

test.describe("cpt-noter-seq-dialogs-set-up-voice-profile", () => {
  test("UI — happy path: Set Up Voice Profile… explains, Create Profile calls voice_profile_create once and says Voice profile created for Anna K.", async ({ page }) => {
    await openPerson(page, /Anna K\./, noVoiceProfile);
    await button(page, "Set Up Voice Profile…").click();
    const sheet = page.getByRole("dialog", { name: "Set Up Voice Profile" });
    await expect(sheet).toContainText("Anna Kuznetsova");
    await expect(sheet).toContainText(/encrypted/i);
    await expect(sheet).toContainText(/Noter builds it from the lines already named as Anna K\. in \d+ calls?\./);
    await expect(sheet.getByRole("button", { name: "Cancel" })).toBeVisible();
    await sheet.getByRole("button", { name: "Create Profile" }).click();
    await expect.poll(() => sent(page, "voice_profile_create")).toEqual([expect.objectContaining({ person_id: "per_anna" })]);
    await expect(page.getByText("Voice profile created for Anna K.")).toBeVisible();
    await expect(button(page, "Set Up Voice Profile…")).toHaveCount(0);
  });

  test("UI — other path: Delete Profile… asks Delete Anna K.'s voice profile?; Cancel keeps it, Delete Profile calls voice_profile_delete and Set Up Voice Profile… comes back", async ({ page }) => {
    await watchAlerts(page);
    await openPerson(page, /Anna K\./);
    await button(page, "More").click();
    await page.getByRole("menuitem", { name: "Delete Profile…" }).click();
    const text = alertText((await alerts(page))[0]);
    expect(text).toContain("Delete Anna K.'s voice profile?");
    expect(text).toContain("Noter stops recognising this voice in new calls. Names already given in past calls stay.");
    await expect.poll(() => sent(page, "voice_profile_delete")).toHaveLength(0); // Cancel is the default answer
    await answerAlerts(page, "confirm");
    await button(page, "More").click();
    await page.getByRole("menuitem", { name: "Delete Profile…" }).click();
    await expect.poll(() => sent(page, "voice_profile_delete")).toEqual([expect.objectContaining({ person_id: "per_anna" })]);
    await expect(button(page, "Set Up Voice Profile…")).toBeVisible();
  });
});
