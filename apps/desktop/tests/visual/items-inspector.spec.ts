// Screenshot specs of the Item inspector (docs/features/ui/items.md › cpt-noter-dod-ui-items-inspector): Details of a
// suggested decision, its History, and the evidence note when the audio is gone, against the fake world. Baselines come
// from the update-screenshots workflow only.
import { expect, test, type Page } from "@playwright/test";

import { coreReady, openWindow } from "../e2e/support/app";
import { outputsOf, written } from "../e2e/support/outputs-world";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { freeze } from "./freeze";

type Fake = { invoke: (cmd: string, args: unknown) => Promise<unknown> };
const INSPECTOR = '[data-component="cpt-noter-component-ui-item-inspector"]';
/** The written outputs with the decision and two action items suggested, each quoting the first stored line. */
const threeSuggested = (w: World) => {
  written(w);
  for (const i of outputsOf(w).sections.flatMap((x) => x.items)) {
    if (["itm_d1", "itm_a0", "itm_a1"].includes(i.id)) Object.assign(i, { review: "suggested", created_by: "llm" });
    i.spans = [{ call_id: W.PAST_CALL, channel: null, t0_ms: 12_000, t1_ms: 20_000 }];
  }
  outputsOf(w).review_waiting = 3;
};
const quiet = (more: (w: World) => void) => (w: World) => {
  W.idle(w);
  w.app.setup.self_test = { type: "passed", at: 1 };
  more(w);
};

async function openInspector(page: Page, more: (w: World) => void) {
  await openWindow(page, "main", { world: quiet(more) });
  await expect(page.locator('[data-region="window"]')).toHaveAttribute("data-state", "ready");
  await coreReady(page);
  await page.evaluate((id) => (globalThis as unknown as { __noterFake: Fake }).__noterFake.invoke("window_navigate", { target: { type: "call_page", call_id: id, tab: "summary" } }), W.PAST_CALL);
  await expect(page.locator('[data-region="PC-R3"]')).toContainText("Ship drawer events behind a flag");
  await page.locator('[data-component="cpt-noter-component-ui-output-item-row"], [data-component="cpt-noter-component-ui-action-item-row"]').filter({ hasText: "Ship drawer events behind a flag" }).getByRole("button", { name: "Edit" }).click();
  await expect(page.locator(INSPECTOR)).toBeVisible();
}
const shot = async (page: Page, name: string) => {
  await page.evaluate(() => ((document.activeElement as HTMLElement | null)?.blur(), scrollTo(0, 0)));
  await expect(page).toHaveScreenshot(`${name}.png`);
};

test.beforeEach(({ page }) => freeze(page));

const archiveWorld = (archive: "done" | "pending") => (w: World) => {
  threeSuggested(w);
  const line = { call_id: W.PAST_CALL, channel: "sys" as const, speaker: { speaker_id: "spk_pavel", label: { type: "person" as const, person: { id: "per_pavel", display_name: "Pavel Romanov", short_name: "Pavel", initials: "PR", is_you: false } } }, crosstalk_with: [], t0_ms: 12_000, t1_ms: 20_000, lang: "en", lang_p: 0.93, confidence: 0.95, state: "confirmed" as const, corrections: [] };
  const segments = [
    { ...line, id: "seg_live", pass: "live" as const, text: "ship it friday" },
    ...(archive === "done" ? [{ ...line, id: "seg_arch", pass: "archive" as const, text: "ship it on Friday" }] : []),
  ];
  w.transcripts = w.transcripts.filter((x) => x.call_id !== W.PAST_CALL);
  w.transcripts.push({ subscription_id: null, call_id: W.PAST_CALL, live: false, pass: archive === "done" ? "archive" : "live", archive, segments, hypotheses: [], marks: [], gaps: [], speakers: [], last_seq: segments.length, audio_available: true } as never);
  for (const c of [w.calls.find((x) => x.id === W.PAST_CALL)!, w.call_details.find((d) => d.call.id === W.PAST_CALL)!.call]) c.archive = archive;
};

test.describe("cpt-noter-dod-ui-items-inspector Item inspector", () => {
  test("details: a suggested decision with Linked issue, evidence and review actions", async ({ page }) => {
    await openInspector(page, threeSuggested);
    await expect(page.locator(INSPECTOR).getByText("Linked issue")).toBeVisible();
    await shot(page, "item-inspector-details");
  });

  test("history: the item's changes, no job filter and no export", async ({ page }) => {
    await openInspector(page, threeSuggested);
    await page.locator(INSPECTOR).getByRole("tab", { name: "History" }).click();
    await expect(page.locator(INSPECTOR).getByRole("button", { name: "Export Log…" })).toHaveCount(0);
    await shot(page, "item-inspector-history");
  });

  test("evidence: the quote stays readable and the note names the deleted audio", async ({ page }) => {
    await openInspector(page, (w) => {
      threeSuggested(w);
      for (const c of w.calls.filter((x) => x.id === W.PAST_CALL)) Object.assign(c, { audio_deleted: true, audio_deleted_at: 1_790_000_000_000 });
      for (const d of w.call_details.filter((x) => x.call.id === W.PAST_CALL)) Object.assign(d.call, { audio_deleted: true, audio_deleted_at: 1_790_000_000_000 });
    });
    await page.locator(INSPECTOR).getByRole("button", { name: /Open the source at/ }).click();
    await expect(page.getByText(/Audio deleted on .+ · transcript kept/).first()).toBeVisible();
    await shot(page, "item-inspector-evidence-audio-deleted");
  });

  test("archive pending: evidence remains on the live transcript", async ({ page }) => {
    await openInspector(page, (w) => archiveWorld("pending")(w));
    await page.locator(INSPECTOR).getByRole("button", { name: /Open the source at/ }).click();
    const tab = page.getByRole("tab", { name: "Transcript", selected: true });
    await expect(tab).toBeVisible();
    await expect(tab).toBeInViewport();
    await expect(page.getByText("Words changed by the archive pass")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show Archive Changes" })).toHaveCount(0);
    await expect(page.getByText("ship it friday")).toBeInViewport();
    await shot(page, "item-inspector-archive-pending");
  });

  test("archive upgraded: evidence shows the changed words", async ({ page }) => {
    await openInspector(page, (w) => archiveWorld("done")(w));
    await page.locator(INSPECTOR).getByRole("button", { name: /Open the source at/ }).click();
    await expect(page.getByText("Words changed by the archive pass")).toBeVisible();
    await page.getByRole("button", { name: "Show Archive Changes" }).click();
    const diff = page.locator('[data-component="cpt-noter-component-ui-diff-view"]');
    await expect(diff).toContainText("friday");
    await expect(diff).toContainText("on Friday");
    await expect(diff).toBeInViewport();
    await expect(diff.getByText("on Friday")).toBeInViewport();
    await shot(page, "item-inspector-archive-upgraded");
  });
});
