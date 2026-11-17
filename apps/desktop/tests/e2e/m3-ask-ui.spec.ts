// M3 — Ask (docs/features/ui/ask.md, DESIGN.md › Screen — Ask AK-R1..R5). Stories `cpt-noter-seq-ask-cited-answer` and
// `cpt-noter-seq-ask-follow-up-and-copy`. Commands: ask_start, ask_stop, ask_threads_list, ask_thread_get, ask_thread_delete,
// ask_scope_presets (+ transcript_span, audio_play, calls_delete through the steering client). Written before the screen exists
// (tests first): they fail until the Ask feature lands and its PR carries them. The real core answers from its scripted runtime
// (`harness.llm_next`, skill "ask-answer"); states the fake cannot produce (not found, unreachable runtime, a deleted
// cited call) run on the real core only, like the conformance of the stories (tests/conformance/m3-stories-retrieval).
// Markup follows the prototype (`screen('ask')`, `.ak-*`): AK-R1 toolbar, AK-R2 recent questions, AK-R3 thread, AK-R4 composer.
import type { Locator, Page } from "@playwright/test";

import * as W from "../support/world-presets";
import { openWindow, type Steer } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";

const REAL = process.env.NOTER_CORE === "stdio";

const toolbar = (page: Page) => page.locator('[data-region="AK-R1"]');
const recent = (page: Page) => page.locator('[data-region="AK-R2"]');
const thread = (page: Page) => page.locator('[data-region="AK-R3"]');
const composer = (page: Page) => page.locator('[data-region="AK-R4"]');
const field = (page: Page) => composer(page).getByRole("textbox");
const answers = (page: Page) => thread(page).locator('[data-component="cpt-noter-component-ui-cited-answer"]');
const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole("button", { name });
/** The citation rows of one answer: numbered, each with its provenance chip, quote and (for a call) a play button. */
const citationRows = (answer: Locator) => answer.locator('[data-component="cpt-noter-component-ui-citation-row"], [data-part="citation-row"]');

const WEBSOCKET = "What did we agree with backend about the websocket notifications, and what is open?";
const FOLLOW_UP = "Who owns the acceptance criteria for the reconnect?";
const THREAD_QUESTION = "What did we decide about drawer notifications?"; // fixture thread ask_notif, answered today

const THREAD_ANSWER = "Drawer events go through the notification service [1].";

/**
 * The real core starts with no Ask threads (harness.world_set cannot seed ask_threads): ask the thread's question through the
 * window's own bridge, as a user would, with the scripted runtime answering. The page is then reloaded, which also clears the
 * calls the window recorded, so the tests count only their own.
 */
async function seedThread(page: Page, steer: Steer): Promise<void> {
  await steer.invoke("harness.llm_next", {
    skill: "ask-answer",
    output: { answer_md: THREAD_ANSWER, citations: [{ n: 1, segment_ids: ["seg_1"], chunk_ids: [], quote: "scripted quote" }], found: true },
  });
  const scope = { people: [], call_types: [], topic_id: null, call_id: null, include_documents: true };
  await page.evaluate(
    ([question, scope]) =>
      new Promise<void>((resolve, reject) => {
        const internals = (window as unknown as { __TAURI_INTERNALS__: { transformCallback(cb: (m: { message?: { event: { type: string } } }) => void): number; invoke(cmd: string, p: unknown): Promise<unknown> } }).__TAURI_INTERNALS__;
        const id = internals.transformCallback((raw) => { // the bridge wraps each channel message as { index, message }
          const type = raw.message?.event.type;
          if (type === "done") resolve();
          else if (type === "failed") reject(new Error("the seeded answer failed"));
        });
        internals.invoke("ask_start", { args: { thread_id: null, question, scope }, channel: { id } }).catch(reject);
      }),
    [THREAD_QUESTION, scope] as const,
  );
  await page.reload();
}

async function openAsk(page: Page, opts: Parameters<typeof openWindow>[2] & { seed?: boolean } = {}) {
  const { seed = true, ...plan } = opts;
  const steer = await openWindow(page, "main", { fixedClock: true, world: (w) => W.idle(w), ...plan });
  if (REAL && seed) await seedThread(page, steer);
  // The shortcut is dropped until the window has mounted its handlers: press again until Ask shows.
  await expect(async () => {
    await page.keyboard.press("Meta+Digit2");
    await expect(toolbar(page).getByRole("heading", { name: "Ask", exact: true })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
  return steer;
}

/** Type a question and press Return. */
async function ask(page: Page, question: string) {
  await field(page).fill(question);
  await field(page).press("Enter");
}

test.describe("cpt-noter-seq-ask-cited-answer", () => {
  test("happy path: ⌘N, question, Return — Answering…, Stop, then the answer with numbered citations and its meta line", async ({ page }) => {
    const steer = await openAsk(page);
    await page.keyboard.press("Meta+KeyN");
    await expect(toolbar(page)).toContainText(/Claude Code · Cloud, redacted|Local model · Local only/);
    await expect(toolbar(page).getByRole("combobox", { name: /scope/i })).toContainText("All calls · all sources");
    // the real core delivers an answer in one burst: pace it, so the stream stays live long enough to see (the fake streams for ~1.6 s)
    if (REAL) await steer.invoke("harness.ask_pace", { ms: 250 });
    await ask(page, WEBSOCKET);

    await expect(toolbar(page)).toContainText("Answering…");
    await expect(button(composer(page), "Stop")).toBeVisible();
    await expect(button(composer(page), "Ask")).toHaveCount(0);
    // started: the runtime and mode the core reported (kept on screen above the streaming answer)
    await expect(thread(page).locator(".ak-status", { hasText: " · " })).toBeVisible();

    await expect(toolbar(page)).not.toContainText("Answering…");
    const answer = answers(page).last();
    await expect(answer).toBeVisible();
    await expect(citationRows(answer).first()).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /Answer ready, \d+ citations?/ })).toHaveCount(1); // announced once
    const [start] = await sent(page, "ask_start");
    expect(start).toMatchObject({ thread_id: null, question: WEBSOCKET });
    expect((start as { scope: unknown }).scope).toMatchObject({ people: [], call_types: [], topic_id: null, call_id: null });
    expect((await sent(page, "ask_scope_presets")).length).toBeGreaterThan(0);
    expect((await sent(page, "ask_threads_list")).length).toBeGreaterThan(0);
  });

  test("happy path: a citation superscript moves focus to its row, ⇧Tab returns, and its title opens the Call page at the span", async ({ page }) => {
    await openAsk(page, { latency: 500, latencyFor: "call_get" });
    await ask(page, WEBSOCKET);
    const answer = answers(page).last();
    await expect(citationRows(answer).first()).toBeVisible();
    await expect(toolbar(page)).not.toContainText("Answering…");

    const first = answer.getByRole("button", { name: /^(Citation )?1$/ }).first();
    await first.focus();
    await first.press("Enter");
    const row = citationRows(answer).first();
    await expect(row).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(first).toBeFocused();

    await row.getByRole("link", { name: /.+/ }).first().click();
    await expect(page.locator('[data-region="PC-R1"]')).toBeVisible();
    await expect(page.getByRole("tab", { name: "Transcript" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(async () => (await sent(page, "transcript_span")).length).toBeGreaterThan(0);
  });

  test("happy path: the play button of a call citation plays its span in the playback bar", async ({ page }) => {
    await openAsk(page);
    await ask(page, WEBSOCKET);
    const row = citationRows(answers(page).last()).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: /^Play/ }).click();
    await expect(page.locator('[data-component="cpt-noter-component-ui-playback-bar"]')).toBeVisible();
    expect(await sent(page, "audio_play")).toHaveLength(1);
  });

  test("other path: Stop keeps the text so far, labels it Stopped by you · and frees the composer", async ({ page }) => {
    const steer = await openAsk(page);
    if (REAL) await steer.invoke("harness.llm_next", { skill: "ask-answer", after_ms: 30_000 });
    await ask(page, WEBSOCKET);
    await expect(toolbar(page)).toContainText("Answering…");
    await button(composer(page), "Stop").click();
    await expect(answers(page).last()).toContainText("Stopped by you ·");
    await expect(toolbar(page)).not.toContainText("Answering…");
    await expect(button(composer(page), "Ask")).toBeVisible();
    expect(await sent(page, "ask_stop")).toHaveLength(1);
  });

  test("empty path — Not found in your calls: the sentence, Search by Keyword, and the Library search for the same words", async ({ page }) => {
    if (!REAL) return; // the fake core cannot produce this state
    const steer = await openAsk(page);
    await steer.invoke("harness.llm_next", { skill: "ask-answer", output: { answer_md: "", citations: [], found: false } });
    const question = "What did we decide about the OpenStack upgrade?";
    await ask(page, question);
    await expect(thread(page)).toContainText("I could not find this in your calls.");
    await expect(thread(page).getByRole("button", { name: /^Thumbs/ })).toHaveCount(0);
    await expect(button(thread(page), "Widen Scope")).toHaveCount(0); // the scope is not narrowed
    await button(thread(page), "Search by Keyword").click();
    await expect(page.getByRole("searchbox")).toHaveValue(question);
    // The Library search command itself ("search" sent with this query) is asserted with the Library search feature (#922), which is what sends it.
  });

  test("empty path — Not found with a narrowed scope: Widen Scope asks the same question again with All calls · all sources", async ({ page }) => {
    if (!REAL) return; // the fake core cannot produce this state
    const steer = await openAsk(page);
    const scopeSelect = toolbar(page).getByRole("combobox", { name: /scope/i });
    const narrowed = await scopeSelect.locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => o.value).find((v) => v !== "all"));
    expect(narrowed, "the core offers a narrower scope than All calls").toBeTruthy();
    await scopeSelect.selectOption(narrowed as string);
    await steer.invoke("harness.llm_next", { skill: "ask-answer", output: { answer_md: "", citations: [], found: false } });
    const question = "What did we decide about the OpenStack upgrade?";
    await ask(page, question);
    await expect(thread(page)).toContainText("I could not find this in your calls.");
    await steer.invoke("harness.llm_next", { skill: "ask-answer", output: { answer_md: "", citations: [], found: false } });
    await button(thread(page), "Widen Scope").click();
    await expect(scopeSelect).toContainText("All calls · all sources");
    await expect.poll(async () => (await sent(page, "ask_start")).length).toBe(2);
    const second = (await sent(page, "ask_start"))[1] as { question: string; scope: { preset?: string } };
    expect(second.question).toBe(question);
    expect(second.scope.preset).toBe("all");
  });

  test("empty path — a routed question asked under a narrowed scope keeps Widen Scope once its route settles into the thread", async ({ page }) => {
    if (!REAL) return; // the fake core cannot produce this state
    const steer = await openAsk(page);
    const scopeSelect = toolbar(page).getByRole("combobox", { name: /scope/i });
    const narrowed = await scopeSelect.locator("option").evaluateAll((os) => (os as HTMLOptionElement[]).map((o) => o.value).find((v) => v !== "all"));
    expect(narrowed, "the core offers a narrower scope than All calls").toBeTruthy();
    await scopeSelect.selectOption(narrowed as string);
    await steer.invoke("harness.llm_next", { skill: "ask-answer", output: { answer_md: "", citations: [], found: false } });
    const question = "What did we decide about the OpenStack upgrade?";
    // the route Ask Instead pushes, through the shell's navigate seam: asked once, then its entry becomes thread:<id>
    await page.evaluate(async (q) => {
      const module = "/src/features/shell/navigate.ts"; // served by the dev server: the app's own module instance
      const { navigate } = (await import(/* @vite-ignore */ module)) as { navigate: (route: { section: string; key: string }) => void };
      navigate({ section: "ask", key: `new:${encodeURIComponent(q)}` });
    }, question);
    await expect(thread(page)).toContainText("I could not find this in your calls.");
    // settled: the turn was stored (one thread read) and the route's thread was opened (a second one)
    await expect.poll(async () => (await sent(page, "ask_thread_get")).length).toBeGreaterThanOrEqual(2);
    await expect(button(thread(page), "Widen Scope")).toBeVisible();
  });

  test("a cited named speaker shows as a person chip on the citation row", async ({ page }) => {
    if (!REAL) return; // the fake's cited call carries no speaker
    const steer = await openAsk(page);
    await steer.invoke("harness.llm_next", { skill: "ask-answer", output: { answer_md: THREAD_ANSWER, citations: [{ n: 1, segment_ids: ["seg_1"], chunk_ids: [], quote: "scripted quote" }], found: true } });
    await ask(page, WEBSOCKET);
    const row = citationRows(answers(page).last()).first();
    await expect(row).toBeVisible();
    await expect(row.locator('[data-component="cpt-noter-component-ui-person-chip"]')).toBeVisible(); // the core fills Citation.speaker for a named speaker
  });

  test("error path — Claude Code unreachable: Couldn't reach Claude Code, Try Again keeps the question", async ({ page }) => {
    if (!REAL) return; // the fake core cannot produce this state
    const steer = await openAsk(page);
    await steer.invoke("harness.llm_next", { skill: "ask-answer", fail: "runtime_unavailable" });
    await ask(page, WEBSOCKET);
    const banner = thread(page).locator('[data-component="cpt-noter-component-ui-inline-banner"]');
    await expect(banner).toContainText("Couldn't reach Claude Code");
    await expect(button(banner, "Answer with Local Model")).toBeVisible();
    await button(banner, "Try Again").click();
    await expect(answers(page).last()).toBeVisible();
    expect((await sent(page, "ask_start")).map((a) => (a as { question: string }).question)).toEqual([WEBSOCKET, WEBSOCKET]);
  });
});

test.describe("cpt-noter-seq-ask-follow-up-and-copy", () => {
  // WebKit has no clipboard permission to grant: the window's writeText is a stand-in that records the text
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void (document.body.dataset.copied = text) } }),
    );
  });

  test("happy path: select a recent question, follow up under it, Copy with Citations shows Copied and writes Markdown", async ({ page }) => {
    await openAsk(page);
    await expect(recent(page)).toContainText(REAL ? "Today" : "Last week"); // the fixture thread is last week; the seeded one is today
    await recent(page).getByRole("listitem").filter({ hasText: THREAD_QUESTION }).click();
    await expect(thread(page)).toContainText("Drawer events go through the notification service");
    const [get] = await sent(page, "ask_thread_get");
    expect(get).toMatchObject({ thread_id: expect.any(String) });

    const follow = composer(page).getByRole("textbox", { name: /Ask a follow-up…/ });
    await follow.fill(FOLLOW_UP);
    await follow.press("Enter");
    await expect(answers(page)).toHaveCount(2);
    await expect(toolbar(page)).not.toContainText("Answering…");
    const starts = await sent(page, "ask_start");
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ thread_id: (get as { thread_id: string }).thread_id, question: FOLLOW_UP }); // the same core thread

    const copy = button(answers(page).last(), "Copy with Citations");
    await copy.click();
    await expect(copy).toContainText("Copied");
    await expect(page.getByRole("status").filter({ hasText: "Copied" })).toHaveCount(1); // announced politely
    const clip = (await page.evaluate(() => document.body.dataset.copied)) ?? "";
    expect(clip).toMatch(/\[1\]|\b1\b/); // reference numbers kept
    expect(clip).not.toContain(THREAD_QUESTION); // only the chosen answer, not the thread
    await expect(copy).not.toContainText("Copied", { timeout: 5000 }); // Copied lasts 2 s
  });

  test("empty path — First question: the first composer, suggestions, and the question lands under Today", async ({ page }) => {
    await openAsk(page, { seed: false, world: REAL ? undefined : (w) => (W.idle(w), (w.ask_threads.length = 0)) }); // the real core starts empty
    await expect(thread(page)).toContainText("Ask anything about your calls and documents");
    await expect(field(page)).toHaveAttribute("placeholder", "Ask about your calls and documents…");
    await expect(recent(page)).toContainText("Your questions appear here");
    await expect(thread(page).getByRole("button", { name: /.+\?$/ })).toHaveCount(3); // three suggested questions

    await ask(page, WEBSOCKET);
    await expect(answers(page)).toHaveCount(1);
    await expect(toolbar(page)).not.toContainText("Answering…");
    await expect(composer(page).getByRole("textbox", { name: /Ask a follow-up…/ })).toBeVisible(); // the composer moved under the answer
    await expect(recent(page)).toContainText("Today");
    await expect(recent(page).getByRole("listitem").filter({ hasText: WEBSOCKET })).toHaveCount(1);
  });

  test("other path: Delete in a recent row's menu removes the thread after success and refreshes the list", async ({ page }) => {
    await openAsk(page);
    const row = recent(page).getByRole("listitem").filter({ hasText: THREAD_QUESTION });
    await row.click();
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(row).toHaveCount(0);
    expect(await sent(page, "ask_thread_delete")).toHaveLength(1);
    await expect(recent(page)).toContainText("Your questions appear here");
  });

  test("focus: Delete hands focus on (here to the composer, the list being empty), ⌘N starts in the composer, Stop returns to it", async ({ page }) => {
    const steer = await openAsk(page);
    const row = recent(page).getByRole("listitem").filter({ hasText: THREAD_QUESTION });
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await expect(row).toHaveCount(0);
    await expect(field(page)).toBeFocused(); // no row is left to take it
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("Meta+KeyN");
    await expect(field(page)).toBeFocused();
    if (REAL) await steer.invoke("harness.ask_pace", { ms: 400 }); // the real core answers in one burst
    await ask(page, WEBSOCKET);
    await button(composer(page), "Stop").click();
    await expect(field(page)).toBeFocused(); // the Stop button was replaced
  });

  test("Medium and Narrow: Recent lives in the toolbar pop-up and opens a thread; the 260 pt pane is gone", async ({ page }) => {
    await openAsk(page);
    await expect(recent(page)).toBeVisible(); // Wide (the default window)
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(recent(page)).toBeHidden();
    const pop = toolbar(page).getByRole("combobox", { name: /recent/i });
    await expect(pop).toBeVisible();
    await pop.selectOption({ label: THREAD_QUESTION });
    await expect(thread(page)).toContainText(THREAD_QUESTION);
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(toolbar(page).getByRole("combobox", { name: /scope/i })).toHaveCount(0); // its choices moved into »
    await expect(pop).toBeVisible();
  });

  test("error path — Cited source deleted: Source deleted, no play or link, and Ask Again cites only what is left", async ({ page }) => {
    if (!REAL) return; // the fake core cannot produce this state
    const steer = await openAsk(page);
    await ask(page, "Can we keep serving reads while it rebuilds?");
    const first = answers(page).last();
    await expect(citationRows(first).first()).toBeVisible();
    await expect(toolbar(page)).not.toContainText("Answering…");
    await steer.invoke("calls_delete", { call_ids: [W.PAST_CALL] });
    await recent(page).getByRole("listitem").first().click(); // reopen: the stored thread now carries the deleted flag
    const row = citationRows(answers(page).last()).filter({ hasText: "Source deleted" }).first();
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: /^Play/ })).toBeDisabled();
    await expect(row.getByRole("link")).toHaveCount(0);
    await button(answers(page).last(), "Ask Again").click();
    expect((await sent(page, "ask_start")).at(-1)).toMatchObject({ question: "Can we keep serving reads while it rebuilds?" });
    await expect(citationRows(answers(page).last()).filter({ hasText: "Source deleted" })).toHaveCount(0);
  });
});
