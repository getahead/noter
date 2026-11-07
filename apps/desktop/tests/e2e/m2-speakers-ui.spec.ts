// M2 — Speaker naming (docs/features/ui/speakers.md, DESIGN.md Call screen CS-R2 speaker label + rename popover, Call page
// PC-R9 speaker naming panel, Person picker). Real-core stories of cpt-noter-seq-call-screen-name-speaker (every path); the page story (S2) follows with its panel. The call window's typing focus (the non-activating panel becoming key for
// the popover field) is native: XCUITest test_cpt_noter_seq_call_screen_name_speaker; the webview parts are here. Written before
// the screens exist (tests first). Assumptions: the real core's unnamed speaker has one line, so counts are read from the core's
// speaker rows, not DESIGN's 12/14; the person to pick is Pavel (a participant of the fixture call; the real core offers no invite chip for it); `people_list` is M3
// (not_implemented), so Recent people is not asserted. Copy and labels are DESIGN's, never adjusted to the markup.
import type { Locator, Page } from "@playwright/test";

import { openWindow } from "./support/app";
import { navigate } from "./support/call-page";
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
    const focusRequests = (await sent(page, "window_show_call")).length;
    await transcript(page).getByRole("button", { name: "Speaker 3" }).first().click();
    const rename = popover(page, "Rename Speaker 3");
    await expect(rename.getByRole("combobox", { name: "Name…" })).toBeFocused();
    expect(await sent(page, "window_show_call")).toHaveLength(focusRequests + 1);
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

test.describe("cpt-noter-seq-call-page-name-speakers", () => {
  const pick = async (row: Locator, q = "Pav") => {
    await row.getByRole("combobox", { name: "Name…" }).fill(q);
    await row.getByRole("option", { name: /^Pavel/ }).click();
  };
  const open = async (page: Page, world: (w: Parameters<typeof W.idle>[0]) => void = (w) => S.unnamed(w, 2)) => {
    const steer = await openWindow(page, "main", { world });
    await navigate(page, "transcript", S.CALL);
    await expect(page.locator('[data-region="PC-R5"]')).toBeVisible();
    return steer;
  };

  test("UI — happy path: Name speakers · 3 not named, Play Sample shows Playing…, typing Pav and picking Pavel fills Name…, Name says Named Speaker 3 as … · N lines with Undo", async ({ page }) => {
    await open(page);
    await expect(panel(page)).toContainText("Name speakers · 3 not named");
    const row = rowOf(page, "Speaker 3");
    await expect(row).toContainText(LINES);
    await row.getByRole("button", { name: "Play Sample" }).click();
    expect(await sent(page, "audio_play")).toEqual([expect.objectContaining({ call_id: S.CALL })]);
    await expect(row).toContainText("Playing…");

    await pick(row);
    await expect(row.getByRole("combobox", { name: "Name…" })).toHaveValue(/Pavel/);
    await row.getByRole("button", { name: "Name", exact: true }).click();
    expect(await sent(page, "transcript_name_speakers")).toEqual([
      expect.objectContaining({ call_id: S.CALL, assignments: [expect.objectContaining({ speaker_id: "spk_3", person: expect.objectContaining({ type: "existing" }) })] }),
    ]);
    await expect(page.getByText(new RegExp(`Named Speaker 3 as Pavel[^·]* · ${LINES.source}`))).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(panel(page)).toContainText("Name speakers · 2 not named");
  });

  test("UI — happy path: naming the last speaker says All speakers named · Undo, and Undo restores the row", async ({ page }) => {
    await open(page, () => {});
    await pick(rowOf(page, "Speaker 3"));
    await rowOf(page, "Speaker 3").getByRole("button", { name: "Name", exact: true }).click();
    await expect(panel(page)).toContainText("All speakers named");
    await page.getByRole("button", { name: "Undo" }).click();
    expect((await sent(page, "change_undo")).length).toBe(1);
    await expect(panel(page)).toContainText("Name speakers · 1 not named");
  });

  test("UI — empty path: Speaker skipped — Skip moves the row into Skipped (1), the count drops, Speaker 4 stays the label", async ({ page }) => {
    await open(page);
    await rowOf(page, "Speaker 4").getByRole("button", { name: "Skip" }).click();
    expect(await sent(page, "transcript_name_speakers")).toEqual([
      expect.objectContaining({ assignments: [expect.objectContaining({ speaker_id: "spk_4", person: null })] }),
    ]);
    await expect(panel(page)).toContainText("Skipped (1)");
    await expect(panel(page)).toContainText("Name speakers · 2 not named");
    await expect(rowOf(page, "Speaker 4")).toHaveCount(0);
  });

  test("UI — empty path: Audio no longer kept — no Play Sample, the first line and the count stay, typing and Name name the speaker from the text", async ({ page }) => {
    await open(page, (w) => (S.unnamed(w, 1), S.audioGone(w)));
    await expect(panel(page)).toContainText("Name speakers · 2 not named");
    await expect(panel(page).getByRole("button", { name: "Play Sample" })).toHaveCount(0);
    await expect(rowOf(page, "Speaker 3")).toContainText(LINES);
    await pick(rowOf(page, "Speaker 3"));
    await rowOf(page, "Speaker 3").getByRole("button", { name: "Name", exact: true }).click();
    expect(await sent(page, "audio_play")).toEqual([]);
    expect((await sent(page, "transcript_name_speakers")).length).toBe(1);
  });

  test("UI — other path: Name a skipped speaker later — Skipped (1) › Name… brings Speaker 4 back, typing opens the matches, Name says Named Speaker 4 as Pavel", async ({ page }) => {
    await open(page);
    await rowOf(page, "Speaker 4").getByRole("button", { name: "Skip" }).click();
    await panel(page).getByRole("button", { name: /Skipped \(1\)/ }).click();
    await panel(page).getByRole("button", { name: "Name…" }).click();
    const row = rowOf(page, "Speaker 4");
    await expect(row).toBeVisible();
    await pick(row);
    await row.getByRole("button", { name: "Name", exact: true }).click();
    await expect(page.getByText(new RegExp(`Named Speaker 4 as Pavel[^·]* · ${LINES.source}`))).toBeVisible();
  });

  test("UI — other path: Hide ▴ leaves 3 speakers not named · Show, Show brings the panel back", async ({ page }) => {
    await open(page);
    await panel(page).getByRole("button", { name: "Hide ▴" }).click();
    await expect(panel(page)).toContainText("3 speakers not named");
    await expect(panel(page).getByRole("button", { name: "Show" })).toBeVisible();
    await panel(page).getByRole("button", { name: "Show" }).click();
    await expect(panel(page)).toContainText("Name speakers · 3 not named");
  });

  test("UI — error path: a failed Name keeps the row with its chosen person and offers a retry", async ({ page }) => {
    const steer = await open(page);
    const row = rowOf(page, "Speaker 3");
    await pick(row);
    await steer.failNext("transcript_name_speakers", "not_found");
    await row.getByRole("button", { name: "Name", exact: true }).click();
    await expect(row.getByRole("alert")).toBeVisible();
    await expect(row.getByRole("combobox", { name: "Name…" })).toHaveValue(/Pavel/);
    expect(await sent(page, "transcript_name_speakers")).toHaveLength(1);
    await row.getByRole("button", { name: "Name", exact: true }).click();
    await expect.poll(async () => (await sent(page, "transcript_name_speakers")).length).toBe(2);
  });
});


test("cpt-noter-seq-call-page-name-speakers — selected text menu offers Copy and keyboard Fix Term", async ({ page }) => {
  await openWindow(page, "main");
  await navigate(page, "transcript", S.CALL);
  const line = page.locator('[data-region="PC-R5"] .cw-seg').filter({ has: page.locator('.cw-seg__text') }).first();
  const text = line.locator('.cw-seg__text');
  await text.dblclick();
  const selected = await page.evaluate(() => getSelection()?.toString());
  expect(selected).toBeTruthy();
  await text.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Fix Term…" });
  await expect(menu.getByRole("menuitem", { name: "Copy", exact: true })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Fix Term…", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Fix term", exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { document.body.dataset.copied = text; } } });
  });
  await menu.getByRole("menuitem", { name: "Copy", exact: true }).click();
  await expect(menu).toHaveCount(0);
  expect(await page.locator("body").getAttribute("data-copied")).toBe(selected);
  await line.focus();
  await text.dblclick();
  await line.focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Fix Term…", exact: true }).click();
  const fix = page.getByRole("dialog", { name: "Fix term", exact: true });
  await expect(fix).toBeVisible();
  await expect(fix).toContainText(selected!);
  await expect(fix.getByRole("combobox", { name: "Language", exact: true })).toBeDisabled();
  await expect(fix.getByRole("textbox", { name: "Correct term" })).toHaveValue(selected!);
  await fix.getByRole("textbox", { name: "Correct term" }).fill("");
  await expect(fix.getByRole("button", { name: "Fix", exact: true })).toBeDisabled();
  await fix.getByRole("textbox", { name: "Correct term" }).fill("corrected");
  await fix.getByRole("button", { name: "Fix", exact: true }).click();
  await expect(fix).toHaveCount(0);
  await expect(text).toContainText("corrected");
  expect(await sent(page, "transcript_fix_term")).toEqual([expect.objectContaining({ replacement: "corrected" })]);
});

test("cpt-noter-seq-call-page-name-speakers — the native Edit menu's Fix Term… follows the selected words", async ({ page }) => {
  await openWindow(page, "main");
  await navigate(page, "transcript", S.CALL);
  const text = page.locator('[data-region="PC-R5"] .cw-seg .cw-seg__text').first();
  const lastEnabled = async () => (await sent(page, "window_set_fix_term_enabled")).at(-1);
  await text.dblclick();
  await expect.poll(lastEnabled).toEqual({ enabled: true });
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await expect.poll(lastEnabled).toEqual({ enabled: false });
});

test("cpt-noter-seq-call-page-name-speakers — stale Fix Term refreshes the span and requires reselection", async ({ page }) => {
  const steer = await openWindow(page, "main");
  await navigate(page, "transcript", S.CALL);
  const text = page.locator('[data-region="PC-R5"] .cw-seg__text').first();
  await text.dblclick();
  await text.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Fix Term…", exact: true }).click();
  const fix = page.getByRole("dialog", { name: "Fix term", exact: true });
  const draft = fix.getByRole("textbox", { name: "Correct term" });
  await draft.fill("corrected");
  await steer.failNext("transcript_fix_term", "invalid_input");
  await fix.getByRole("button", { name: "Fix", exact: true }).click();
  await expect(fix).toContainText("Select the words again");
  await expect(draft).toHaveValue("corrected");
  await expect(fix.getByRole("button", { name: "Fix", exact: true })).toBeDisabled();
  expect(await sent(page, "transcript_span")).toHaveLength(1);
  await draft.fill("another correction");
  await draft.press("Enter");
  await expect(fix).toContainText("Select the words again");
  expect(await sent(page, "transcript_fix_term")).toHaveLength(1);
});
