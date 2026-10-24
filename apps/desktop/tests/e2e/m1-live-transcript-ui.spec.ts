// M1 — Live and stored transcript (docs/features/ui/live-transcript.md, DESIGN.md › Screen — Call screen CS-R2/CS-R2b, Call page PC-R5/PC-R6).
// The UI half of `cpt-noter-seq-call-screen-replay-line` (m1-call-screen-replay-presenting.spec.ts proves each path at the
// contract) plus the feature's own flows: follow, waiting, detach, virtualisation, the stored transcript. Written before the
// view exists (tests first): they fail until live-transcript lands, and its PR carries them. Markup follows the prototype
// (`C.transcriptView`, `C.segmentRow`, `C.playbackBar`): the log is `role="log"` named Transcript, rows carry their DESIGN
// component id and a `lang`, the play control is the button "Play this line", the Jump to Live pill a button.
// macOS draws nothing here: no XCUITest names are needed.
import type { Page } from "@playwright/test";

import type { OutputRoute, SegmentView, SpeakerRef } from "../../src/core/bindings";
import type { World } from "../support/scenario";
import * as W from "../support/world-presets";
import { calls, openWindow, type Steer } from "./support/app";
import { expect, test } from "./support/fixtures";

const FAKE = process.env.NOTER_CORE !== "stdio";
const ROW = '[data-component="cpt-noter-component-ui-transcript-segment-row"]';
const log = (page: Page) => page.getByRole("log", { name: "Transcript" });
const rows = (page: Page) => log(page).locator(ROW);
const rowWith = (page: Page, text: string) => rows(page).filter({ hasText: text });
const play = (page: Page, text: string) => rowWith(page, text).getByRole("button", { name: "Play this line" });
const jump = (page: Page, text: RegExp | string = /^Jump to Live/) => page.getByRole("button", { name: text });
const bar = (page: Page) => page.locator('[data-region="CS-R2b"], [data-region="PC-R6"]');
const sent = async (page: Page, name: string) => (await calls(page)).filter((c) => c.kind === "invoke" && c.name === name).map((c) => c.args);

const ANNA_LINE = "drawer redesign до пятницы"; // seg_live_002, spk_anna, 00:19:58
const REASON = {
  speakers: "Replay is off while recording on speakers: the call would hear it. Use headphones, or replay after the call.",
  unknown: "Noter can't tell whether this output is headphones. Mark it as headphones in Settings › Audio & Transcription to replay while recording.",
  ownSounds: "Replay would be recorded. Turn on Exclude Noter's own sounds in Settings › Audio & Transcription.",
};

const PAVEL: SpeakerRef = {
  speaker_id: "spk_pavel",
  label: {
    type: "person",
    person: {
      id: "per_pavel",
      display_name: "Pavel Romanov",
      short_name: "Pavel",
      initials: "PR",
      is_you: false,
    },
  },
};
const ANNA: SpeakerRef = {
  speaker_id: "spk_anna",
  label: {
    type: "person",
    person: {
      id: "per_anna",
      display_name: "Anna Kuznetsova",
      short_name: "Anna K.",
      initials: "AK",
      is_you: false,
    },
  },
};
const SCARLETT = {
  name: "Scarlett 2i2 USB",
  uid: "AppleUSBAudioEngine:Focusrite:Scarlett",
  marked_headphones: false,
};
const UNNAMED: SpeakerRef = {
  speaker_id: "spk_3",
  label: { type: "unnamed", n: 3 },
};

/** Confirmed line number `i`, after the fixture's own lines (they end at 00:23:26). */
const line = (i: number, over: Partial<SegmentView> = {}, call = W.LIVE_CALL): SegmentView => ({
  id: `seg_t_${call}_${i}`,
  call_id: call,
  channel: "sys",
  speaker: PAVEL,
  crosstalk_with: [],
  t0_ms: 1_500_000 + i * 8_000,
  t1_ms: 1_506_000 + i * 8_000,
  text: `Test line number ${i}`,
  lang: "en",
  lang_p: 0.93,
  confidence: 0.95,
  state: "confirmed",
  pass: "live",
  corrections: [],
  ...over,
});
const confirmed = (segment: SegmentView) => ({
  event: { type: "confirmed" as const, segment },
});

/** The live call's transcript with `extra` lines after the fixture's, the scripted lines off, one hypothesis. */
function liveWith(extra: SegmentView[], hypothesis = true) {
  return (w: World) => {
    const t = w.transcripts.find((x) => x.call_id === W.LIVE_CALL)!;
    t.segments.push(...extra);
    t.last_seq += extra.length;
    if (!hypothesis) t.hypotheses = [];
    w.live_script = [];
  };
}
const many = (n: number) => Array.from({ length: n }, (_, i) => line(i));
/** The output as the core reports it (environment and capture state) and what it makes of replay. */
function route(w: World, r: OutputRoute, ownSounds = true): void {
  w.app.environment.output_route = r;
  w.app.capture.output_route = r;
  w.settings.audio.exclude_own_sounds = ownSounds;
  w.app.capture.replay_available = r === "headphones" && ownSounds;
}
/** A finished call with a stored transcript of `n` lines; `matching` of them say "replay buffer". Patches `call_details` too. */
function stored(n: number, matching = 0, patch: { audio_deleted?: boolean; audio_not_stored?: boolean } = {}) {
  return (w: World) => {
    W.idle(w);
    w.app.capture.phase = "idle";
    const segments = Array.from({ length: n }, (_, i) =>
      line(
        i,
        {
          text: i < matching ? `We add a replay buffer, case ${i}` : `Stored line ${i}`,
          pass: "archive",
        },
        W.PAST_CALL,
      ),
    );
    w.transcripts = w.transcripts.filter((x) => x.call_id !== W.PAST_CALL); // the fixture's own transcript of the call
    w.transcripts.push({
      subscription_id: null,
      call_id: W.PAST_CALL,
      live: false,
      pass: "archive",
      archive: "done",
      segments,
      hypotheses: [],
      marks: [],
      gaps: [],
      speakers: [],
      last_seq: n,
      audio_available: !patch.audio_deleted,
    });
    const detail = w.call_details.find((d) => d.call.id === W.PAST_CALL)!;
    for (const c of [detail.call, w.calls.find((x) => x.id === W.PAST_CALL)!]) {
      c.audio_deleted = !!patch.audio_deleted;
      if (patch.audio_deleted) c.audio_kept_until = null;
    }
    detail.audio_not_stored = !!patch.audio_not_stored;
  };
}
/** The call's stored transcript ("Backend sync"). Until Library › Calls (2.13) and the call page (2.14) land, the dev
 *  server's `#transcript=<call id>` route mounts it in the main window without reloading (the core keeps its plan). */
async function openCall(page: Page, _title: string) {
  await page.evaluate((id) => (location.hash = `transcript=${id}`), W.PAST_CALL);
}
/** What the core does by itself when the route flips during replay: it stops and says why (the fake only publishes what a test hands it). */
async function routeFlips(page: Page, steer: Steer) {
  await steer.change((w) => route(w, "speakers"));
  if (FAKE)
    await page.evaluate(() => {
      const f = (
        globalThis as unknown as {
          __noterFake: { playback: object; publish(e: string): void };
        }
      ).__noterFake;
      Object.assign(f.playback, {
        playing: false,
        stopped_reason: "output_switched_to_speakers",
        route: "speakers",
      });
      f.publish("playback:state");
    });
}

test.describe("cpt-noter-flow-ui-live-transcript-follow", () => {
  test("UI — happy path: new confirmed rows land at the end, the hypothesis row changes in place, every row has its lang", async ({ page }) => {
    const steer = await openWindow(page, "call-screen", {
      world: liveWith([]),
    });
    await expect(rows(page).last()).toContainText("I think we should ask the backend team whether…"); // hypothesis last
    const hyp = rows(page).last();
    await expect(hyp).toHaveAttribute("data-state", "hypothesis");
    await expect(hyp).toHaveAttribute("aria-hidden", "true"); // not read by VoiceOver until confirmed
    await expect(hyp.getByRole("button")).toHaveCount(0); // no actions, no time, no tag
    await expect(rowWith(page, ANNA_LINE)).toHaveAttribute("lang", "ru");

    const before = await rows(page).count();
    await steer.push("transcript_subscribe", {
      event: {
        type: "hypothesis",
        segment: line(50, {
          text: "Then the buffer…",
          state: "hypothesis",
          id: "seg_live_009",
        }),
      },
    });
    await expect(rows(page).last()).toContainText("Then the buffer…");
    await expect(rows(page)).toHaveCount(before); // replaced, not added
    await steer.push(
      "transcript_subscribe",
      confirmed(
        line(51, {
          text: "Then the buffer survives a restart.",
          id: "seg_live_009",
        }),
      ),
    );
    await expect(rows(page).last()).toContainText("Then the buffer survives a restart.");
    await expect(rows(page).last()).not.toHaveAttribute("data-state", "hypothesis");
    await expect(rows(page).last()).toBeInViewport(); // still following the end
    expect(await sent(page, "transcript_subscribe")).toContainEqual({
      call_id: W.LIVE_CALL,
    });
  });

  test("UI — empty path: before the first speech the You and Others meters with Waiting for speech…, then the first line", async ({ page }) => {
    const steer = await openWindow(page, "call-screen", {
      world: (w) => {
        liveWith([], false)(w);
        Object.assign(w.transcripts[0], { segments: [], marks: [], gaps: [] });
      },
    });
    const view = page.locator('[data-component="cpt-noter-component-ui-transcript-view"]');
    await expect(view).toContainText("Waiting for speech…");
    await expect(view.getByText("You", { exact: true })).toBeVisible();
    await expect(view.getByText("Others", { exact: true })).toBeVisible();
    expect((await calls(page)).some((c) => c.kind === "invoke" && c.name === "levels_subscribe")).toBe(true);

    await steer.push("transcript_subscribe", confirmed(line(1, { text: "Hello, can you hear me?" })));
    await expect(rows(page).first()).toContainText("Hello, can you hear me?");
    await expect(view).not.toContainText("Waiting for speech…");
  });

  test("UI — error path: the stream ends with lagged, the bridge resubscribes and the rows shown stay put", async ({ page }) => {
    const steer = await openWindow(page, "call-screen", {
      world: liveWith(many(5)),
    });
    await expect(rowWith(page, "Test line number 4")).toBeVisible();
    await steer.push("transcript_subscribe", {
      event: { type: "ended", reason: "lagged" },
    });
    await expect.poll(async () => (await sent(page, "transcript_subscribe")).length).toBeGreaterThan(1);
    await expect(rowWith(page, "Test line number 4")).toBeVisible();
    await expect(rowWith(page, ANNA_LINE)).toBeVisible();
  });

  test("UI — other path: speaker labels, Crosstalk, Guest (your side), low confidence tag, gap and mark rows", async ({ page }) => {
    const extra = [
      line(1, {
        speaker: ANNA,
        crosstalk_with: [ANNA, UNNAMED],
        text: "Both at once",
      }),
      line(2, {
        channel: "mic",
        speaker: {
          speaker_id: "spk_guest",
          label: { type: "guest_your_side" },
        },
        text: "From my side of the desk",
      }),
      line(3, { lang: "ru", confidence: 0.6, text: "Не уверен в этой строке" }),
    ];
    await openWindow(page, "call-screen", { world: liveWith(extra) });
    await expect(rowWith(page, "Both at once")).toContainText("Anna K. / Speaker 3");
    await expect(rowWith(page, "Both at once")).toContainText("Crosstalk");
    await expect(rowWith(page, "From my side").locator('[data-component="cpt-noter-component-ui-speaker-label"]')).toHaveText("Guest (your side)");
    await expect(rowWith(page, "Не уверен").locator('[data-component="cpt-noter-component-ui-language-tag"]')).toHaveText("RU?"); // dashed, low confidence
    await expect(rowWith(page, "Не уверен").getByLabel(/Russian/)).toBeVisible(); // VoiceOver reads the name
    await expect(rowWith(page, "Fast, ja")).toContainText("Speaker 3");
    await expect(rows(page).filter({ hasText: "Paused 00:22:10–00:22:40" })).toBeVisible();
    await expect(rows(page).filter({ hasText: "Marked 00:21:00" })).toBeVisible();
  });

  test("UI — other path: a three-hour call draws only the rows in view and keeps the end in view", async ({ page }) => {
    await openWindow(page, "call-screen", { world: liveWith(many(3000)) });
    await expect(rowWith(page, "Test line number 2999")).toBeInViewport();
    const drawn = await rows(page).count();
    expect(drawn).toBeGreaterThan(5);
    expect(drawn).toBeLessThan(120); // rows in view plus a small overscan
  });
});

test.describe("cpt-noter-seq-call-screen-replay-line", () => {
  test("UI — happy path: scroll up, Jump to Live counts new lines, play Anna K.'s line on headphones, back to live", async ({ page }) => {
    const steer = await openWindow(page, "call-screen", {
      world: liveWith(many(60), false),
    });
    await expect(rowWith(page, "Test line number 59")).toBeInViewport();
    await expect(jump(page)).toHaveCount(0); // following

    await log(page).hover();
    await page.mouse.wheel(0, -20_000);
    await expect(rowWith(page, ANNA_LINE)).toBeInViewport();
    const at = (await rowWith(page, ANNA_LINE).boundingBox())!.y;
    await steer.push("transcript_subscribe", confirmed(line(100, { id: "seg_n1" })));
    await expect(jump(page, "Jump to Live · 1 new line")).toBeVisible(); // plural rules
    await steer.push("transcript_subscribe", confirmed(line(101, { id: "seg_n2" })));
    await steer.push("transcript_subscribe", confirmed(line(102, { id: "seg_n3" })));
    await expect(jump(page, "Jump to Live · 3 new lines")).toBeVisible();
    expect((await rowWith(page, ANNA_LINE).boundingBox())!.y).toBeCloseTo(at, 0); // confirmed rows never move

    await rowWith(page, ANNA_LINE).hover();
    await expect(play(page, ANNA_LINE)).toBeEnabled();
    await play(page, ANNA_LINE).click();
    expect(await sent(page, "audio_play")).toContainEqual(expect.objectContaining({ call_id: W.LIVE_CALL, from_ms: 1_198_000 }));
    await expect(bar(page)).toContainText("Replaying while recording · headphones");

    await jump(page, "Jump to Live · 3 new lines").click();
    await expect(rowWith(page, "Test line number 102")).toBeInViewport();
    await expect(jump(page)).toHaveCount(0);
    await bar(page).getByRole("button", { name: "Close Playback" }).click();
    expect((await sent(page, "audio_stop")).length).toBe(1);
    await expect(bar(page)).toHaveCount(0);
  });

  test("UI — happy path: ⌘J follows live again while the panel is key", async ({ page }) => {
    const steer = await openWindow(page, "call-screen", {
      world: liveWith(many(60), false),
    });
    await log(page).hover();
    await page.mouse.wheel(0, -20_000);
    await steer.push("transcript_subscribe", confirmed(line(100, { id: "seg_n1" })));
    await expect(jump(page, "Jump to Live · 1 new line")).toBeVisible();
    await page.keyboard.press("Meta+KeyJ");
    await expect(rowWith(page, "Test line number 100")).toBeInViewport();
    await expect(jump(page)).toHaveCount(0);
  });

  for (const [name, r, own, reason, fix] of [
    ["Recording on speakers", "speakers", true, REASON.speakers, (w: World) => route(w, "headphones")], // headphones are back
    [
      "Output not identified",
      "unknown",
      true,
      REASON.unknown,
      (w: World) => {
        w.settings.audio.output.headphones_devices.push(SCARLETT.uid);
        route(w, "headphones");
      },
    ], // Treat as headphones
    ["Noter's own sounds not excluded", "headphones", false, REASON.ownSounds, (w: World) => route(w, "headphones", true)], // Exclude Noter's own sounds on
  ] as const) {
    test(`UI — error path — ${name}: the play control is disabled and Space says why, nothing plays`, async ({ page }) => {
      const steer = await openWindow(page, "call-screen", {
        world: (w) => {
          liveWith([], false)(w);
          route(w, r, own);
          if (r === "unknown") w.app.environment.output_device = SCARLETT;
        },
      });
      await rowWith(page, ANNA_LINE).hover();
      await expect(play(page, ANNA_LINE)).toBeDisabled();
      await play(page, ANNA_LINE).focus(); // a disabled control stays focusable
      await page.keyboard.press("Space");
      await expect(page.getByRole("status").filter({ hasText: reason })).toBeVisible();
      await expect(rowWith(page, ANNA_LINE)).toBeVisible(); // the line stays readable as text
      expect(await sent(page, "audio_play")).toHaveLength(0);

      await steer.change(fix);
      await rowWith(page, ANNA_LINE).hover();
      await expect(play(page, ANNA_LINE)).toBeEnabled();
    });
  }

  test("UI — error path — Output switches to speakers: playback stops at once, the bar says so for 3 s, the controls go disabled", async ({ page }) => {
    const steer = await openWindow(page, "call-screen", {
      world: liveWith([], false),
    });
    await rowWith(page, ANNA_LINE).hover();
    await play(page, ANNA_LINE).click();
    await expect(bar(page)).toContainText("Replaying while recording · headphones");

    await routeFlips(page, steer); // the headphones are unplugged
    await expect(bar(page)).toContainText("Replay stopped: output switched to speakers");
    await expect(bar(page)).toHaveCount(0, { timeout: 6000 }); // gone after 3 s
    await rowWith(page, ANNA_LINE).hover();
    await expect(play(page, ANNA_LINE)).toBeDisabled();
  });
});

test.describe("cpt-noter-flow-ui-live-transcript-stored", () => {
  test("UI — happy path: the stored transcript replays on any output, with the audio line in its header", async ({ page }) => {
    await openWindow(page, "main", {
      world: (w) => {
        stored(5)(w);
        route(w, "speakers");
      },
    });
    await openCall(page, "Backend sync");
    const pane = page.locator('[data-region="PC-R5"]');
    await expect(pane).toContainText(/audio kept until/);
    await expect(rows(page)).toHaveCount(5);
    await rowWith(page, "Stored line 3").hover();
    await expect(play(page, "Stored line 3")).toBeEnabled(); // speakers do not matter once the call is over
    await play(page, "Stored line 3").click();
    expect(await sent(page, "audio_play")).toContainEqual(expect.objectContaining({ call_id: W.PAST_CALL }));
    await expect(page.locator('[data-region="PC-R6"]')).toBeVisible();
    await expect(page.locator('[data-region="PC-R6"]').getByRole("button", { name: "Close Playback" })).toBeVisible();
  });

  for (const [name, patch, header] of [
    ["Audio deleted", { audio_deleted: true }, /^Audio deleted on .+ · transcript kept/],
    ["Audio not stored", { audio_not_stored: true }, /Audio not stored for this call/],
  ] as const) {
    test(`UI — empty path: ${name} — no play controls, the header says why, the rows stay readable`, async ({ page }) => {
      await openWindow(page, "main", { world: stored(5, 0, patch) });
      await openCall(page, "Backend sync");
      await expect(page.locator('[data-region="PC-R5"]')).toContainText(header);
      await expect(rows(page)).toHaveCount(5);
      await expect(page.getByRole("button", { name: "Play this line" })).toHaveCount(0);
    });
  }

  test("UI — other path: ⌘F finds lines, 3 of 120 lines, Return moves to the next, Esc closes the find bar", async ({ page }) => {
    await openWindow(page, "main", { world: stored(120, 3) });
    await openCall(page, "Backend sync");
    await expect(rows(page).first()).toBeVisible();
    await page.keyboard.press("Meta+KeyF");
    const find = page.getByPlaceholder("Find in transcript");
    await expect(find).toBeFocused();
    await find.fill("replay buffer");
    await expect(page.getByText("3 of 120 lines")).toBeVisible();
    await expect(log(page).locator("mark")).toHaveCount(3);
    await page.keyboard.press("Enter");
    await expect(page.getByText("3 of 120 lines")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(find).toHaveCount(0);
  });

  test("UI — error path: the read fails, the view body shows its inline banner with Try Again", async ({ page }) => {
    const steer = await openWindow(page, "main", { world: stored(5) });
    await steer.failNext("transcript_subscribe", "internal");
    await openCall(page, "Backend sync");
    const pane = page.locator('[data-region="PC-R5"]');
    await expect(pane.getByRole("button", { name: "Try Again" })).toBeVisible();
    await pane.getByRole("button", { name: "Try Again" }).click();
    await expect(rows(page)).toHaveCount(5);
    expect((await sent(page, "transcript_subscribe")).length).toBe(2);
  });

  test("UI — other path: a read slower than 300 ms shows skeleton rows first", async ({ page }) => {
    await openWindow(page, "main", { world: stored(5), latency: 700 });
    await openCall(page, "Backend sync");
    await expect(page.locator('[class*="skel"]').first()).toBeVisible();
    await expect(rows(page)).toHaveCount(5);
  });
});
