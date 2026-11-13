// M2 — Items (docs/features/ui/items.md, DESIGN.md › Screen — Call page PC-R2/PC-R3, Item inspector II-R1/II-R2). Stories:
// `cpt-noter-seq-call-page-review-suggested-items` and `cpt-noter-seq-call-page-check-evidence`. Commands: items_list,
// item_get, item_review, items_review_all, item_edit, item_create, transcript_span, change_undo. The starting state is the
// past call "Backend sync" with its outputs written (support/outputs-world.ts, both cores) and some items suggested.
// Not here: Regenerate-after-review (2.18 regenerate), archive pending/upgraded banners (no Call page banner yet) and handoff answers (2.21).
import type { Locator, Page } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { calls, coreReady, openWindow } from "./support/app";
import * as O from "./support/outputs-world";
import { expect, test } from "./support/fixtures";

const ROW = '[data-component="cpt-noter-component-ui-action-item-row"], [data-component="cpt-noter-component-ui-output-item-row"]';
const STRIP = '[data-component="cpt-noter-component-ui-undo-strip"]';
const INSPECTOR = '[data-component="cpt-noter-component-ui-item-inspector"]';
const toolbar = (page: Page) => page.locator('[data-region="PC-R1"]');
const banner = (page: Page) => page.locator('[data-region="PC-R2"]');
const rowOf = (page: Page, text: string | RegExp) => page.locator(ROW).filter({ hasText: text });
const byId = (page: Page, id: string) => page.locator(`[data-item-id="${id}"]`); // an editing row holds its text in a field
const strip = (page: Page) => page.locator(STRIP);
const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name });
const sent = async (page: Page, name: string): Promise<Array<Record<string, unknown>>> =>
  (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args as Record<string, unknown>);
/** The change a mutation of `itemId` logged last, as the core's History lists it (item_review's ItemMutation carries the same id). */
async function lastChange(page: Page, itemId: string): Promise<string> {
  const read = () => page.evaluate(
    async ([id]) => {
      const args = { target: { type: "item", item_id: id }, actor: "all", job_id: null, page: {} };
      const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
      return (await (g.__noterFake ? g.__noterFake.invoke("history_list", args) : g.__TAURI_INTERNALS__!.invoke("history_list", { args }))) as { rows: Array<{ id: string }> };
    },
    [itemId],
  );
  // item_review answers before History lists its change: wait for the row instead of reading once
  await expect.poll(async () => (await read()).rows.length).toBeGreaterThan(0);
  return (await read()).rows[0]!.id;
}

const DECISION = "Ship drawer events behind a flag"; // itm_d1
const A0 = "Rotate the staging Jira token"; // itm_a0
const SPEC = "Update the drawer spec"; // itm_a3, accepted
const TIME = /Open the source at \d\d:\d\d:\d\d/;

/** The written outputs with these items suggested (LLM-made, not reviewed). */
const suggest =
  (...ids: string[]) =>
  (w: World) => {
    O.written(w);
    for (const i of O.outputsOf(w).sections.flatMap((s) => s.items)) {
      if (ids.includes(i.id)) Object.assign(i, { review: "suggested", created_by: "llm" });
      i.spans = [{ call_id: W.PAST_CALL, channel: null, t0_ms: 12_000, t1_ms: 20_000 }]; // the first line of the stored transcript
    }
    O.outputsOf(w).review_waiting = ids.length;
  };
const three = suggest("itm_d1", "itm_a0", "itm_a1");
/** Library › Calls (⌘3), then Backend sync the way the core opens it (`window_navigate` → `nav:request`) on `tab`. */
async function openCall(page: Page, world: (w: World) => void, tab: "summary" | "transcript" = "summary") {
  const steer = await openWindow(page, "main", { world });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit3");
    await expect(page.getByRole("heading", { name: "Calls", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await coreReady(page);
  await page.evaluate(
    async ([id, view]) => {
      const args = { target: { type: "call_page", call_id: id, tab: view } };
      const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
      await (g.__noterFake ? g.__noterFake.invoke("window_navigate", args) : g.__TAURI_INTERNALS__!.invoke("window_navigate", { args }));
    },
    [W.PAST_CALL, tab],
  );
  await expect(toolbar(page)).toContainText(O.TITLE);
  return steer;
}

test.describe("cpt-noter-seq-call-page-review-suggested-items", () => {
  test("UI — repeated checkbox clicks and Space wait for completion before an untick", async ({ page }) => {
    await openCall(page, three);
    await page.evaluate(() => {
      type Host = { invoke(cmd: string, ...args: unknown[]): Promise<unknown> };
      const g = globalThis as unknown as { __noterFake?: Host; __TAURI_INTERNALS__?: Host; releaseCompletion?: () => void; completionAttempts: number };
      const host = g.__noterFake ?? g.__TAURI_INTERNALS__!;
      const invoke = host.invoke.bind(host);
      g.completionAttempts = 0;
      host.invoke = async (cmd, ...args) => {
        if (cmd === "item_set_done") {
          g.completionAttempts++;
          await new Promise<void>((resolve) => { g.releaseCompletion = resolve; });
          host.invoke = invoke;
        }
        return invoke(cmd, ...args);
      };
    });
    const row = byId(page, "itm_a0");
    const box = row.getByRole("checkbox");
    await row.locator(".np-check").dblclick();
    await expect(box).toBeDisabled();
    await page.keyboard.press("Space");
    expect(await page.evaluate(() => (globalThis as unknown as { completionAttempts: number }).completionAttempts)).toBe(1);
    await expect(row.getByText("Accepted and done", { exact: true })).toHaveCount(0);
    await page.evaluate(() => (globalThis as unknown as { releaseCompletion: () => void }).releaseCompletion());
    await expect(row.getByText("Accepted and done", { exact: true })).toBeVisible();
    await expect(box).toBeEnabled();
    await expect(box).toBeChecked();
    await row.locator(".np-check").click();
    await expect(box).not.toBeChecked();
    await expect(row.getByRole("alert")).toHaveCount(0);
    const mutations = await sent(page, "item_set_done");
    expect(mutations).toHaveLength(2);
    expect(mutations[0]).toMatchObject({ item_id: "itm_a0", done: true });
    expect(mutations[1]).toMatchObject({ item_id: "itm_a0", done: false });
    expect(Number(mutations[1]!.rev)).toBeGreaterThan(Number(mutations[0]!.rev));
  });

  test("UI — happy path: the banner counts the suggested items, Start Review focuses the first one, A accepts it and moves on", async ({ page }) => {
    await openCall(page, three);
    await expect(banner(page)).toContainText("3 suggested items to review before sharing");
    await expect(page.getByRole("region", { name: "Action items" }).getByText("2 to review")).toBeVisible();
    await button(banner(page), "Start Review").click();
    await expect(rowOf(page, DECISION)).toBeFocused();
    await page.keyboard.press("a");
    expect(await sent(page, "item_review")).toEqual([expect.objectContaining({ item_id: "itm_d1", decision: "accept", rev: expect.any(Number) })]);
    await expect(rowOf(page, DECISION).getByText("Accepted", { exact: true })).toBeVisible();
    await expect(rowOf(page, A0)).toBeFocused(); // the next suggested row
  });

  test("UI — happy path: E turns a suggested row into fields, ⌘Return saves and accepts (Saved and accepted)", async ({ page }) => {
    await openCall(page, three);
    await rowOf(page, A0).focus();
    await page.keyboard.press("e");
    const row = byId(page, "itm_a0");
    await expect(row.getByText("Owner")).toBeVisible();
    await expect(row.getByText("Due")).toBeVisible();
    await expect(button(row, "Cancel")).toBeVisible();
    await row.getByRole("textbox").first().fill("Rotate the staging Jira token today");
    await page.keyboard.press("Meta+Enter");
    await expect(row.getByText("Saved and accepted")).toBeVisible();
    expect(await sent(page, "item_edit")).toEqual([expect.objectContaining({ item_id: "itm_a0" })]);
    expect(await sent(page, "item_review")).toEqual([expect.objectContaining({ item_id: "itm_a0", decision: "accept" })]); // after the edit, with its new rev
  });

  test("UI — Esc discards the edit draft and sends nothing", async ({ page }) => {
    await openCall(page, three);
    await rowOf(page, A0).focus();
    await page.keyboard.press("e");
    await byId(page, "itm_a0").getByRole("textbox").first().fill("changed");
    await page.keyboard.press("Escape");
    await expect(rowOf(page, A0)).toContainText(A0);
    expect(await sent(page, "item_edit")).toHaveLength(0);
  });

  test("UI — happy path: ⇧A on a suggested decision accepts that kind as one batch with Accepted … · Undo", async ({ page }) => {
    await openCall(page, three);
    await rowOf(page, DECISION).focus();
    await page.keyboard.press("Shift+a");
    expect(await sent(page, "items_review_all")).toEqual([{ call_id: W.PAST_CALL, kinds: ["decision"] }]);
    await expect(strip(page)).toContainText(/Accepted 1/);
    await expect(strip(page).getByRole("link", { name: "Undo" }).or(button(strip(page), "Undo"))).toBeVisible();
    await expect(rowOf(page, DECISION).getByText("Suggested")).toHaveCount(0);
  });

  test("UI — error path — Rejected by mistake: R shows Rejected · Undo, folds into Rejected (1) after 10 s, Restore brings it back as Suggested", async ({ page }) => {
    await page.clock.install();
    await openCall(page, three);
    await rowOf(page, A0).focus();
    await page.keyboard.press("r");
    expect(await sent(page, "item_review")).toEqual([expect.objectContaining({ item_id: "itm_a0", decision: "reject" })]);
    await expect(rowOf(page, A0)).toContainText("Rejected");
    await expect(rowOf(page, A0).getByRole("link", { name: "Undo" })).toBeVisible();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000)); // from here the page's clock moves only when told
    await page.clock.fastForward(7000);
    await expect(rowOf(page, A0).getByRole("link", { name: "Undo" })).toBeVisible(); // still inside the 10 s
    await page.clock.fastForward(3000);
    await expect(page.getByRole("button", { name: /Rejected \(1\)/ })).toBeVisible(); // the outcome expired after 10 s
    await page.getByRole("button", { name: /Rejected \(1\)/ }).click();
    await button(page, "Restore").click();
    expect((await sent(page, "item_review")).at(-1)).toMatchObject({ item_id: "itm_a0", decision: "restore" });
    await expect(rowOf(page, A0).getByText("Suggested")).toBeVisible();
  });

  test("UI — Undo on Rejected · Undo reverses the rejection through the core change", async ({ page }) => {
    await openCall(page, three);
    await rowOf(page, A0).focus();
    await page.keyboard.press("r");
    const rejection = await lastChange(page, "itm_a0"); // the change item_review returned for the rejection
    await rowOf(page, A0).getByRole("link", { name: "Undo" }).click();
    expect(await sent(page, "change_undo")).toEqual([{ target: { type: "change", change_id: rejection } }]);
    await expect(rowOf(page, A0).getByText("Suggested")).toBeVisible();
  });

  test("UI — empty path — Nothing to review: no banner, no Accept All, no “to review” count", async ({ page }) => {
    await openCall(page, suggest());
    await expect(rowOf(page, DECISION)).toBeVisible(); // the page has loaded its items
    await expect(page.getByText(/suggested items? to review/)).toHaveCount(0);
    await expect(button(page, "Accept All")).toHaveCount(0);
    await expect(page.getByText(/to review/)).toHaveCount(0);
  });

  test("UI — Other — Accept everything at once: Accept All sends every kind, the banner goes, Undo reverses the batch", async ({ page }) => {
    await openCall(page, three);
    await button(banner(page), "Accept All").click();
    expect(await sent(page, "items_review_all")).toEqual([{ call_id: W.PAST_CALL, kinds: [] }]);
    await expect(strip(page)).toContainText("Accepted 3 suggested items");
    await expect(banner(page).getByText(/suggested items to review/)).toHaveCount(0);
    await strip(page).getByRole("link", { name: "Undo" }).or(button(strip(page), "Undo")).click();
    expect(await sent(page, "change_undo")).toEqual([{ target: { type: "batch", batch_id: expect.any(String) } }]); // one batch, one undo
    await expect(banner(page)).toContainText("3 suggested items to review before sharing");
  });

  test("UI — Other — Review in the Item inspector: Edit on a suggested decision opens it with Linked issue, Accept and Reject; Save never accepts", async ({ page }) => {
    await openCall(page, three);
    await button(rowOf(page, DECISION), "Edit").click();
    const inspector = page.locator(INSPECTOR);
    await expect(inspector.getByRole("textbox", { name: "Item text" })).toBeVisible();
    await expect(inspector.getByText("Linked issue")).toBeVisible();
    await expect(inspector.getByText("Owner")).toHaveCount(0); // a decision has no Owner, Due, Status or Engineering
    await expect(button(inspector, "Accept")).toBeVisible();
    await expect(button(inspector, "Reject")).toBeVisible();
    await inspector.getByRole("textbox", { name: "Item text" }).fill("Ship drawer events behind a flag, 8.0");
    await button(inspector, "Save").click();
    await expect(inspector.getByText("Saved", { exact: true })).toBeVisible();
    expect(await sent(page, "item_review")).toHaveLength(0); // saving never accepts
    await button(inspector, "Accept").click();
    expect(await sent(page, "item_review")).toEqual([expect.objectContaining({ item_id: "itm_d1", decision: "accept" })]);
  });

  test("UI — error path: a refused item_review keeps the row Suggested, shows no success status and reads the item again", async ({ page }) => {
    const steer = await openCall(page, three);
    await steer.failNext("item_review", "conflict");
    await rowOf(page, A0).focus();
    await page.keyboard.press("a");
    await expect(rowOf(page, A0).getByText("Suggested")).toBeVisible();
    await expect(rowOf(page, A0).getByText("Accepted", { exact: true })).toHaveCount(0);
    await expect.poll(async () => (await sent(page, "item_get")).length).toBeGreaterThan(0); // conflict refreshes the item
  });
});

test.describe("cpt-noter-seq-call-page-check-evidence", () => {
  for (const colorScheme of ["light", "dark"] as const) test(`UI — Escape closes the inspector after invalid Save (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await openCall(page, suggest());
    await button(rowOf(page, SPEC), "Show in Item inspector").click();
    const inspector = page.locator(INSPECTOR);
    await inspector.getByRole("textbox", { name: "Item text" }).fill("");
    await button(inspector, "Save").click();
    await expect(inspector.getByRole("alert")).toBeVisible();
    expect(await sent(page, "item_edit")).toHaveLength(0);
    await page.keyboard.press("Escape");
    await expect(inspector).toHaveCount(0);
    await expect(rowOf(page, SPEC)).toBeFocused();
  });

  for (const submit of ["button", "keyboard"] as const) test(`UI — inspector locks its draft while Save is pending and unlocks after success (${submit})`, async ({ page }) => {
    await openCall(page, suggest());
    await button(rowOf(page, SPEC), "Show in Item inspector").click();
    const inspector = page.locator(INSPECTOR);
    const text = inspector.getByRole("textbox", { name: "Item text" });
    await text.fill("Save this draft");
    await page.evaluate(() => {
      type Host = { invoke(cmd: string, ...args: unknown[]): Promise<unknown> };
      const g = globalThis as unknown as { __noterFake?: Host; __TAURI_INTERNALS__?: Host; releaseItemSave?: () => void };
      const host = g.__noterFake ?? g.__TAURI_INTERNALS__!;
      const invoke = host.invoke.bind(host);
      host.invoke = async (cmd, ...args) => {
        if (cmd === "item_edit") await new Promise<void>((resolve) => { g.releaseItemSave = resolve; });
        return invoke(cmd, ...args);
      };
    });
    if (submit === "keyboard") await text.press("Meta+Enter");
    else await button(inspector, "Save").click();
    await expect(text).toBeDisabled();
    await expect(inspector.locator('input[type="date"]')).toBeDisabled();
    await expect(inspector.getByRole("textbox", { name: "Linked issue" })).toBeDisabled();
    await page.evaluate(() => (globalThis as unknown as { releaseItemSave: () => void }).releaseItemSave());
    await expect(inspector.getByText("Saved", { exact: true })).toBeVisible();
    await expect(text).toBeEnabled();
    await expect(text).toHaveValue("Save this draft");
    await text.fill("A later draft");
    await expect(button(inspector, "Save")).toBeEnabled();
  });

  test("UI — inspector retains a conflicting draft and requires a second explicit Save", async ({ page }) => {
    await openCall(page, suggest());
    await button(rowOf(page, SPEC), "Show in Item inspector").click();
    const inspector = page.locator(INSPECTOR);
    await inspector.getByRole("textbox", { name: "Item text" }).fill("My unsaved update");
    await page.evaluate(async () => {
      const g = globalThis as unknown as { __noterFake?: { invoke(c: string, a: unknown): Promise<unknown> }; __TAURI_INTERNALS__?: { invoke(c: string, p: unknown): Promise<unknown> } };
      const invoke = (cmd: string, args: unknown) => g.__noterFake ? g.__noterFake.invoke(cmd, args) : g.__TAURI_INTERNALS__!.invoke(cmd, { args });
      const detail = await invoke("item_get", { item_id: "itm_a3" }) as { item: { rev: number } };
      await invoke("item_edit", { item_id: "itm_a3", rev: detail.item.rev, patch: { text: "Concurrent update" } });
    });
    await expect(rowOf(page, "Concurrent update")).toBeVisible();
    await button(inspector, "Save").click();
    await expect(inspector.getByRole("alert")).toContainText("Item changed since");
    await expect(inspector.getByRole("textbox", { name: "Item text" })).toHaveValue("My unsaved update");
    await expect(rowOf(page, "Concurrent update")).toBeVisible();
    await button(inspector, "Save").click();
    await expect(inspector.getByText("Saved", { exact: true })).toBeVisible();
    await expect(rowOf(page, "My unsaved update")).toBeVisible();
  });

  test("UI — switching inspectors discards the previous item's unsaved draft", async ({ page }) => {
    await openCall(page, suggest());
    await button(rowOf(page, SPEC), "Show in Item inspector").click();
    const inspector = page.locator(INSPECTOR);
    await inspector.getByRole("textbox", { name: "Item text" }).fill("Unsaved draft for the first item");
    await button(rowOf(page, A0), "Show in Item inspector").click();
    await expect(inspector.getByRole("textbox", { name: "Item text" })).toHaveValue(A0);
    await expect(button(inspector, "Save")).toBeDisabled();
    expect(await sent(page, "item_edit")).toHaveLength(0);
  });

  test("UI — happy path: the evidence time opens Transcript at that span with the line highlighted, ⌘[ returns to Summary", async ({ page }) => {
    await openCall(page, suggest());
    await button(rowOf(page, DECISION), TIME).click();
    await expect(page.getByRole("tab", { name: "Transcript", selected: true })).toBeVisible();
    // the chip resolves the span, and the Transcript reads it again for its archive note
    const spans = await sent(page, "transcript_span");
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((c) => (c.span as { call_id: string }).call_id === W.PAST_CALL)).toBe(true);
    const line = '[data-component="cpt-noter-component-ui-transcript-segment-row"]';
    await expect(page.locator(`${line}[data-state="highlighted"], ${line}.np-hl-evidence`).first()).toBeVisible();
    await page.keyboard.press("Meta+[");
    await expect(page.getByRole("tab", { name: "Summary", selected: true })).toBeVisible();
  });

  test("UI — the evidence highlight expires after 3 s even while store events keep arriving", async ({ page }) => {
    const steer = await openCall(page, suggest());
    await button(rowOf(page, DECISION), TIME).click();
    const lit = page.locator('[data-component="cpt-noter-component-ui-transcript-segment-row"].np-hl-evidence');
    await expect(lit.first()).toBeVisible();
    const spans = (await sent(page, "transcript_span")).length;
    // each event re-renders the main window; the span prop must not restart the timer. The real core refuses to
    // change world state from a test (harness.world_set), so there the highlight is checked without events.
    const real = process.env.NOTER_CORE === "stdio";
    const busy = (async () => {
      for (let i = 0; i < 12 && !real; i++) {
        await steer.change((w) => (w.app.setup.detection_enabled = i % 2 === 0));
        await page.waitForTimeout(400);
      }
    })();
    await expect(lit).toHaveCount(0, { timeout: 4_500 });
    await busy;
    expect((await sent(page, "transcript_span")).length).toBe(spans); // no new read for the same span
  });

  test("UI — error path — Audio deleted by retention: the line shows, the call says the audio is deleted and no play control is offered", async ({ page }) => {
    await openCall(page, (w) => {
      O.written(w);
      for (const c of [w.calls.find((x) => x.id === W.PAST_CALL)!, w.call_details.find((d) => d.call.id === W.PAST_CALL)!.call]) Object.assign(c, { audio_deleted: true, audio_deleted_at: 1_790_000_000_000 });
    });
    await button(rowOf(page, DECISION), TIME).click();
    await expect(page.getByText(/Audio deleted on .+ · transcript kept/).first()).toBeVisible(); // the Transcript header names the day
    await expect(page.getByRole("button", { name: /^Play/ })).toHaveCount(0);
  });

  test("UI — happy path: the inspector's evidence time resolves the span, opens Transcript on it and the inspector keeps the quote", async ({ page }) => {
    await openCall(page, suggest("itm_d1"));
    await button(rowOf(page, DECISION), "Edit").click();
    const inspector = page.locator(INSPECTOR);
    await expect(inspector.getByText("Evidence")).toBeVisible();
    await button(inspector, TIME).click();
    await expect(page.getByRole("tab", { name: "Transcript", selected: true })).toBeVisible();
    // the chip resolves the span, and the Transcript reads it again for its archive note
    const spans = await sent(page, "transcript_span");
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((c) => (c.span as { call_id: string }).call_id === W.PAST_CALL)).toBe(true);
  });

  test("UI — error path — Audio deleted by retention, from the inspector: the quote stays readable and no play control is offered", async ({ page }) => {
    await openCall(page, (w) => {
      suggest("itm_d1")(w);
      for (const c of [w.calls.find((x) => x.id === W.PAST_CALL)!, w.call_details.find((d) => d.call.id === W.PAST_CALL)!.call]) Object.assign(c, { audio_deleted: true, audio_deleted_at: 1_790_000_000_000 });
    });
    await button(rowOf(page, DECISION), "Edit").click();
    await button(page.locator(INSPECTOR), TIME).click();
    await expect(page.getByText(/Audio deleted on .+ · transcript kept/).first()).toBeVisible(); // the Transcript header names the day
    await expect(page.getByRole("button", { name: /^Play/ })).toHaveCount(0);
  });

  /** The evidence span's words as the live pass wrote them and, once the archive pass is `done`, as it rewrote them. */
  const archiveWorld = (archive: "done" | "pending") => (w: World) => {
    three(w);
    const line = { call_id: W.PAST_CALL, channel: "sys" as const, speaker: { speaker_id: "spk_pavel", label: { type: "person" as const, person: { id: "per_pavel", display_name: "Pavel Romanov", short_name: "Pavel", initials: "PR", is_you: false } } }, crosstalk_with: [], t0_ms: 12_000, t1_ms: 20_000, lang: "en", lang_p: 0.93, confidence: 0.95, state: "confirmed" as const, corrections: [] };
    const segments = [
      { ...line, id: "seg_live", pass: "live" as const, text: "ship it friday" },
      ...(archive === "done" ? [{ ...line, id: "seg_arch", pass: "archive" as const, text: "ship it on Friday" }] : []),
    ];
    w.transcripts = w.transcripts.filter((x) => x.call_id !== W.PAST_CALL);
    const tr = { subscription_id: null, call_id: W.PAST_CALL, live: false, pass: archive === "done" ? ("archive" as const) : ("live" as const), archive, segments, hypotheses: [], marks: [], gaps: [], speakers: [], last_seq: segments.length, audio_available: true };
    w.transcripts.push(tr as never);
    for (const c of [w.calls.find((x) => x.id === W.PAST_CALL)!, w.call_details.find((d) => d.call.id === W.PAST_CALL)!.call]) c.archive = archive;
  };

  test("UI — error path — Transcript upgraded by the archive pass: the notice names it and Show/Hide Archive Changes shows the words before and after", async ({ page }) => {
    await openCall(page, archiveWorld("done"));
    await button(rowOf(page, DECISION), "Edit").click();
    await button(page.locator(INSPECTOR), TIME).click();
    await expect(page.getByText("Words changed by the archive pass")).toBeVisible();
    await page.getByRole("button", { name: "Show Archive Changes" }).click();
    const diff = page.locator('[data-component="cpt-noter-component-ui-diff-view"]');
    await expect(diff).toContainText("friday");
    await expect(diff).toContainText("on Friday");
    await page.getByRole("button", { name: "Hide Archive Changes" }).click();
    await expect(diff).toHaveCount(0);
  });

  test("UI — error path — Archive transcript pending: the evidence opens the live span, with no archive notice", async ({ page }) => {
    await openCall(page, archiveWorld("pending"));
    await button(rowOf(page, DECISION), "Edit").click();
    await button(page.locator(INSPECTOR), TIME).click();
    await expect(page.getByRole("tab", { name: "Transcript", selected: true })).toBeVisible();
    await expect(page.getByText("Words changed by the archive pass")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show Archive Changes" })).toHaveCount(0);
  });

  test("UI — Other — Edit an item in the Item inspector: Details, Due, Save shows Saved and sends item_edit with only the changed field", async ({ page }) => {
    await openCall(page, suggest());
    await button(rowOf(page, SPEC), "Show in Item inspector").click();
    const inspector = page.locator(INSPECTOR);
    await expect(inspector.getByRole("tab", { name: "Details" })).toBeVisible();
    await expect(inspector.getByRole("tab", { name: "History" })).toBeVisible();
    for (const label of ["Owner", "Due", "Status", "Linked issue", "Evidence"]) await expect(inspector.getByText(label, { exact: true }).first()).toBeVisible();
    await inspector.locator('input[type="date"]').fill("2026-10-17");
    await button(inspector, "Save").click();
    await expect(inspector.getByText("Saved", { exact: true })).toBeVisible();
    const edits = await sent(page, "item_edit");
    expect(edits).toEqual([expect.objectContaining({ item_id: "itm_a3", patch: { due: { type: "set", date: "2026-10-17" } } })]);
    await inspector.getByRole("tab", { name: "History" }).click();
    expect((await sent(page, "history_list")).length).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(inspector).toHaveCount(0);
    await expect(rowOf(page, SPEC)).toBeFocused(); // focus returns to the row
  });

  test("UI — Add Action Item ignores a second submit while item_create is in flight", async ({ page }) => {
    await openCall(page, (w) => {
      O.written(w);
      const s = O.sectionOf(w, "action_items");
      s.items = [];
      s.state = { type: "empty" };
      w.items = w.items.filter((i) => !(i.call.id === W.PAST_CALL && i.kind === "action_item"));
    });
    await button(page, "Add Action Item").click();
    const field = page.getByPlaceholder("What needs doing, and who does it?");
    await field.fill("Send the drawer spec to Anna");
    await page.evaluate(() => {
      const win = globalThis as unknown as {
        __noterFake: { invoke: (command: string, args: unknown) => Promise<unknown> };
        __itemCreateStarted: Promise<void>;
        __releaseItemCreate: () => void;
      };
      let started!: () => void;
      let release!: () => void;
      win.__itemCreateStarted = new Promise((resolve) => (started = resolve));
      win.__releaseItemCreate = () => release();
      const invoke = win.__noterFake.invoke.bind(win.__noterFake);
      win.__noterFake.invoke = async (command, args) => {
        if (command === "item_create") {
          started();
          await new Promise<void>((resolve) => (release = resolve));
        }
        return invoke(command, args);
      };
    });
    await page.keyboard.press("Enter");
    await page.evaluate(() => (globalThis as unknown as { __itemCreateStarted: Promise<void> }).__itemCreateStarted);
    await expect(field).toBeDisabled();
    await page.evaluate(() => document.querySelector<HTMLInputElement>('[placeholder="What needs doing, and who does it?"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await expect.poll(async () => (await sent(page, "item_create")).length).toBe(1);
    await page.evaluate(() => (globalThis as unknown as { __releaseItemCreate: () => void }).__releaseItemCreate());
    expect(await sent(page, "item_create")).toEqual([{ call_id: W.PAST_CALL, kind: "action_item", text: "Send the drawer spec to Anna" }]);
    // the section is read again for the new row (the fake does not add it to the written outputs; the real core does)
    await expect.poll(async () => (await sent(page, "outputs_get")).length).toBeGreaterThan(1);
  });

  test("UI — Other — Share one item: the row's Share menu copies with that item's id only", async ({ page }) => {
    await openCall(page, suggest());
    await button(rowOf(page, SPEC), "Share item").click();
    await page.getByRole("menuitem", { name: /Slack/ }).click();
    expect(await sent(page, "share_copy")).toEqual([expect.objectContaining({ scope: expect.objectContaining({ item_ids: ["itm_a3"] }) })]);
  });
});
