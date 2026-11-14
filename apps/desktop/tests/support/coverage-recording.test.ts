import { describe, expect, it } from "vitest";

import { storiesForCoverage } from "./coverage-recording";

describe("conformance coverage recording", () => {
  it("does not credit a story whose test or suite was skipped", () => {
    const task = {
      name: "an archive profile matches the named voice",
      mode: "skip",
      suite: { name: "cpt-noter-seq-dialogs-set-up-voice-profile", mode: "skip" },
    };

    expect(storiesForCoverage(task)).toEqual([]);
  });

  it("records the story only after its test passed", () => {
    const task = {
      name: "an archive profile matches the named voice",
      mode: "run",
      result: { errors: [] },
      suite: { name: "cpt-noter-seq-dialogs-set-up-voice-profile", mode: "run" },
    };

    expect(storiesForCoverage(task)).toEqual(["cpt-noter-seq-dialogs-set-up-voice-profile"]);
  });
});
