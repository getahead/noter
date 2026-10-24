import { describe, expect, it } from "vitest";
import type { CallRow } from "../../core/bindings";
import { audioDeletedHelp, statusOf } from "./status-cell";

const call = (o: Partial<CallRow> = {}) =>
  ({
    outputs: "ready",
    unnamed_speakers: 0,
    archive: "done",
    audio_deleted: false,
    audio_kept_until: null,
    privacy: "normal",
    ...o,
  }) as CallRow;

describe("statusOf (cpt-noter-algo-ui-library-calls-status-cell)", () => {
  it("picks the first that applies: failed, writing, speakers not named, archive pending", () => {
    const all = { unnamed_speakers: 2, archive: "pending" } as const;
    expect(statusOf(call({ ...all, outputs: "failed" }))).toMatchObject({
      state: "summary-failed",
      text: "Couldn't write the summary",
      tone: "error",
    });
    expect(statusOf(call({ ...all, outputs: "writing" }))).toMatchObject({
      state: "writing-summary",
      text: "Writing summary…",
      spin: true,
    });
    expect(statusOf(call(all))).toMatchObject({
      state: "speakers-not-named",
      text: "2 speakers not named",
    });
    expect(statusOf(call({ archive: "pending" }))).toMatchObject({
      state: "archive-pending",
      text: "Archive pending",
    });
    expect(statusOf(call({ archive: "failed" }))?.state).toBe(
      "archive-pending",
    );
  });

  it("says one speaker in the singular and nothing for a settled call", () => {
    expect(statusOf(call({ unnamed_speakers: 1 }))?.text).toBe(
      "1 speaker not named",
    );
    expect(statusOf(call())).toBeNull();
  });
});

describe("audioDeletedHelp", () => {
  it("names the day the audio goes (kept 30 days)", () => {
    expect(
      audioDeletedHelp(
        call({
          audio_deleted: true,
          audio_kept_until: Date.UTC(2026, 11, 15, 12),
        }),
        "UTC",
      ),
    ).toMatch(/^Audio deleted on 15 Nov \(kept 30 days\)$/);
    expect(audioDeletedHelp(call({ audio_deleted: false }), "UTC")).toBeNull();
  });
});
