// M2 — Call page outputs and sharing (docs/features/ui/call-page-outputs.md, DESIGN.md Call page PC-R2/PC-R3, Share menu,
// Output section, Version switcher, Diff view). Real-core stories of cpt-noter-seq-call-page-review-outputs (every path;
// History's log paths are delegated to History), cpt-noter-seq-call-page-share-outputs (every path) and
// cpt-noter-seq-notifications-open-outputs (every path; the macOS notification itself is native, XCUITest
// test_cpt_noter_seq_notifications_open_outputs). Written before the screens exist (tests first): they fail until the
// feature lands. Starting states: support/outputs-world.ts. Copy and labels are DESIGN's, never adjusted to the markup.
import type { Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { banner, body, navigate, openSummary, section, sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";
import * as O from "./support/outputs-world";

const toolbar = (page: Page) => page.locator('[data-region="PC-R1"]');
const share = (page: Page) => toolbar(page).getByRole("button", { name: /^Share/ });
const menu = (page: Page) => page.getByRole("menu");

test.describe("cpt-noter-seq-call-page-review-outputs", () => {
  test("UI — happy path: Summary meta line, the four sections, Edit, ⌘Return, Edited badge and Your Edit in the version menu", async ({ page }) => {
    await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    expect((await sent(page, "outputs_get")).some((a) => a.call_id === W.PAST_CALL)).toBe(true);

    const summary = section(page, "Summary");
    await expect(summary).toContainText(/Summary · English · Claude Code · \d+ min \d+ s after the call/);
    await expect(section(page, /^Decisions/)).toContainText("Decisions · 2");
    await expect(section(page, /^Action items/)).toContainText("Action items · 4");
    await expect(section(page, /^Open questions/)).toContainText("Open questions · 2");
    await expect(section(page, "Per participant")).toBeVisible();

    await summary.getByRole("button", { name: "Edit" }).click();
    await expect(summary).toContainText("⌘Return saves · Esc cancels");
    await expect(summary.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(summary.getByRole("button", { name: "Save" })).toBeVisible();
    const editor = summary.getByRole("textbox");
    await editor.fill("Backend and QA aligned on the websocket notifications. The soak run is Oleg's.");
    await page.keyboard.press("Meta+Enter");

    expect(await sent(page, "output_edit")).toEqual([
      expect.objectContaining({ call_id: W.PAST_CALL, summary_id: "sum_backend", base_rev: 2, body_md: "Backend and QA aligned on the websocket notifications. The soak run is Oleg's." }),
    ]);
    await expect(summary).toContainText("The soak run is Oleg's.");
    await expect(summary.getByText("Edited")).toBeVisible();
    await expect(summary.getByText("Saved")).toBeVisible(); // 2 s
    await summary.getByRole("button", { name: /Version/ }).click();
    await expect(menu(page)).toContainText(/Your Edit · \d{1,2}:\d{2}/);
  });

  test("UI — happy path: Esc discards the draft and the saved text stays", async ({ page }) => {
    await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    const summary = section(page, "Summary");
    await summary.getByRole("button", { name: "Edit" }).click();
    await summary.getByRole("textbox").fill("A correction nobody saves");
    await page.keyboard.press("Escape");
    await expect(summary).toContainText("Drawer events will ship behind a flag.");
    expect(await sent(page, "output_edit")).toEqual([]);
  });

  test("UI — error path: a save that conflicts keeps the draft and shows the error until the user saves again", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    const summary = section(page, "Summary");
    await summary.getByRole("button", { name: "Edit" }).click();
    await summary.getByRole("textbox").fill("My correction");
    await steer.failNext("output_edit", "conflict", { type: "conflict", current_rev: 3 });
    await page.keyboard.press("Meta+Enter");
    await expect(summary.getByRole("textbox")).toHaveValue("My correction");
    await expect(summary.getByRole("alert")).toBeVisible();
    expect(await sent(page, "output_edit")).toHaveLength(1);
    await page.keyboard.press("Meta+Enter"); // an explicit new save
    await expect.poll(async () => (await sent(page, "output_edit")).length).toBe(2);
  });

  test("UI — empty path: Outputs still being written — Writing summary…, Waiting for the summary, Read Transcript, sections fill in order", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.writing });
    await openSummary(page);
    await expect(banner(page)).toContainText("Writing the outputs · the transcript is ready to read");
    await expect(section(page, "Summary")).toContainText(/Writing summary… /);
    await expect(section(page, /^Decisions/)).toContainText("Waiting for the summary");
    await expect(section(page, /^Action items/)).toContainText("Waiting for the summary");

    await banner(page).getByRole("button", { name: "Read Transcript" }).click();
    await expect(page.getByRole("tab", { name: "Transcript", selected: true })).toBeVisible();
    await page.getByRole("tab", { name: "Summary" }).click();

    await steer.change((w) => {
      const sum = O.sectionOf(w, "summary");
      Object.assign(sum, { state: { type: "ready" }, summary_id: "sum_backend", rev: 1, body_md: "The summary lands first.", version_count: 1 });
    });
    await expect(section(page, "Summary")).toContainText("The summary lands first.");
    await expect(section(page, /^Decisions/)).toContainText("Waiting for the summary"); // the rest still waits
    await steer.change(O.written);
    await expect(section(page, /^Decisions/)).toContainText("Decisions · 2");
    await expect(banner(page)).not.toContainText("Writing the outputs");
  });

  test("UI — empty path: the local runtime says Writing with the local model · up to 10 min · role reviews follow in the background", async ({ page }) => {
    await openWindow(page, "main", {
      world: (w) => (O.writing(w), (O.outputsOf(w).written_locally = true)),
    });
    await openSummary(page);
    await expect(banner(page)).toContainText("Writing with the local model · up to 10 min · role reviews follow in the background");
  });

  test("UI — error path: A section failed — the others stay usable, Try Again writes that section only", async ({ page }) => {
    await openWindow(page, "main", { world: O.actionItemsFailed });
    await openSummary(page);
    const failed = section(page, /^Action items/);
    await expect(failed).toContainText("Couldn't write the action items (Claude Code timed out)");
    await expect(failed.getByRole("button", { name: "Try Again" })).toBeVisible();
    await expect(failed.getByRole("button", { name: "Use Local Model" })).toBeVisible();
    await expect(section(page, "Summary")).toContainText("Drawer events will ship behind a flag.");
    await expect(section(page, /^Decisions/)).toContainText("Decisions · 2");

    await failed.getByRole("button", { name: "Try Again" }).click();
    expect(await sent(page, "outputs_regenerate")).toEqual([expect.objectContaining({ call_id: W.PAST_CALL, sections: ["action_items"], local: false })]);
    await expect(failed).not.toContainText("Couldn't write the action items");
  });

  test("UI — error path: Use Local Model regenerates that section locally and says so", async ({ page }) => {
    await openWindow(page, "main", { world: O.actionItemsFailed });
    await openSummary(page);
    await section(page, /^Action items/).getByRole("button", { name: "Use Local Model" }).click();
    expect(await sent(page, "outputs_regenerate")).toEqual([expect.objectContaining({ sections: ["action_items"], local: true })]);
  });

  test("UI — error path: Written by the local model — Regenerate with Claude Code…, the sheet, Regenerating…, Regenerated · your 2 edits kept · Show Diff", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.sensitive });
    await steer.change((w) => {
      O.outputsOf(w).sensitive = false;
      Object.assign(O.sectionOf(w, "summary"), { user_edited: true, version_count: 3 });
    });
    await openSummary(page);
    await expect(banner(page)).toContainText("Summary written by the local model");
    await banner(page).getByRole("button", { name: "Regenerate with Claude Code…" }).click();

    const sheet = page.getByRole("dialog", { name: "Regenerate Outputs" });
    for (const label of ["Runtime and model", "Skill", "Sections"]) await expect(sheet).toContainText(label);
    await expect(sheet).toContainText("Your edits are kept and shown as a diff.");
    await sheet.getByRole("button", { name: "Regenerate", exact: true }).click();
    expect(await sent(page, "outputs_regenerate")).toEqual([expect.objectContaining({ call_id: W.PAST_CALL, local: false })]);
    await expect(section(page, "Summary")).toContainText("Regenerating…");

    await steer.change((w) => {
      const s = O.sectionOf(w, "summary");
      Object.assign(s, { state: { type: "ready" }, regenerated_with_edits: true, writer: { ...O.WRITER, runtime: "claude_code" } });
      O.outputsOf(w).written_locally = false;
    });
    await expect(section(page, "Summary")).toContainText(/Regenerated · your 2 edits kept/);
    await expect(section(page, "Summary").getByRole("button", { name: "Show Diff" })).toBeVisible();
  });

  test("UI — empty path: Nothing in a section — No decisions in this call, Add Action Item adds an accepted item the user wrote", async ({ page }) => {
    await openWindow(page, "main", {
      world: (w) => {
        O.written(w);
        Object.assign(O.sectionOf(w, "decisions"), { state: { type: "empty" }, items: [] });
        Object.assign(O.sectionOf(w, "action_items"), { state: { type: "empty" }, items: [] });
      },
    });
    await openSummary(page);
    await expect(section(page, /^Decisions/)).toContainText("No decisions in this call");
    const actions = section(page, /^Action items/);
    await expect(actions).toContainText("No action items in this call");
    await expect(section(page, /^Risks/)).toHaveCount(0); // Risks is left out when there are none

    await actions.getByRole("button", { name: "Add Action Item" }).click();
    await actions.getByPlaceholder("What needs doing, and who does it?").fill("Send the flag note to Dmitri");
    await page.keyboard.press("Enter");
    expect(await sent(page, "item_create")).toEqual([expect.objectContaining({ text: "Send the flag note to Dmitri" })]);
    await expect(actions).toContainText("Send the flag note to Dmitri");
    await expect(actions.getByText("Not reviewed")).toHaveCount(0); // accepted because the user wrote it
  });

  test("UI — other path: Regenerate with a different model — Claude Code · Opus, Role reviews ticked, the button busy, then Regenerated", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    await toolbar(page).getByRole("button", { name: "⋯" }).click();
    await menu(page).getByRole("menuitem", { name: "Regenerate Outputs…" }).click();
    const sheet = page.getByRole("dialog", { name: "Regenerate Outputs" });
    await sheet.getByRole("combobox", { name: "Runtime and model" }).selectOption({ label: "Claude Code · Opus" });
    await sheet.getByRole("checkbox", { name: "Role reviews" }).check();
    await sheet.getByRole("button", { name: "Regenerate", exact: true }).click();

    expect(await sent(page, "outputs_regenerate")).toEqual([
      expect.objectContaining({ call_id: W.PAST_CALL, sections: expect.arrayContaining(["role_reviews"]), local: false }),
    ]);
    await expect(sheet).toHaveCount(0);
    await expect(section(page, "Summary")).toContainText("Regenerating…");
    await steer.change((w) => Object.assign(O.sectionOf(w, "summary"), { state: { type: "ready" }, regenerated_with_edits: true }));
    await expect(section(page, "Summary")).toContainText("Regenerated");
    await expect(section(page, "Summary").getByRole("button", { name: "Show Diff" })).toBeVisible();
  });

  test("UI — other path: a regenerate that is blocked during capture says it waits for the call to end, with no retry", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    await steer.failNext("outputs_regenerate", "job_blocked");
    await toolbar(page).getByRole("button", { name: "⋯" }).click();
    await menu(page).getByRole("menuitem", { name: "Regenerate Outputs…" }).click();
    await page.getByRole("dialog", { name: "Regenerate Outputs" }).getByRole("button", { name: "Regenerate", exact: true }).click();
    await expect(page.getByText(/waits for the call to end/i)).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await sent(page, "outputs_regenerate")).toHaveLength(1); // no timer retry
  });

  test("UI — other path: Compare versions — v1 · v2 · Your Edit, Compare… shows v1 → Your Edit with words changed, again gives the plain text", async ({ page }) => {
    await openWindow(page, "main", {
      world: (w) => (O.written(w), Object.assign(O.sectionOf(w, "summary"), { user_edited: true, version_count: 3, rev: 3 })),
    });
    await openSummary(page);
    const summary = section(page, "Summary");
    await summary.getByRole("button", { name: /Version/ }).click();
    for (const row of [/v1 · Claude Code · \d{1,2}:\d{2}/, /v2 · Claude Code · \d{1,2}:\d{2}/, /Your Edit · \d{1,2}:\d{2}/, /Compare…/]) await expect(menu(page)).toContainText(row);

    await menu(page).getByRole("menuitem", { name: "Compare…" }).click();
    expect((await sent(page, "output_versions")).length).toBeGreaterThan(0);
    expect((await sent(page, "output_version_get")).length).toBeGreaterThanOrEqual(2);
    await expect(summary).toContainText("v1 → Your Edit");
    await expect(summary).toContainText(/\d+ words? changed/);
    await expect(summary.locator("ins").first()).toBeVisible(); // insertions underlined
    await expect(summary.locator("del").first()).toBeVisible(); // deletions struck through

    await summary.getByRole("button", { name: /Version/ }).click();
    await menu(page).getByRole("menuitem", { name: "Compare…" }).click();
    await expect(summary.locator("ins")).toHaveCount(0);
    await expect(summary).toContainText("Drawer events will ship behind a flag.");
  });

  test("UI — other path: a version that cannot be read keeps the current prose and offers a retry beside the version control", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: (w) => (O.written(w), Object.assign(O.sectionOf(w, "summary"), { version_count: 3, user_edited: true })) });
    await openSummary(page);
    const summary = section(page, "Summary");
    await steer.failNext("output_version_get", "not_found");
    await summary.getByRole("button", { name: /Version/ }).click();
    await menu(page).getByRole("menuitem", { name: /^v1/ }).click();
    await expect(summary).toContainText("Drawer events will ship behind a flag.");
    await expect(summary.getByRole("button", { name: "Try Again" })).toBeVisible();
  });
});

test.describe("cpt-noter-seq-call-page-share-outputs", () => {
  test("UI — happy path: Share opens on Whole call, Copy for Slack shows Copied for Slack on the button", async ({ page }) => {
    await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    await share(page).click();
    await expect(menu(page)).toContainText("Whole call");
    await menu(page).getByRole("menuitem", { name: "Copy for Slack" }).click();
    expect(await sent(page, "share_copy")).toEqual([
      { call_id: W.PAST_CALL, scope: { sections: [], item_ids: [], include_unreviewed: false }, format: "slack" },
    ]);
    await expect(share(page)).toContainText("Copied for Slack"); // 2 s, announced politely
    await expect(page.getByRole("status").filter({ hasText: "Copied for Slack" })).toHaveCount(1);
    await expect(share(page)).not.toContainText("Copied for Slack", { timeout: 5000 });
  });

  test("UI — happy path: ⌘⇧C copies for Slack without opening the menu", async ({ page }) => {
    await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    await page.keyboard.press("Meta+Shift+KeyC");
    await expect(menu(page)).toHaveCount(0);
    expect(await sent(page, "share_copy")).toEqual([expect.objectContaining({ call_id: W.PAST_CALL, format: "slack" })]);
    await expect(share(page)).toContainText("Copied for Slack");
  });

  test("UI — other path: Share a sensitive call — Sensitive call · processed on this Mac only, the clipboard line, and Copied", async ({ page }) => {
    await openWindow(page, "main", { world: O.sensitive });
    await openSummary(page);
    await expect(banner(page)).toContainText("Sensitive call · processed on this Mac only");
    await share(page).click();
    await expect(menu(page)).toContainText("Sensitive call · copying puts the text on your clipboard");
    await menu(page).getByRole("menuitem", { name: "Copy for Slack" }).click();
    expect(await sent(page, "share_copy")).toHaveLength(1);
    await expect(share(page)).toContainText("Copied");
  });

  test("UI — empty path: Nothing to share yet — the info line, the three copy items disabled, enabled once the sections are written", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.writing });
    await openSummary(page);
    await share(page).click();
    await expect(menu(page)).toContainText("Nothing to share yet: outputs are being written");
    for (const name of ["Copy for Slack", "Copy for Jira", "Copy as Markdown"]) await expect(menu(page).getByRole("menuitem", { name })).toBeDisabled();
    await page.keyboard.press("Escape");

    await steer.change(O.written);
    await share(page).click();
    await expect(menu(page)).not.toContainText("Nothing to share yet");
    for (const name of ["Copy for Slack", "Copy for Jira", "Copy as Markdown"]) await expect(menu(page).getByRole("menuitem", { name })).toBeEnabled();
    expect(await sent(page, "share_copy")).toEqual([]); // disabled copies sent nothing
  });

  test("UI — error path: Suggested items not reviewed — Includes 3 suggested items not reviewed yet, Start Review, then no line and Copy for Jira", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.threeSuggested });
    await openSummary(page);
    await share(page).click();
    await expect(menu(page)).toContainText("Includes 3 suggested items not reviewed yet");
    await menu(page).getByRole("button", { name: "Start Review" }).click(); // Items' review flow takes over
    await steer.change((w) => {
      O.sectionOf(w, "action_items").items.forEach((i) => (i.review = "accepted"));
      O.outputsOf(w).review_waiting = 0;
      w.items.forEach((i) => i.call.id === W.PAST_CALL && (i.review = "accepted"));
    });
    await share(page).click();
    await expect(menu(page)).not.toContainText("suggested items not reviewed yet");
    await menu(page).getByRole("menuitem", { name: "Copy for Jira" }).click();
    expect((await sent(page, "share_copy")).at(-1)).toEqual(expect.objectContaining({ call_id: W.PAST_CALL, format: "jira" }));
    await expect(share(page)).toContainText("Copied for Jira");
  });

  test("UI — error path: a refused copy shows no success text, the scope notice stays and the inclusion is not changed", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.threeSuggested });
    await openSummary(page);
    await steer.failNext("share_copy", "unreviewed_in_scope");
    await share(page).click();
    await menu(page).getByRole("menuitem", { name: "Copy for Slack" }).click();
    await expect(share(page)).not.toContainText("Copied");
    await share(page).click();
    await expect(menu(page)).toContainText("Includes 3 suggested items not reviewed yet");
    await expect(menu(page).getByRole("button", { name: "Start Review" })).toBeVisible();
    expect((await sent(page, "share_copy")).every((a) => (a.scope as { include_unreviewed: boolean }).include_unreviewed === false)).toBe(true);
  });

  test("UI — other path: Export to a folder — ⌘E, the sheet with Scope: Whole call, tick Transcript, Export…, Exported to <path> with Show in Finder", async ({ page }) => {
    await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    await page.keyboard.press("Meta+KeyE");
    const sheet = page.getByRole("dialog", { name: /Export/ });
    await expect(sheet).toContainText("Scope: Whole call");
    await expect(sheet.getByRole("checkbox", { name: "Summary and items" })).toBeChecked();
    await expect(sheet.getByRole("checkbox", { name: "Transcript" })).not.toBeChecked();
    await expect(sheet.getByRole("checkbox", { name: "Audio" })).toBeVisible(); // audio is kept
    await sheet.getByRole("checkbox", { name: "Transcript" }).check();
    await sheet.getByRole("button", { name: "Export…" }).click(); // the core shows the macOS save panel; the harness answers it

    expect(await sent(page, "calls_export")).toEqual([
      { call_ids: [W.PAST_CALL], include: { summary_and_items: true, transcript: true, audio: false }, scope: null },
    ].map((a) => expect.objectContaining({ call_ids: a.call_ids, include: expect.objectContaining({ summary_and_items: true, transcript: true }) })));
    await expect(share(page)).toContainText(/Exported to .+/);
    await page.getByRole("button", { name: "Show in Finder" }).click();
    expect(await sent(page, "open_external")).toEqual([{ target: { type: "reveal_in_finder", path: expect.any(String) } }]);
  });

  test("UI — other path: Export needs one content checkbox, and a cancelled save panel leaves no Exported status", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    await page.keyboard.press("Meta+KeyE");
    const sheet = page.getByRole("dialog", { name: /Export/ });
    await sheet.getByRole("checkbox", { name: "Summary and items" }).uncheck();
    await expect(sheet.getByRole("button", { name: "Export…" })).toBeDisabled();
    await sheet.getByRole("checkbox", { name: "Summary and items" }).check();
    await steer.failNext("calls_export", "cancelled");
    await sheet.getByRole("button", { name: "Export…" }).click();
    await expect(share(page)).not.toContainText("Exported to");
    await expect(page.getByRole("button", { name: "Show in Finder" })).toHaveCount(0);
  });

  test("UI — other path: Share one section — the section's share button, Action items scope, Includes 2 suggested items, Copy as Markdown", async ({ page }) => {
    await openWindow(page, "main", {
      world: (w) => (O.threeSuggested(w), O.sectionOf(w, "action_items").items.forEach((i, n) => (i.review = n < 2 ? "suggested" : "accepted"))),
    });
    await openSummary(page);
    const actions = section(page, /^Action items/);
    await actions.getByRole("button", { name: "Share Action Items" }).click();
    await expect(menu(page)).toContainText("Action items");
    await expect(menu(page)).toContainText("Includes 2 suggested items not reviewed yet");
    await menu(page).getByRole("menuitem", { name: "Copy as Markdown" }).click();
    expect(await sent(page, "share_copy")).toEqual([
      expect.objectContaining({ call_id: W.PAST_CALL, format: "markdown", scope: expect.objectContaining({ sections: ["action_items"] }) }),
    ]);
    await expect(actions).toContainText("Copied as Markdown");
  });
});

test.describe("cpt-noter-seq-notifications-open-outputs", () => {
  test("UI — happy path: a notification click (nav:request) opens the call's Summary in the main window with its outputs loaded", async ({ page }) => {
    await openWindow(page, "main", { world: O.written });
    await openSummary(page);
    await page.keyboard.press("Meta+Digit1"); // the user works elsewhere in Noter
    await navigate(page, "summary"); // what a click on NT-1 does: the core's window_navigate → nav:request
    await expect(page.getByRole("heading", { name: new RegExp(O.TITLE) }).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Summary", selected: true })).toBeVisible();
    await expect(section(page, "Summary")).toContainText("Drawer events will ship behind a flag.");
    expect((await sent(page, "outputs_get")).length).toBeGreaterThan(0);
  });

  test("UI — error path: Outputs failed — the click opens the failed section with Try Again, Try Again writes it", async ({ page }) => {
    await openWindow(page, "main", { world: O.actionItemsFailed });
    await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
    await navigate(page, "summary");
    const failed = section(page, /^Action items/);
    await expect(failed.getByRole("button", { name: "Try Again" })).toBeVisible();
    expect(await sent(page, "outputs_regenerate")).toEqual([]); // opening a failure never retries on its own
    await failed.getByRole("button", { name: "Try Again" }).click();
    await expect(failed).toContainText("Writing");
    expect(await sent(page, "outputs_regenerate")).toEqual([expect.objectContaining({ sections: ["action_items"] })]);
  });

  test("UI — empty path: the main window already shows the call — sections fill in, Summary ready is announced once, no notification", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: O.writing });
    await openSummary(page);
    await steer.change(O.written);
    await expect(section(page, /^Decisions/)).toContainText("Decisions · 2");
    await expect(page.getByRole("status").filter({ hasText: "Summary ready" })).toHaveCount(1);
    const surfaces = await page.evaluate(() => (globalThis as unknown as { __noterCalls: Array<{ name: string }> }).__noterCalls.filter((c) => c.name === "window_report_view").length);
    expect(surfaces).toBeGreaterThan(0); // the core knows this page is in front and skips NT-1
  });

  test("UI — empty path: the next call is recording — opening the finished call's Summary still reads its outputs while the live call goes on", async ({ page }) => {
    await openWindow(page, "main", { world: O.written }); // the 1:1 is the live call of the fixture; the planning call is past
    await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
    await navigate(page, "summary");
    await expect(section(page, "Summary")).toContainText("Drawer events will ship behind a flag.");
    expect(await sent(page, "outputs_get")).toEqual([expect.objectContaining({ call_id: W.PAST_CALL })]);
    await expect(body(page)).toBeVisible();
  });
});
