// M2 — Handoff to Claude Code and Codex (docs/features/ui/handoff.md, DESIGN.md Handoff drawer HD-R1..R7, Prompt editor, Add Mapping
// sheet). Real-core stories of cpt-noter-seq-call-page-hand-off-item (every path). Written before the screens exist (tests first).
// Assumptions: the fixture's itm_replay stands for both the user's own item (made so with world_set) and Dmitri's; the VSTOR mapping
// is made with repo_upsert on a temp folder; launch results come from harness.launch_world and harness.native_log; the folder
// picker of Add Mapping is typed into its Folder field when the harness has no open panel. Copy and labels are DESIGN's.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import { openWindow } from "./support/app";
import { navigate, sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import * as H from "./support/handoff-world";

const { REAL } = H;

const drawer = (page: Page) => page.locator('[data-region="HD-R1"], [data-region="HD"]').first();
const region = (page: Page, id: string) => page.locator(`[data-region="${id}"]`);
const row = (page: Page) => page.getByRole("row", { name: /Replay buffer/ }).or(page.locator('[data-component="cpt-noter-component-ui-action-item-row"]').filter({ hasText: "Replay buffer" })).first();
const PROMPT_LINE = "Opens Claude Code in your usual terminal with the prompt filled in; nothing is sent until you press Return.";

/** The call page of the item with the drawer open; `mapped` creates the VSTOR mapping first. */
async function open(page: Page, opts: { own?: boolean; mapped?: boolean; sensitive?: boolean; failGenerate?: boolean; launch?: () => Promise<void> } = {}) {
  let callId = "";
  const steer = await openWindow(page, "main", {
    world: (w) => {
      H.place(w);
      if (opts.own ?? true) H.own(w);
      if (opts.sensitive) H.sensitive(w);
      if (opts.mapped === false) H.unmap(w);
      callId = H.callOf(w);
    },
  });
  await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
  if (opts.mapped ?? true) await H.map(page);
  await navigate(page, "summary", callId);
  await opts.launch?.();
  if (opts.failGenerate) await steer.failNext("handoff_generate", "runtime_unavailable");
  await row(page).getByRole("button", { name: "Handoff" }).click();
  return steer;
}

test.describe("cpt-noter-seq-call-page-hand-off-item", () => {
  test("UI — happy path: Handoff opens the drawer, Writing the handoff prompt… with Cancel, the prompt with Claude Code and the repository, the launch line, Edited and Your Edit, ⌘Return opens it and the drawer says Handed off to Claude Code", async ({ page }) => {
    await open(page);
    expect((await sent(page, "handoff_get"))[0]).toEqual({ item_id: H.ITEM });
    await expect(region(page, "HD-R4").getByRole("textbox")).toBeVisible();
    if (REAL) expect(await sent(page, "handoff_generate")).toEqual([{ item_id: H.ITEM, regenerate: false }]); // the fake has the prompt already
    await expect(region(page, "HD-R2").getByRole("radio", { name: "Claude Code" })).toBeChecked();
    await expect(region(page, "HD-R3")).toContainText(/frontend/);
    await expect(region(page, "HD-R5")).toContainText(PROMPT_LINE);

    const prompt = region(page, "HD-R4").getByRole("textbox");
    const promptWidth = (await prompt.boundingBox())!.width;
    expect(promptWidth).toBeGreaterThan((await region(page, "HD-R4").boundingBox())!.width * 0.85);
    await prompt.fill("Fix the replay buffer overflow in the virtualised table.");
    await expect(drawer(page)).toContainText("Edited");
    await region(page, "HD-R4").getByRole("button", { name: /Version/ }).click();
    await expect(page.getByRole("menu")).toContainText("Your Edit");
    await page.keyboard.press("Escape");

    // the real core never marks an item owned by the user (is_you is always false there): Open is not its default, so click it
    if (REAL) await region(page, "HD-R7").getByRole("button", { name: "Open in Claude Code" }).click();
    else await page.keyboard.press("Meta+Enter");
    expect(await sent(page, "handoff_edit")).toEqual([expect.objectContaining({ item_id: H.ITEM, prompt_md: "Fix the replay buffer overflow in the virtualised table." })]);
    await expect.poll(() => sent(page, "handoff_open")).toEqual([expect.objectContaining({ item_id: H.ITEM })]);
    await expect(region(page, "HD-R6")).toContainText(/Handed off to Claude Code · \w{3} \d{1,2} \d{1,2}:\d{2}/);
    await expect(row(page)).toContainText("Handed off");
  });

  test("UI — error path: No Claude Code link handler — the launch line names iTerm and the one-time Automation question, Open says Opened in iTerm · item marked Handed off", async ({ page }) => {
    await open(page, { launch: () => H.launch(page, "iterm", { needsAutomation: true }) });
    if (!REAL) return; // the launch path is what the Mac reports (harness.launch_world): the fake core has no Mac
    await expect(region(page, "HD-R5")).toContainText(/No Claude Code link handler found\. Noter will open iTerm and run claude in .+; macOS asks once to allow Automation\./);
    await region(page, "HD-R7").getByRole("button", { name: "Open in Claude Code" }).click();
    await expect(region(page, "HD-R6")).toContainText("Opened in iTerm · item marked Handed off");
    expect(JSON.stringify(await H.nativeLog(page))).toContain("iterm");
  });

  test("UI — error path: Automation denied — Couldn't open Claude Code · use Copy Prompt, Copy Prompt says Copied and puts the prompt on the clipboard", async ({ page }) => {
    await open(page, { launch: () => H.launch(page, "iterm", { needsAutomation: true, denied: true, fail: [{ path: "iterm", code: "automation_denied" }] }) });
    if (!REAL) return; // Automation is the Mac's answer (harness.launch_world): the fake core never refuses
    await region(page, "HD-R7").getByRole("button", { name: "Open in Claude Code" }).click();
    await expect(region(page, "HD-R7")).toContainText("Couldn't open Claude Code · use Copy Prompt");
    await expect(drawer(page)).not.toContainText("Handed off to");
    await region(page, "HD-R7").getByRole("button", { name: "Copy Prompt" }).click();
    expect(await sent(page, "handoff_copy")).toEqual([expect.objectContaining({ item_id: H.ITEM })]);
    await expect(region(page, "HD-R7")).toContainText("Copied");
    expect(JSON.stringify(await H.nativeLog(page))).toContain("clipboard");
  });

  test("UI — error path: No repository mapped — No repository mapped for VSTOR · Add Mapping…, Open disabled and Copy Prompt enabled", async ({ page }) => {
    await open(page, { mapped: false });
    await expect(region(page, "HD-R3")).toContainText("No repository mapped for VSTOR");
    await expect(region(page, "HD-R7").getByRole("button", { name: "Open in Claude Code" })).toBeDisabled();
    await expect(region(page, "HD-R7").getByRole("button", { name: "Copy Prompt" })).toBeEnabled();
  });

  test("UI — other path: Escape on the Add Mapping sheet returns focus to the Add Mapping… button", async ({ page }) => {
    await open(page, { mapped: false });
    const opener = region(page, "HD-R3").getByRole("button", { name: "Add Mapping…" });
    await opener.click();
    const sheet = page.getByRole("dialog", { name: "Add Mapping", exact: true });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("UI — error path: Add Mapping from the unmapped drawer persists the folder and enables Open", async ({ page }) => {
    await open(page, { mapped: false });
    await region(page, "HD-R3").getByRole("button", { name: "Add Mapping…" }).click();
    const sheet = page.getByRole("dialog", { name: "Add Mapping", exact: true });
    await expect(sheet).toContainText("From the Handoff drawer");
    await expect(sheet.getByRole("textbox", { name: "Jira project or component" })).toHaveValue("VSTOR");
    const folder = mkdtempSync(join(tmpdir(), "noter-mapping-ui-"));
    await sheet.getByRole("textbox", { name: "Folder", exact: true }).fill(folder);
    await sheet.getByRole("button", { name: "Add Mapping", exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(region(page, "HD-R3")).toContainText(folder);
    await expect(region(page, "HD-R7").getByRole("button", { name: "Open in Claude Code" })).toBeEnabled();
    expect(await sent(page, "repo_upsert")).toContainEqual({ key: "VSTOR", local_path: folder, default_tool: "claude_code" });
  });

  test("UI — other path: Compare uses the current edit and generated text without historical-body requests", async ({ page }) => {
    await open(page);
    await region(page, "HD-R4").getByRole("textbox").fill("A current edited prompt.");
    await region(page, "HD-R4").getByRole("button", { name: /Version/ }).click();
    await page.getByRole("menuitem", { name: "Compare…" }).click();
    await expect(region(page, "HD-R4")).toContainText("Showing changes");
    await expect(region(page, "HD-R4").locator("ins")).toHaveText(["A", "current", "edited", "prompt."]);
    expect(await sent(page, "output_version_get")).toEqual([]);
  });

  test("UI — empty path: Item owned by someone else — Copy Prompt is the default (⌘Return) with Open in Claude Code to its left, Copied, the item stays open and owned by Dmitri S.", async ({ page }) => {
    await open(page, { own: false });
    const footer = region(page, "HD-R7");
    const names = await footer.getByRole("button").allInnerTexts();
    expect(names.findIndex((n) => /Open in Claude Code/.test(n))).toBeLessThan(names.findIndex((n) => /Copy Prompt/.test(n)));
    await expect(drawer(page)).toContainText("Opening or copying accepts this suggested item.");
    await expect(footer.getByRole("button", { name: "Copy Prompt", exact: true })).toBeEnabled();
    await page.keyboard.press("Meta+Enter");
    await expect.poll(() => sent(page, "handoff_copy")).toHaveLength(1);
    expect(await sent(page, "handoff_open")).toEqual([]);
    await expect(footer).toContainText("Copied");
    await expect(row(page)).toContainText("Dmitri S.");
  });

  test("UI — error path: Prompt not written — Couldn't write the prompt with Try Again, Try Again says Writing the handoff prompt… and the prompt follows", async ({ page }) => {
    await open(page, { failGenerate: true });
    if (!REAL) return; // the fake core answers handoff_get with a written prompt: only the real core starts at not_generated
    await expect(region(page, "HD-R4")).toContainText("Couldn't write the prompt");
    await region(page, "HD-R4").getByRole("button", { name: "Try Again" }).click();
    await expect(region(page, "HD-R4").getByRole("textbox")).toBeVisible();
    expect(await sent(page, "handoff_generate")).toHaveLength(2);
  });

  test("UI — other path: Check the prompt against the generated version — Diff shows Showing changes with words added and removed, Hide Diff returns to the same edit", async ({ page }) => {
    await open(page);
    const prompt = region(page, "HD-R4");
    await prompt.getByRole("textbox").fill("A different prompt entirely.");
    await prompt.getByRole("button", { name: "Diff" }).click();
    await expect(prompt).toContainText("Showing changes");
    await expect(prompt.locator("ins").first()).toBeVisible();
    await expect(prompt.locator("del").first()).toBeVisible();
    await expect(prompt.locator(".pc-diff__text")).toHaveCSS("font-size", "12px");
    await expect(prompt.locator(".pc-diff__text")).toHaveCSS("line-height", "18px");
    await expect(prompt.locator(".pc-diff__text")).toHaveCSS("font-family", /monospace/);
    await prompt.getByRole("button", { name: "Hide Diff" }).click();
    await expect(prompt.getByRole("textbox")).toHaveValue("A different prompt entirely.");
  });

  test("UI — other path: Codex — Target Codex changes the Open label and the launch line, and opening it accepts a suggested item", async ({ page }) => {
    await open(page, { own: false });
    await region(page, "HD-R2").getByRole("radio", { name: "Codex" }).click();
    await expect(region(page, "HD-R2").getByRole("radio", { name: "Codex" })).toBeChecked();
    expect(await sent(page, "handoff_set_target")).toEqual([expect.objectContaining({ item_id: H.ITEM, target: "codex" })]);
    await expect(region(page, "HD-R7").getByRole("button", { name: "Open in Codex" })).toBeVisible();
    await expect(region(page, "HD-R5")).toContainText("Codex");
    await region(page, "HD-R7").getByRole("button", { name: "Copy Prompt" }).click();
    await expect(row(page).getByText("Not reviewed")).toHaveCount(0); // copying accepted the suggestion
  });

  test("UI — empty path: Sensitive call — the drawer says This call is sensitive. The prompt reaches a cloud model when you press Return in the terminal., nothing is sent by Noter", async ({ page }) => {
    await open(page, { sensitive: true });
    await expect(drawer(page)).toContainText("This call is sensitive. The prompt reaches a cloud model when you press Return in the terminal.");
  });

  test("UI — other path: the header close control closes the drawer and restores focus", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Close Inspector", exact: true }).click({ timeout: 3000 });
    await expect(drawer(page)).toHaveCount(0);
    await expect(row(page).getByRole("button", { name: "Handoff" })).toBeFocused();
  });

  test("UI — other path: Esc closes the drawer and returns focus to the item's Handoff row", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Escape");
    await expect(drawer(page)).toHaveCount(0);
    await expect(row(page).getByRole("button", { name: "Handoff" })).toBeFocused();
  });
});
