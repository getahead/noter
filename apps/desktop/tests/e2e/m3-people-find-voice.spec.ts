// People — Find a voice in past calls (cpt-noter-seq-people-find-voice-in-past-calls, #1278), against the real core.
// The world gives the backend call (archive pass) one more voice, unnamed, that the scripted engine reports with the same
// voice as Anna K.'s line in the live call; the fixture is smaller than DESIGN's (1 call and 1 speaker, not 6 and 9).
import type { Page } from "@playwright/test";

import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { openWindow } from "./support/app";
import { sent } from "./support/call-page";
import { expect, test } from "./support/fixtures";

const REAL = process.env.NOTER_CORE === "stdio";
const FOUND = "Found Anna K.’s voice in 1 call · named 1 speaker";
const button = (page: Page, name: string | RegExp) =>
  page.getByRole("button", { name });
type Steer = Awaited<ReturnType<typeof openWindow>>;

/** Anna K. without a profile, and an unnamed Speaker 2 in the backend call next to Dmitri S.'s named line. */
function pastVoices(w: World) {
  W.idle(w);
  w.people.find((p) => p.id === "per_anna")!.voice_profile = false;
  const t = w.transcripts.find((x) => x.call_id === "call_backend")!;
  const base = t.speakers.find((s) => s.id === "spk_b_dmitri")!;
  const speaker = {
    ...base,
    id: "spk_b_2",
    label: { type: "unnamed" as const, n: 2 },
    named_by: null,
    suggestion: null,
    sample: { ...base.sample!, t0_ms: 40_000, t1_ms: 46_000 },
  };
  t.speakers.push(speaker);
  // the core seeds speakers from the call's detail
  w.call_details
    .find((d) => d.call.id === "call_backend")!
    .speakers.push(speaker);
  const seg = t.segments[0];
  t.segments.push({
    ...seg,
    id: "seg_backend_anna",
    t0_ms: 40_000,
    t1_ms: 46_000,
    text: "Я подготовлю спецификацию к пятнице.",
    speaker: { speaker_id: "spk_b_2", label: { type: "unnamed", n: 2 } },
  });
}

async function createAnnaProfile(page: Page): Promise<Steer> {
  const steer = await openWindow(page, "main", { world: pastVoices });
  // Speaker 2 sounds like Anna's line in the live call, as the scripted engine embeds it.
  await steer.invoke("harness.speaker_voice", {
    speaker_id: "spk_b_2",
    as_call: "call_live",
  });
  await expect(async () => {
    await page.keyboard.press("Meta+Digit4");
    await expect(
      page.getByRole("heading", { name: "People", level: 1 }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page
    .getByRole("table", { name: /People/ })
    .getByRole("row", { name: /Anna K\./ })
    .click();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Anna Kuznetsova" }),
  ).toBeVisible();
  await button(page, "Set Up Voice Profile…").click();
  const sheet = page.getByRole("dialog", { name: "Set Up Voice Profile" });
  await expect(sheet).toContainText(
    "Noter then names this voice where it is still unnamed in past calls.",
  );
  await sheet.getByRole("button", { name: "Create Profile" }).click();
  return steer;
}

const labelOf = async (steer: Steer, id: string) => {
  const detail = (await steer.invoke("call_get", {
    call_id: "call_backend",
  })) as {
    speakers: {
      id: string;
      label: { type: string; n?: number; person?: { id: string } };
    }[];
  };
  return detail.speakers.find((s) => s.id === id)?.label;
};

// The fake world stores no voices, so only the real core can match one (fake runs are not counted for E2E coverage).
if (REAL)
  test.describe("cpt-noter-seq-people-find-voice-in-past-calls", () => {
    test("UI — other path: Create Profile names Anna K.'s voice where the backend call still had it unnamed, and leaves Dmitri S.'s line alone", async ({
      page,
    }) => {
      const steer = await createAnnaProfile(page);
      await expect
        .poll(() => sent(page, "voice_profile_rematch"))
        .toEqual([{ person_id: "per_anna" }]);
      await expect(page.getByText(FOUND).first()).toBeVisible();
      expect(await labelOf(steer, "spk_b_2")).toEqual(
        expect.objectContaining({
          type: "person",
          person: expect.objectContaining({ id: "per_anna" }),
        }),
      );
      expect(await labelOf(steer, "spk_b_dmitri")).toEqual(
        expect.objectContaining({
          person: expect.objectContaining({ id: "per_dmitri" }),
        }),
      );
    });

    test("UI — error, happy and empty paths: Undo unnames the speaker, Find in Past Calls names it again, then finds nothing left", async ({
      page,
    }) => {
      const steer = await createAnnaProfile(page);
      await expect(page.getByText(FOUND).first()).toBeVisible();

      // error path (wrong voice named): Undo on the strip takes the name back; the profile stays
      await button(page, "Undo").first().click();
      await expect
        .poll(() => labelOf(steer, "spk_b_2"))
        .toEqual({ type: "unnamed", n: 2 });
      await expect(button(page, "Delete Profile…")).toBeVisible();

      // happy path: the explicit button
      await button(page, "Find in Past Calls").click();
      await expect
        .poll(() => sent(page, "voice_profile_rematch"))
        .toHaveLength(2);
      await expect
        .poll(() => labelOf(steer, "spk_b_2"))
        .toEqual(expect.objectContaining({ type: "person" }));
      await expect(page.getByText(FOUND).first()).toBeVisible();

      // empty path: nothing left to name, and nothing changes
      await button(page, "Find in Past Calls").click();
      await expect(
        page.getByText(
          "No unnamed speakers in past calls match Anna K.’s voice",
        ),
      ).toBeVisible();
      expect(await labelOf(steer, "spk_b_2")).toEqual(
        expect.objectContaining({ type: "person" }),
      );
    });
  });
