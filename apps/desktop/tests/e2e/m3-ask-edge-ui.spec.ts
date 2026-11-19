// Ask edge variants: the real core retrieves, applies privacy and selects the task runtime;
// the fake opens explicitly seeded stored turns because its canned answer does not compute these flags.
import type { Page } from "@playwright/test";

import type { AskAnswer, AskThread, SearchResults } from "../../src/core/bindings";
import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";

const REAL = process.env.NOTER_CORE === "stdio";
const QUESTION = "Can we keep serving reads while it rebuilds?";
// Scripted embedding collision with itm_token; no keyword terms, so every retrieved match is weak.
const MEANING_ONLY = "d r p q q h p";
const WEAK_WARNING = "Based on weak matches. Check the citations before you rely on this answer.";
type Edge = "local" | "sensitive" | "weak";
const thread = (page: Page) => page.locator('[data-region="AK-R3"]');
const answers = (page: Page) => thread(page).locator('[data-component="cpt-noter-component-ui-cited-answer"]');

async function answerEdge(page: Page, edge: Edge): Promise<AskAnswer> {
  const question = edge === "weak" ? MEANING_ONLY : QUESTION;
  await page.setViewportSize({ width: 1400, height: 800 });
  const steer = await openWindow(page, "main", {
    fixedClock: true,
    world(w) {
      W.idle(w);
      if (edge !== "weak") w.calls.forEach((c) => { c.privacy = "sensitive"; });
      if (edge === "local") w.settings.runtimes.search_answers = "local";
      if (!REAL) {
        const fixture = structuredClone(w.ask_threads[0]);
        const answer = fixture.turns[0];
        fixture.id = "ask_edge";
        fixture.title = question;
        answer.question = question;
        answer.answered_locally = edge === "local";
        answer.runtime = edge === "local" ? "local" : "claude_api_key";
        answer.keyword_only = false;
        answer.only_weak_evidence = edge === "weak";
        answer.sensitive_sources_skipped = edge === "sensitive" ? 2 : 0;
        if (edge === "sensitive") Object.assign(answer, { found: false, citations: [], answer_md: "I could not find this in your calls." });
        if (edge === "weak") answer.citations.forEach((c) => { c.strength = "weak"; });
        w.ask_threads = [fixture];
      }
    },
  });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit2");
    await expect(page.locator('[data-region="AK-R1"]').getByRole("heading", { name: "Ask", exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  if (REAL) {
    if (edge === "weak") {
      await steer.invoke("harness.hold_rebuild", { on: false });
      await expect.poll(async () => {
        const result = await steer.invoke("search", { query: MEANING_ONLY, filter: {}, limit: null }) as SearchResults;
        return result.mode.type === "hybrid" && result.only_weak && result.items.length > 0;
      }).toBe(true);
    }
    if (edge === "local") await steer.invoke("harness.ask_pace", { ms: 250 });
    const composer = page.locator('[data-region="AK-R4"]').getByRole("textbox");
    await composer.fill(question);
    await composer.press("Enter");
    // Task runtime and global privacy are separate: preserve the core's reported pair while streaming.
    if (edge === "local") await expect(thread(page).locator(".ak-status")).toContainText(["Local model · Cloud, redacted"]);
    await expect.poll(async () => (await sent(page, "ask_thread_get")).length).toBeGreaterThan(0);
    expect(await sent(page, "ask_start")).toHaveLength(1);
  } else {
    await page.locator('[data-region="AK-R2"]').getByRole("button", { name: question, exact: true }).click();
  }
  await expect(answers(page).last()).toBeVisible();
  const reads = await sent(page, "ask_thread_get");
  const id = reads.at(-1)?.thread_id;
  expect(id).toBeTruthy();
  const stored = await steer.invoke("ask_thread_get", { thread_id: id }) as AskThread;
  const answer = stored.turns.at(-1)!;
  expect(answer.question).toBe(question);
  return answer;
}

test.describe("cpt-noter-seq-ask-cited-answer", () => {
  test("local runtime: a sensitive source is cited locally and its stored answer says who answered", async ({ page }) => {
    const answer = await answerEdge(page, "local");
    expect(answer).toMatchObject({ found: true, runtime: "local", answered_locally: true, sensitive_sources_skipped: 0 });
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations.some((c) => c.provenance.type === "past_call")).toBe(true);
    await expect(answers(page).last()).toContainText("Answered by the local model");
    await expect(answers(page).last().getByRole("list", { name: "Sources" })).toBeVisible();
    await expect(answers(page).last()).not.toContainText("not searched because this answer uses a cloud model");
  });

  test("cloud runtime: sensitive sources are skipped and the not-found answer explains the omission", async ({ page }) => {
    const answer = await answerEdge(page, "sensitive");
    expect(answer).toMatchObject({ found: false, answered_locally: false, citations: [] });
    expect(answer.runtime).not.toBe("local");
    expect(answer.sensitive_sources_skipped).toBeGreaterThan(0);
    const count = answer.sensitive_sources_skipped;
    await expect(answers(page).last()).toContainText(`${count} sensitive ${count === 1 ? "source was" : "sources were"} not searched because this answer uses a cloud model`);
    await expect(answers(page).last()).toContainText("I could not find this in your calls.");
    await expect(answers(page).last().getByRole("list", { name: "Sources" })).toHaveCount(0);
  });

  test("weak-only retrieval: the answer warns before its citations and announces the weak result", async ({ page }) => {
    const answer = await answerEdge(page, "weak");
    expect(answer).toMatchObject({ found: true, only_weak_evidence: true, keyword_only: false });
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.citations.every((c) => c.strength === "weak")).toBe(true);
    await expect(answers(page).last()).toContainText(WEAK_WARNING);
    await expect(answers(page).last()).toContainText("Weak match");
    if (REAL) await expect(thread(page).getByRole("status").filter({ hasText: "Answer ready, only weak matches" })).toHaveCount(1);
  });
});
