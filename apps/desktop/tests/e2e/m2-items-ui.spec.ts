// M2 — Items (docs/features/ui/items.md, DESIGN.md › Screen — Call page PC-R2/PC-R3, Item inspector II-R1/II-R2).
// Stories: `cpt-noter-seq-call-page-review-suggested-items` (every path) and `cpt-noter-seq-call-page-check-evidence`
// (evidence, audio deleted, archive upgrade/pending, Edit an item in the Item inspector). Commands: items_list, item_get,
// item_review, items_review_all, item_edit, item_create, item_set_done, item_reopen, item_answer_handoff_landed, transcript_span.
// Written before the feature exists (tests first): they fail until items lands. They drive the real UI on the selected core
// (NOTER_CORE=stdio → noter-core-harness). The fixture's "Planning: VHI 8.0 drawer redesign" (call_live, not recording after
// W.idle) carries 3 suggested items (2 action items, 1 question); tests that need other counts reshape the world first.
// Data gaps are listed in _team/handoff-ui-m2-e2e-1.md (archive "upgraded" has no world field; Today is in m2-today-ui.spec.ts).
import type { Locator, Page } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { calls, openWindow } from "./support/app";
import { expect, test } from "./support/fixtures";

const TITLE = W.LIVE_TITLE;
const ROW = '[data-component="cpt-noter-component-ui-action-item-row"], [data-component="cpt-noter-component-ui-output-item-row"]';
const STRIP = '[data-component="cpt-noter-component-ui-undo-strip"]';
const INSPECTOR = '[data-component="cpt-noter-component-ui-item-inspector"]';
const toolbar = (page: Page) => page.locator('[data-region="PC-R1"]');
const banner = (page: Page) => page.locator('[data-region="PC-R2"]');
const rowOf = (page: Page, text: string | RegExp) => page.locator(ROW).filter({ hasText: text });
const strip = (page: Page) => page.locator(STRIP);
const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name });
const sent = async (page: Page, name: string): Promise<Array<Record<string, unknown>>> =>
  (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args as Record<string, unknown>);
const REPLAY = "Replay buffer for websocket reconnects"; // suggested action item, itm_replay
const A11Y = "Check drawer focus order with VoiceOver"; // suggested action item, itm_a11y
const DECISION = "Drawer events go through the notification"; // decision, itm_notif

const quiet = (more: (w: World) => void = () => {}) => (w: World) => (W.idle(w), more(w));
const review = (w: World, id: string, to: "suggested" | "accepted" | "rejected") => (w.items.find((i) => i.id === id)!.review = to);
const allAccepted = (w: World) => w.items.forEach((i) => (i.review = "accepted"));
const archive = (state: "done" | "failed") => (w: World) => {
  w.calls.find((c) => c.id === W.PAST_CALL)!.archive = state;
  w.call_details.find((d) => d.call.id === W.PAST_CALL)!.call.archive = state;
};

/** Library › Calls (⌘3), then the call's page the way the core opens it (`window_navigate` → `nav:request`) on `tab`. */
async function openCall(page: Page, world: (w: World) => void, callId: string = W.LIVE_CALL, tab: "summary" | "transcript" = "summary") {
  const steer = await openWindow(page, "main", { world });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit3");
    await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.waitForFunction(() => "__noterFake" in globalThis || "__TAURI_INTERNALS__" in globalThis);
  await page.evaluate(
    async ([id, view]) => {
      const args = { target: { type: "call_page", call_id: id, tab: view } };
      const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
      await (g.__noterFake ? g.__noterFake.invoke("window_navigate", args) : g.__TAURI_INTERNALS__!.invoke("window_navigate", { args }));
    },
    [callId, tab],
  );
  await expect(toolbar(page)).toContainText(callId === W.LIVE_CALL ? TITLE : "Backend sync");
  return steer;
}

test.describe("cpt-noter-seq-call-page-review-suggested-items", () => {
  test("UI — happy path: the banner counts the suggested items, Start Review focuses the first one, A accepts it and moves on", async ({ page }) => {
    await openCall(page, quiet());
    await expect(banner(page)).toContainText("3 suggested items to review before sharing");
    await expect(button(banner(page), "Start Review")).toBeVisible();
    await expect(button(banner(page), "Accept All")).toBeVisible();
    await expect(page.getByText(/Action items · \d+ · 2 to review/)).toBeVisible(); // section header count
    expect((await sent(page, "items_list")).length).toBeGreaterThan(0);

    await button(banner(page), "Start Review").click();
    const first = rowOf(page, REPLAY);
    await expect(first).toBeFocused();
    await expect(first.getByText("Suggested")).toBeVisible();
    await page.keyboard.press("a");
    expect(await sent(page, "item_review")).toEqual([expect.objectContaining({ item_id: "itm_replay", decision: "accept", rev: expect.any(Number) })]);
    await expect(first.getByText("Accepted", { exact: true })).toBeVisible(); // in place of the review buttons
    await expect(first.getByText("Suggested")).toHaveCount(0);
    await expect(rowOf(page, A11Y)).toBeFocused(); // focus moves to the next suggested row
  });

  test("UI — happy path: E turns a suggested row into fields, Owner and ⌘Return save and accept (Saved and accepted)", async ({ page }) => {
    await openCall(page, quiet());
    await rowOf(page, A11Y).focus();
    await page.keyboard.press("e");
    const row = rowOf(page, A11Y);
    await expect(row.getByRole("textbox").first()).toBeVisible();
    await expect(row.getByRole("combobox", { name: /Owner/ }).or(button(row, /Owner/))).toBeVisible();
    await expect(row.getByText("Due")).toBeVisible();
    await expect(row.getByText("Engineering")).toBeVisible();
    await expect(button(row, "Cancel")).toBeVisible();
    await expect(button(row, "Save")).toBeVisible();
    await row.getByRole("combobox", { name: /Owner/ }).selectOption({ label: "Anna K." });
    await page.keyboard.press("Meta+Enter");
    await expect(row.getByText("Saved and accepted")).toBeVisible();
    const edits = await sent(page, "item_edit");
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ item_id: "itm_a11y" });
    expect(await sent(page, "item_review")).toEqual([expect.objectContaining({ item_id: "itm_a11y", decision: "accept" })]); // after the edit, with its new rev
  });

  test("UI — Esc discards the edit draft and sends nothing", async ({ page }) => {
    await openCall(page, quiet());
    await rowOf(page, A11Y).focus();
    await page.keyboard.press("e");
    await rowOf(page, A11Y).getByRole("textbox").first().fill("changed");
    await page.keyboard.press("Escape");
    await expect(rowOf(page, A11Y)).toContainText(A11Y);
    expect(await sent(page, "item_edit")).toHaveLength(0);
  });

  test("UI — happy path: ⇧A on the Decisions header accepts the section's suggested decisions as one batch with Accepted … · Undo", async ({ page }) => {
    await openCall(page, quiet((w) => review(w, "itm_notif", "suggested")));
    await page.getByRole("heading", { name: /^Decisions/ }).focus();
    await page.keyboard.press("Shift+a");
    expect(await sent(page, "items_review_all")).toEqual([{ call_id: W.LIVE_CALL, kinds: ["decision"] }]);
    await expect(strip(page)).toContainText(/Accepted 1 (decision|item)/);
    await expect(button(strip(page), "Undo")).toBeVisible();
    await expect(rowOf(page, DECISION).getByText("Suggested")).toHaveCount(0);
  });

  test("UI — error path — Rejected by mistake: R shows Rejected · Undo, folds into Rejected (1) after 10 s, Restore brings it back as Suggested", async ({ page }) => {
    await openCall(page, quiet());
    await rowOf(page, REPLAY).focus();
    await page.keyboard.press("r");
    expect(await sent(page, "item_review")).toEqual([expect.objectContaining({ item_id: "itm_replay", decision: "reject" })]);
    await expect(rowOf(page, REPLAY)).toContainText("Rejected");
    await expect(button(rowOf(page, REPLAY), "Undo")).toBeVisible();
    await expect(page.getByRole("button", { name: /Rejected \(1\)/ })).toBeVisible({ timeout: 14_000 }); // the outcome expires after 10 s
    await page.getByRole("button", { name: /Rejected \(1\)/ }).click();
    await button(rowOf(page, REPLAY), "Restore").click();
    expect((await sent(page, "item_review")).at(-1)).toMatchObject({ item_id: "itm_replay", decision: "restore" });
    await expect(rowOf(page, REPLAY).getByText("Suggested")).toBeVisible();
  });

  test("UI — Undo on Rejected · Undo reverses the rejection through the core change", async ({ page }) => {
    await openCall(page, quiet());
    await rowOf(page, REPLAY).focus();
    await page.keyboard.press("r");
    await button(rowOf(page, REPLAY), "Undo").click();
    expect(await sent(page, "change_undo")).toEqual([{ target: { type: "change", change_id: expect.any(String) } }]);
    await expect(rowOf(page, REPLAY).getByText("Suggested")).toBeVisible();
  });

  test("UI — empty path — Nothing to review: no banner, no Accept All, no “to review” count", async ({ page }) => {
    await openCall(page, quiet(allAccepted));
    await expect(rowOf(page, DECISION)).toBeVisible(); // the page has loaded its items
    await expect(page.getByText(/suggested items? to review/)).toHaveCount(0);
    await expect(button(page, "Accept All")).toHaveCount(0);
    await expect(page.getByText(/to review/)).toHaveCount(0);
  });

  test("UI — Other — Accept everything at once: Accept All sends every kind, the banner and tags go, Undo reverses the batch", async ({ page }) => {
    await openCall(page, quiet());
    await button(banner(page), "Accept All").click();
    expect(await sent(page, "items_review_all")).toEqual([{ call_id: W.LIVE_CALL, kinds: [] }]);
    await expect(strip(page)).toContainText("Accepted 3 suggested items");
    await expect(banner(page).getByText(/suggested items to review/)).toHaveCount(0);
    await expect(page.getByText("Suggested", { exact: true })).toHaveCount(0);
    await button(strip(page), "Undo").click();
    expect(await sent(page, "change_undo")).toEqual([{ target: { type: "batch", batch_id: expect.any(String) } }]); // one batch, one undo
    await expect(banner(page)).toContainText("3 suggested items to review before sharing");
  });

  test("UI — Other — Review in the Item inspector: Edit on a suggested decision opens it with Linked issue, Accept and Reject; Save then Accept", async ({ page }) => {
    await openCall(page, quiet((w) => review(w, "itm_notif", "suggested")));
    await button(rowOf(page, DECISION), "Edit").click();
    const inspector = page.locator(INSPECTOR);
    await expect(inspector.getByRole("textbox", { name: /text/i }).first()).toBeVisible();
    await expect(inspector.getByText("Linked issue")).toBeVisible();
    await expect(inspector.getByText("Suggested")).toBeVisible();
    await expect(button(inspector, "Accept")).toBeVisible();
    await expect(button(inspector, "Reject")).toBeVisible();
    await inspector.getByRole("textbox", { name: /text/i }).first().fill("Drawer events go through the notification service");
    await button(inspector, "Save").click();
    await expect(inspector.getByText("Saved", { exact: true })).toBeVisible();
    expect(await sent(page, "item_review")).toHaveLength(0); // saving never accepts
    await button(inspector, "Accept").click();
    expect(await sent(page, "item_review")).toEqual([expect.objectContaining({ item_id: "itm_notif", decision: "accept" })]);
  });

  test("UI — error path: a refused item_review keeps the row Suggested and shows no success status", async ({ page }) => {
    const steer = await openCall(page, quiet());
    await steer.failNext("item_review", "conflict");
    await rowOf(page, REPLAY).focus();
    await page.keyboard.press("a");
    await expect(rowOf(page, REPLAY).getByText("Suggested")).toBeVisible();
    await expect(rowOf(page, REPLAY).getByText("Accepted", { exact: true })).toHaveCount(0);
    await expect.poll(async () => (await sent(page, "item_get")).length).toBeGreaterThan(0); // conflict refreshes the item
  });

  test("UI — error path — Regenerated after review: Regenerate keeps accepted items, rejected ones are not suggested again and the meta line says so", async ({ page }) => {
    await openCall(page, quiet());
    await rowOf(page, REPLAY).focus();
    await page.keyboard.press("a");
    await rowOf(page, A11Y).focus();
    await page.keyboard.press("r");
    await toolbar(page).getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Regenerate Outputs…" }).click();
    const sheet = page.getByRole("dialog", { name: /Regenerate/ });
    await expect(sheet).toContainText("Your edits are kept and shown as a diff.");
    await button(sheet, "Regenerate").click();
    await expect(page.getByText("1 item not suggested again because you rejected it")).toBeVisible();
    await expect(rowOf(page, REPLAY)).toBeVisible(); // accepted, kept
    await expect(rowOf(page, A11Y).getByText("Suggested")).toHaveCount(0);
  });
});

test.describe("cpt-noter-seq-call-page-check-evidence", () => {
  const SPAN_MS = 1_272_000; // the decision's evidence, 00:21:12
  test("UI — happy path: the evidence time opens Transcript at that span with the line highlighted, ⌘[ returns to Summary", async ({ page }) => {
    await openCall(page, quiet());
    await button(rowOf(page, DECISION), "00:21:12").click();
    await expect(page.getByRole("heading", { name: "Transcript" }).or(page.getByRole("tab", { name: "Transcript", selected: true })).first()).toBeVisible();
    expect(await sent(page, "transcript_span")).toContainEqual(expect.objectContaining({ span: expect.objectContaining({ call_id: W.LIVE_CALL, t0_ms: SPAN_MS }) }));
    const line = '[data-component="cpt-noter-component-ui-transcript-segment-row"]';
    await expect(page.locator(`${line}[aria-current="true"], ${line}[data-highlighted="true"]`).first()).toBeVisible();
    await page.keyboard.press("Meta+[");
    await expect(page.getByRole("tab", { name: "Summary", selected: true }).or(page.getByRole("radio", { name: "Summary", checked: true }))).toBeVisible();
  });

  test("UI — error path — Audio deleted by retention: the line shows with the deletion date and no play controls", async ({ page }) => {
    await openCall(
      page,
      quiet((w) => {
        for (const c of [w.calls.find((x) => x.id === W.PAST_CALL)!, w.call_details.find((d) => d.call.id === W.PAST_CALL)!.call]) Object.assign(c, { audio_deleted: true, audio_deleted_at: 1_790_000_000_000 });
      }),
      W.PAST_CALL,
    );
    await button(page, /^\d\d:\d\d:\d\d$/).first().click(); // an item's evidence time on the Backend sync page
    await expect(page.getByText(/Audio deleted on .* \(kept 30 days\) · transcript kept/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Play/ })).toHaveCount(0);
  });

  test("UI — error path — Transcript upgraded by the archive pass: the banner offers Show Diff and the diff header names the changes", async ({ page }) => {
    await openCall(page, quiet(archive("done")), W.PAST_CALL);
    await expect(banner(page)).toContainText(/Transcript upgraded · the archive pass changed \d+ words and \d+ speaker labels/);
    await button(banner(page), "Show Diff").click();
    await expect(page.getByText(/archive pass, \d+ words and \d+ speaker labels in the whole call/)).toBeVisible();
    await button(page, "Hide Archive Changes").click();
    await button(page, "Show Archive Changes").click();
    await expect(page.locator("ins, del").first()).toBeVisible();
  });

  test("UI — error path — Archive transcript pending: the banner shows and evidence resolves on the live transcript", async ({ page }) => {
    await openCall(page, quiet(archive("failed")), W.PAST_CALL);
    await expect(banner(page)).toContainText("Archive transcript pending");
    await button(page, /^\d\d:\d\d:\d\d$/).first().click();
    expect(await sent(page, "transcript_span")).toHaveLength(1);
    await expect(page.locator('[data-component="cpt-noter-component-ui-transcript-segment-row"]').first()).toBeVisible();
  });

  test("UI — Other — Edit an item in the Item inspector: Details, Due from the calendar, Save shows Saved and sends item_edit with only the changed field", async ({ page }) => {
    await openCall(page, quiet());
    await button(rowOf(page, "Drawer redesign spec"), /info|details/i).click();
    const inspector = page.locator(INSPECTOR);
    await expect(inspector.getByRole("tab", { name: "Details" })).toBeVisible();
    await expect(inspector.getByRole("tab", { name: "History" })).toBeVisible();
    for (const label of ["Owner", "Due", "Status", "Linked issue", "Evidence"]) await expect(inspector.getByText(label).first()).toBeVisible();
    await button(inspector, /calendar/i).click();
    await page.getByRole("button", { name: /^17\b/ }).click(); // 17 in the month shown
    await expect(inspector.getByRole("textbox", { name: /Due/ })).toHaveValue(/17/);
    await button(inspector, "Save").click();
    await expect(inspector.getByText("Saved", { exact: true })).toBeVisible();
    const edits = await sent(page, "item_edit");
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ item_id: "itm_spec", patch: { due: { type: "set" } } });
  });

  test("UI — Add Action Item on an empty section adds it accepted and owned by the user (item_create)", async ({ page }) => {
    await openCall(page, quiet((w) => (w.items = w.items.filter((i) => !(i.call.id === W.LIVE_CALL && i.kind === "action_item")))));
    await button(page, "Add Action Item").click();
    await page.getByPlaceholder("What needs doing, and who does it?").fill("Send the drawer spec to Anna");
    await page.keyboard.press("Enter");
    const created = await sent(page, "item_create");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ call_id: W.LIVE_CALL, kind: "action_item" });
    await expect(rowOf(page, "Send the drawer spec to Anna")).toBeVisible();
  });
});
