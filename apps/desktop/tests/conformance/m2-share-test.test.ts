// 2.21 native services against the fake and the real core: `share_test_run` answers from
// Settings only, with a row per Noter surface, and the optional capture probe is refused during
// a call (capture untouched) and run outside one. The probe's typed failure is a harness control,
// so it is checked on the real core only.
// @cpt-dod:cpt-noter-dod-core-native-services-tests:p1
import { afterEach, describe, expect, it } from "vitest";

import { exercised, isFake } from "../support/core";
import { ok, refused } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import * as W from "../support/world-presets";

let s: Scenario;
afterEach(async () => {
  await s.dispose();
});

const SURFACES = ["call_window", "record_prompt", "main_window", "settings_window", "menu_bar_title"];

/** The scenario's harness: controls are requests on the same wire. */
const harness = () => (s as unknown as { process: { invoke(window: string, cmd: string, args: unknown): Promise<unknown> } }).process;

describe("share_test_run (2.21)", () => {
  it("answers a row per Noter surface from Settings; no other window may run it", async () => {
    s = openScenario({ alsoRecord: exercised, world: W.idle });
    const result = ok(await s.core("settings").shareTestRun({ run_capture_test: false }));
    expect(result.rows.map((r) => r.surface)).toEqual(SURFACES);
    expect(result.capture_test).toEqual({ type: "not_run" });
    for (const w of ["main", "call-screen", "record-prompt", "first-run"] as const) {
      expect(refused(await s.core(w).shareTestRun({ run_capture_test: false })).code).toBe("window_not_allowed");
    }
  });

  it("refuses the capture probe during a call without touching capture, and runs it outside one", async () => {
    s = openScenario({ alsoRecord: exercised });
    const before = ok(await s.core("main").appSnapshot({})).capture;
    expect(before.phase).toBe("recording");
    const live = ok(await s.core("settings").shareTestRun({ run_capture_test: true }));
    expect(live.capture_test).toEqual({ type: "blocked_by_call" });
    const after = ok(await s.core("main").appSnapshot({})).capture;
    expect(after.phase).toBe("recording");
    expect(after.call_id).toBe(before.call_id);
    ok(await s.core("main").captureStop({ call_id: W.LIVE_CALL }));
    const passed = ok(await s.core("settings").shareTestRun({ run_capture_test: true })).capture_test;
    expect(passed.type).toBe("passed");
  });
});

describe.skipIf(isFake)("share_test_run on the real core (2.21)", () => {
  it("reports the probe's typed failure and passes again once it succeeds", async () => {
    s = openScenario({ alsoRecord: exercised, world: W.idle });
    await harness().invoke("main", "harness.share_test_probe", { fail: "permission_denied" });
    expect(ok(await s.core("settings").shareTestRun({ run_capture_test: true })).capture_test).toEqual({ type: "failed", code: "permission_denied" });
    await harness().invoke("main", "harness.share_test_probe", { fail: null });
    expect(ok(await s.core("settings").shareTestRun({ run_capture_test: true })).capture_test.type).toBe("passed");
  });
});
