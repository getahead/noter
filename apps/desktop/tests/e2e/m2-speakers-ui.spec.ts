// M2 — Speaker naming (docs/features/ui/speakers.md, DESIGN.md Call screen CS-R2 speaker label + rename popover, Call page
// PC-R9 speaker naming panel, Person picker). Real-core stories of cpt-noter-seq-call-screen-name-speaker (every path); the page story (S2) follows with its panel. The call window's typing focus (the non-activating panel becoming key for
// the popover field) is native: XCUITest test_cpt_noter_seq_call_screen_name_speaker; the webview parts are here. Written before
// the screens exist (tests first). Assumptions: the real core's unnamed speaker has one line, so counts are read from the core's
// speaker rows, not DESIGN's 12/14; the person to pick is Pavel (a participant of the fixture call); `people_list` is M3
// (not_implemented), so Recent people is not asserted. Copy and labels are DESIGN's, never adjusted to the markup.
import type { Page } from "@playwright/test";

import { openWindow } from "./support/app";
import { openSummary } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import { sent } from "./support/call-page";
import * as S from "./support/speakers-world";
import * as W from "../support/world-presets";

const live = (page: Page, world: (w: Parameters<typeof W.idle>[0]) => void = () => {}) => openWindow(page, "call-screen", { world });
const transcript = (page: Page) => page.locator('[data-region="CS-R2"], [data-region="FP-R5"]');
const strip = (page: Page) => page.locator('[data-region="CS-R5"], [data-region="FP-R6"]');
const popover = (page: Page, name: string | RegExp) => page.getByRole("dialog", { name });
const panel = (page: Page) => page.locator('[data-region="PC-R9"]');
const rowOf = (page: Page, label: string) => panel(page).getByRole("group", { name: label });
const LINES = /\d+ lines?/;

test.describe("cpt-noter-seq-call-screen-name-speaker", () => {
  test("UI — happy path: click Speaker 3, Rename Speaker 3 with Name…, In this call and Whole call, ↓ + Return renames every line, the strip says Named Speaker 3 as Pavel · N lines, Esc closes", async ({ page }) => {
    await live(page);
    await transcript(page).getByRole("button", { name: "Speaker 3" }).first().click();
    const rename = popover(page, "Rename Speaker 3");
    await expect(rename.getByRole("combobox", { name: "Name…" })).toBeFocused();
    await expect(rename).toContainText("In this call");
    await expect(rename.getByRole("radio", { name: "Whole call" })).toBeChecked();

    await page.keyboard.press("ArrowDown");
    await expect(rename.getByRole("option", { selected: true })).toContainText(/Pavel|Anna|Dmitri/);
    await rename.getByRole("option", { name: /^Pavel/ }).click();
    await rename.getByRole("button", { name: "Rename" }).click();

    expect(await sent(page, "transcript_rename_speaker")).toEqual([
      expect.objectContaining({ call_id: S.CALL, speaker_id: "spk_3", scope: { type: "whole_call" }, person: expect.objectContaining({ type: "existing" }) }),
    ]);
    await expect(strip(page)).toContainText(new RegExp(`Named Speaker 3 as Pavel[^·]* · ${LINES.source}`));
    await expect(transcript(page).getByText("Speaker 3")).toHaveCount(0); // every line of the call carries the name
    await page.keyboard.press("Escape");
    await expect(rename).toHaveCount(0);
  });

  test("UI — happy path: Return picks the highlighted person and renames without the mouse", async ({ page }) => {
    await live(page);
    await transcript(page).getByRole("button", { name: "Speaker 3" }).first().click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await sent(page, "transcript_rename_speaker")).length).toBe(1);
  });

  test("UI — empty path: No matching person — Zoya shows No one called “Zoya” and New Person “Zoya”…, the form has Name, Email, Role, Create and Name says You added Zoya and named Speaker 3 as Zoya", async ({ page }) => {
    await live(page);
    await transcript(page).getByRole("button", { name: "Speaker 3" }).first().click();
    const rename = popover(page, "Rename Speaker 3");
    await rename.getByRole("combobox", { name: "Name…" }).fill("Zoya");
    await expect(rename).toContainText("No one called “Zoya”");
    await expect(rename.getByRole("option", { name: "New Person “Zoya”…" })).toBeVisible();
    await page.keyboard.press("Enter"); // on New Person “Zoya”…
    for (const field of ["Name", "Email", "Role"]) await expect(rename.getByRole("textbox", { name: field })).toBeVisible();
    await expect(rename.getByRole("textbox", { name: "Name" })).toHaveValue("Zoya");
    await rename.getByRole("textbox", { name: "Email" }).fill("zoya@example.com");
    await rename.getByRole("button", { name: "Create and Name" }).click();

    expect(await sent(page, "transcript_rename_speaker")).toEqual([
      expect.objectContaining({ speaker_id: "spk_3", person: { type: "new", display_name: "Zoya", email: "zoya@example.com" } }),
    ]);
    await expect(strip(page)).toContainText(new RegExp(`You added Zoya and named Speaker 3 as Zoya · ${LINES.source}`));
    await expect(transcript(page).getByText("Speaker 3")).toHaveCount(0);
  });

  test("UI — error path: a failed rename keeps the draft and the focus, shows the error and retries only on Rename", async ({ page }) => {
    const steer = await live(page);
    await transcript(page).getByRole("button", { name: "Speaker 3" }).first().click();
    const rename = popover(page, "Rename Speaker 3");
    await rename.getByRole("combobox", { name: "Name…" }).fill("Pavel");
    await rename.getByRole("option", { name: /^Pavel/ }).click();
    await steer.failNext("transcript_rename_speaker", "not_found");
    await rename.getByRole("button", { name: "Rename" }).click();
    await expect(rename.getByRole("alert")).toBeVisible();
    await expect(rename.getByRole("combobox", { name: "Name…" })).toHaveValue(/Pavel/);
    expect(await sent(page, "transcript_rename_speaker")).toHaveLength(1); // no retry on its own
    await rename.getByRole("button", { name: "Rename" }).click();
    await expect.poll(async () => (await sent(page, "transcript_rename_speaker")).length).toBe(2);
  });

  test("UI — other path: Only this line renames that line and leaves the speaker's others as Speaker 3", async ({ page }) => {
    await live(page);
    await transcript(page).getByRole("button", { name: "Speaker 3" }).first().click();
    const rename = popover(page, "Rename Speaker 3");
    await rename.getByRole("radio", { name: "Only this line" }).check();
    await rename.getByRole("option", { name: /^Pavel/ }).click();
    await rename.getByRole("button", { name: "Rename" }).click();
    expect(await sent(page, "transcript_rename_speaker")).toEqual([expect.objectContaining({ scope: expect.objectContaining({ type: "one_segment" }) })]);
  });
});
