import type { AskThread, TopicList } from "../../src/core/bindings";
import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";

const REAL = process.env.NOTER_CORE === "stdio";

test.describe("cpt-noter-seq-library-follow-topic", () => {
  test("No topics is reachable with a topics-only world slice", async ({ page }) => {
    await openWindow(page, "main", { world(w) { W.idle(w); w.topics = []; } });
    await expect(async () => {
      await page.keyboard.press("Meta+Digit5");
      await expect(page.getByText("No topics yet", { exact: true })).toBeVisible({ timeout: 1000 });
    }).toPass();
  });

  for (const action of ["Merge", "Keep Separate"] as const) {
    test(`core-computed suggestion: ${action} is explicit and persists`, async ({ page }) => {
      const steer = await openWindow(page, "main", { world(w) {
        W.idle(w);
        if (!REAL) w.topics.find((t) => t.id === "top_ws")!.merge_suggestion = { id: "top_notif", name: "Notification service" };
      } });
      if (REAL) await steer.invoke("harness.topic_centroids", { topic_ids: ["top_ws", "top_notif"] });
      await expect(async () => {
        await page.keyboard.press("Meta+Digit5");
        await expect(page.getByRole("heading", { name: "Topics", level: 1 })).toBeVisible({ timeout: 1000 });
      }).toPass();
      await page.getByRole("table").getByRole("row", { name: /Websocket notifications/ }).click();
      await page.keyboard.press("Enter");
      const suggestion = page.locator('[data-region="TH-R2"]');
      await expect(suggestion).toContainText("Looks like the same subject as “Notification service”");
      await suggestion.getByRole("button", { name: action, exact: true }).click();
      if (action === "Merge") {
        await page.getByRole("dialog").getByRole("button", { name: "Merge", exact: true }).click();
        await expect.poll(() => sent(page, "topics_merge")).toContainEqual({ source: "top_ws", target: "top_notif" });
        await expect(page.getByRole("heading", { name: "Notification service", exact: true })).toBeVisible();
      } else {
        await expect.poll(() => sent(page, "topics_keep_separate")).toContainEqual({ a: "top_ws", b: "top_notif" });
        await expect(suggestion).toHaveCount(0);
      }
      const read = await steer.invoke("topics_list", {}) as TopicList;
      if (action === "Merge") expect(read.topics.some((t) => t.id === "top_ws")).toBe(false);
      else expect(read.topics.find((t) => t.id === "top_ws")?.merge_suggestion).toBeNull();
    });
  }
});

test.describe("cpt-noter-seq-ask-follow-up-and-copy", () => {
  test("a reloaded narrowed turn widens from its stored scope and retains acknowledged ratings", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 800 });
    const steer = await openWindow(page, "main", { fixedClock: true, world: W.idle });
    await expect(async () => {
      await page.keyboard.press("Meta+Digit2");
      await expect(page.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible({ timeout: 1000 });
    }).toPass();
    const composer = page.locator('[data-region="AK-R4"]').getByRole("textbox");
    // Calls only is narrower than All calls and all sources.
    const preset = page.getByRole("combobox", { name: /Scope/ });
    await preset.selectOption("calls_only");
    await composer.fill("zzqxzz quuxplan frobnicate");
    await composer.press("Enter");
    await expect(page.getByRole("button", { name: "Widen Scope", exact: true })).toBeVisible();
    const starts = await sent(page, "ask_start");
    await expect.poll(async () => (await sent(page, "ask_thread_get")).length).toBeGreaterThan(0);
    const reads = await sent(page, "ask_thread_get");
    const id = reads.at(-1)!.thread_id as string;
    const stored = await steer.invoke("ask_thread_get", { thread_id: id }) as AskThread;
    expect(stored.turns[0].scope?.include_documents).toBe(false);
    expect(starts).toHaveLength(1);
    const helpful = page.getByRole("button", { name: "Helpful", exact: true });
    await steer.failNext("ask_rate", "internal");
    await helpful.click();
    await expect(page.getByRole("alert")).toContainText("Couldn't save your rating");
    await expect(helpful).toHaveAttribute("aria-pressed", "false");
    await helpful.click();
    await expect(helpful).toHaveAttribute("aria-pressed", "true");
    expect((await steer.invoke("ask_thread_get", { thread_id: id }) as AskThread).turns[0].rating).toBe("helpful");
    await page.keyboard.press("Meta+Digit1");
    await page.keyboard.press("Meta+Digit2");
    await page.locator('[data-region="AK-R2"]').getByRole("button", { name: stored.title, exact: true }).click();
    await expect(helpful).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Widen Scope", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Widen Scope", exact: true }).click();
    await expect.poll(async () => (await sent(page, "ask_start")).at(-1)).toMatchObject({ scope: { preset: "all", include_documents: true } });
  });
});

test("cpt-noter-seq-ask-cited-answer — quote language and measured answer work come from the stored answer", async ({ page }) => {
  const steer = await openWindow(page, "main", { fixedClock: true, world: W.idle });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit2");
    await expect(page.getByRole("heading", { name: "Ask", level: 1 })).toBeVisible({ timeout: 1000 });
  }).toPass();
  const field = page.locator('[data-region="AK-R4"]').getByRole("textbox");
  await field.fill("websocket notifications");
  await field.press("Enter");
  const turn = page.locator(".ak-turn").last();
  await expect(turn.locator("blockquote").first()).toBeVisible();
  await expect.poll(async () => (await sent(page, "ask_thread_get")).length).toBeGreaterThan(0);
  const reads = await sent(page, "ask_thread_get");
  const stored = await steer.invoke("ask_thread_get", { thread_id: reads.at(-1)!.thread_id }) as AskThread;
  const answer = stored.turns.at(-1)!;
  for (const [i, citation] of answer.citations.entries()) {
    const lang = typeof citation.lang === "string" ? citation.lang : citation.lang?.code;
    if (lang) await expect(turn.locator("blockquote").nth(i)).toHaveAttribute("lang", lang);
    else await expect(turn.locator("blockquote").nth(i)).not.toHaveAttribute("lang");
  }
  if (REAL) {
    const m = answer.meta!;
    expect(m).toBeTruthy();
    await expect(turn).toContainText(`${m.call_hits} transcript ${m.call_hits === 1 ? "match" : "matches"}`);
    await expect(turn).toContainText(`${m.item_hits} item ${m.item_hits === 1 ? "match" : "matches"}`);
    await expect(turn).toContainText(`${m.elapsed_ms.toLocaleString("en-US")} ms`);
  }
});

test("cpt-noter-seq-library-search-calls — stored item kind is a compact tag", async ({ page }) => {
  await openWindow(page, "main", { world: W.idle });
  const search = page.getByRole("searchbox", { name: /Search/ });
  await search.fill("drawer");
  await search.press("Enter");
  const kind = page.getByRole("region", { name: "Items", exact: true }).getByText("Action item", { exact: true }).first();
  await expect(kind).toBeVisible();
  // A kind tag fits its text rather than stretching across the result's grid column.
  const tag = await kind.boundingBox();
  const row = await kind.locator("..").boundingBox();
  expect(tag!.width).toBeLessThan(row!.width / 2);
});
