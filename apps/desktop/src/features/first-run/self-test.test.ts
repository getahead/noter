import { afterEach, describe, expect, it, vi } from "vitest";
import { createCore, type SelfTestEvent, type SelfTestMsg } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import {
  SYSTEM_AUDIO_MISSING, TIMED_OUT, applySelfTestEvent, initialSelfTestPanel, levelsDue, newAnnouncements, ONE_STREAM_SILENT, OWN_SOUNDS_MESSAGE, runSelfTest,
  selfTestNext, type SelfTestInput, type SelfTestPanel, type SelfTestState,
} from "./self-test";

const core = (e: SelfTestEvent): SelfTestInput => ({ type: "core", event: e });
const fold = (panel: SelfTestPanel, ...events: SelfTestEvent[]) => events.reduce(applySelfTestEvent, panel);
const running = (exclude = true) => runSelfTest(initialSelfTestPanel("IDLE", exclude), true);

describe("selfTestNext (cpt-noter-state-ui-first-run-self-test)", () => {
  const table: [SelfTestState, SelfTestInput, SelfTestState][] = [
    ["IDLE", { type: "run", modelReady: false }, "WAITING_FOR_MODEL"],
    ["IDLE", { type: "run", modelReady: true }, "RUNNING"],
    ["FAILED", { type: "run", modelReady: true }, "RUNNING"],
    ["WAITING_FOR_MODEL", { type: "model_arrived" }, "RUNNING"],
    ["IDLE", { type: "system_audio", state: "denied" }, "PERMISSION_MISSING"],
    ["IDLE", { type: "system_audio", state: "not_asked" }, "PERMISSION_MISSING"],
    ["PERMISSION_MISSING", { type: "system_audio", state: "granted" }, "IDLE"],
    ["RUNNING", core({ type: "passed" }), "PASSED"],
    ["RUNNING", core({ type: "failed", reason: { type: "one_stream_silent", channel: "sys" } }), "FAILED"],
    ["RUNNING", core({ type: "failed", reason: { type: "timed_out" } }), "FAILED"],
    ["RUNNING", core({ type: "failed", reason: { type: "zero_buffers" } }), "PERMISSION_MISSING"],
    ["RUNNING", core({ type: "failed", reason: { type: "own_sounds_leak" } }), "PASSED"],
    ["RUNNING", core({ type: "failed", reason: { type: "model_missing" } }), "WAITING_FOR_MODEL"],
    ["RUNNING", core({ type: "failed", reason: { type: "permission_missing", kind: "system_audio" } }), "PERMISSION_MISSING"],
    ["RUNNING", core({ type: "ended", reason: "lagged" }), "IDLE"],
    ["RUNNING", core({ type: "stream_arrived", channel: "mic" }), "RUNNING"],
    ["PASSED", core({ type: "ended", reason: "call_stopped" }), "PASSED"],
    ["FAILED", core({ type: "ended", reason: "call_stopped" }), "FAILED"],
    ["PERMISSION_MISSING", { type: "run", modelReady: true }, "PERMISSION_MISSING"],
    ["PASSED", { type: "run", modelReady: true }, "RUNNING"],
    ["PASSED", { type: "run", modelReady: false }, "WAITING_FOR_MODEL"],
    ["RUNNING", { type: "system_audio", state: "denied" }, "RUNNING"],
    ["IDLE", { type: "system_audio", state: "granted" }, "IDLE"],
    ["IDLE", { type: "model_arrived" }, "IDLE"],
  ];
  it.each(table)("%s on %j is %s", (from, input, to) => expect(selfTestNext(from, input)).toBe(to));
});

describe("applySelfTestEvent (cpt-noter-algo-ui-first-run-self-test-result)", () => {
  it("starts a run with cleared results, and keeps a waiting panel waiting", () => {
    const old = fold(running(), { type: "stream_arrived", channel: "mic" }, { type: "failed", reason: { type: "one_stream_silent", channel: "sys" } });
    const again = runSelfTest(old, true);
    expect(again).toMatchObject({ state: "RUNNING", failure: null, arrived: { mic: false, sys: false }, runEnabled: false });
    expect(runSelfTest(initialSelfTestPanel("IDLE", true), false).state).toBe("WAITING_FOR_MODEL");
    expect(runSelfTest(initialSelfTestPanel("PERMISSION_MISSING", true), true).state).toBe("PERMISSION_MISSING");
  });

  it("updates the meters from levels, with null for a silent side", () => {
    expect(fold(running(), { type: "levels", mic_db: -30, sys_db: null })).toMatchObject({ micDb: -30, sysDb: null });
  });

  it("shows the transcript line with its channel", () => {
    expect(fold(running(), { type: "line", channel: "sys", text: "Noter test. Привет. Hallo." }).line).toEqual({ channel: "sys", text: "Noter test. Привет. Hallo." });
  });

  it("ticks each stream when it arrives", () => {
    const p = fold(running(), { type: "stream_arrived", channel: "sys" });
    expect(p.arrived).toEqual({ mic: false, sys: true });
    expect(fold(p, { type: "stream_arrived", channel: "mic" }).arrived).toEqual({ mic: true, sys: true });
  });

  it("passes with the own-sounds line passed, off or leaked", () => {
    expect(fold(running(true), { type: "passed" })).toMatchObject({ state: "PASSED", aligned: true, ownSounds: "excluded" });
    expect(fold(running(false), { type: "passed" })).toMatchObject({ state: "PASSED", ownSounds: "off" });
    const leaked = fold(running(true), { type: "failed", reason: { type: "own_sounds_leak" } });
    expect(leaked).toMatchObject({ state: "PASSED", aligned: true, ownSounds: "leaked", failure: null });
    expect(fold(leaked, { type: "passed" }).ownSounds).toBe("leaked");
  });

  it("names the silent stream on failure", () => {
    expect(fold(running(), { type: "failed", reason: { type: "one_stream_silent", channel: "sys" } })).toMatchObject({ state: "FAILED", failure: ONE_STREAM_SILENT.sys, runEnabled: true });
    expect(fold(running(), { type: "failed", reason: { type: "one_stream_silent", channel: "mic" } }).failure).toBe(ONE_STREAM_SILENT.mic);
    expect(fold(running(), { type: "failed", reason: { type: "timed_out" } })).toMatchObject({ state: "FAILED", failure: TIMED_OUT, runEnabled: true });
  });

  it("stops the running state on ended and enables Run Test again after a failure", () => {
    const failed = fold(running(), { type: "levels", mic_db: -20, sys_db: -20 }, { type: "failed", reason: { type: "timed_out" } }, { type: "ended", reason: "call_stopped" });
    expect(failed).toMatchObject({ state: "FAILED", micDb: null, sysDb: null, runEnabled: true });
    expect(fold(running(), { type: "ended", reason: "lagged" })).toMatchObject({ state: "IDLE", runEnabled: true });
  });

  it("enables Run Test only when idle or failed", () => {
    expect(initialSelfTestPanel("IDLE", true).runEnabled).toBe(true);
    expect(initialSelfTestPanel("PASSED", true).runEnabled).toBe(true);
    for (const s of ["WAITING_FOR_MODEL", "PERMISSION_MISSING", "RUNNING"] as const) expect(initialSelfTestPanel(s, true).runEnabled).toBe(false);
  });

  it("lets a passed test run again once its stream ended, showing the result until then", () => {
    const passed = fold(running(), { type: "stream_arrived", channel: "sys" }, { type: "passed" }, { type: "ended", reason: "call_stopped" });
    expect(passed).toMatchObject({ state: "PASSED", runEnabled: true, aligned: true, arrived: { sys: true } });
    expect(runSelfTest(passed, true)).toMatchObject({ state: "RUNNING", aligned: false, arrived: { sys: false, mic: false }, runEnabled: false });
    expect(runSelfTest(passed, false).state).toBe("WAITING_FOR_MODEL");
  });

  it("lets the test run again after the own-sounds line failed, so the fix can be proved", () => {
    const leaked = fold(running(), { type: "failed", reason: { type: "own_sounds_leak" } }, { type: "ended", reason: "call_stopped" });
    expect(leaked).toMatchObject({ state: "PASSED", ownSounds: "leaked", runEnabled: true });
    expect(runSelfTest(leaked, true)).toMatchObject({ state: "RUNNING", ownSounds: "pending" });
  });

  it("treats zero buffers as a missing System Audio Recording permission", () => {
    const p = fold(running(), { type: "failed", reason: { type: "zero_buffers" } }, { type: "ended", reason: "call_stopped" });
    expect(p).toMatchObject({ state: "PERMISSION_MISSING", failure: null, runEnabled: false });
    expect(selfTestNext(p.state, { type: "system_audio", state: "granted" })).toBe("IDLE");
    expect(SYSTEM_AUDIO_MISSING).toBe("System audio recording is not allowed yet.");
  });

  it("drops messages that arrive when no test runs, except the meters going quiet", () => {
    const idle = initialSelfTestPanel("IDLE", true);
    expect(applySelfTestEvent(idle, { type: "passed" })).toBe(idle);
    const waiting = initialSelfTestPanel("WAITING_FOR_MODEL", true);
    expect(applySelfTestEvent(waiting, { type: "levels", mic_db: -20, sys_db: -20 })).toBe(waiting);
    const late = fold(running(), { type: "passed" }, { type: "passed" }, { type: "stream_arrived", channel: "mic" });
    expect(late.arrived.mic).toBe(false);
  });

  it("ignores messages that arrive while no test runs, apart from showing them", () => {
    expect(applySelfTestEvent(initialSelfTestPanel("PERMISSION_MISSING", true), { type: "passed" }).state).toBe("PERMISSION_MISSING");
  });
});

describe("levelsDue", () => {
  it("lets a levels message through at most every 100 ms", () => {
    expect(levelsDue(null, 0)).toBe(true);
    expect(levelsDue(1000, 1099)).toBe(false);
    expect(levelsDue(1000, 1100)).toBe(true);
  });
});

describe("newAnnouncements", () => {
  const step = (prev: SelfTestPanel, e: SelfTestEvent) => [applySelfTestEvent(prev, e), newAnnouncements(prev, applySelfTestEvent(prev, e))] as const;

  it("announces each result line once and never the transcript line or the meters", () => {
    let p = running();
    const said: string[] = [];
    for (const e of [
      { type: "stream_arrived", channel: "mic" },
      { type: "levels", mic_db: -30, sys_db: -30 },
      { type: "line", channel: "sys", text: "Noter test." },
      { type: "stream_arrived", channel: "sys" },
      { type: "stream_arrived", channel: "sys" },
      { type: "passed" },
      { type: "ended", reason: "call_stopped" },
    ] as SelfTestEvent[]) {
      const [next, out] = step(p, e);
      said.push(...out);
      p = next;
    }
    expect(said).toEqual(["Your microphone arrives", "System audio arrives", "Both streams line up", OWN_SOUNDS_MESSAGE.excluded, "Self-test passed"]);
  });

  it("announces nothing on a failure", () => {
    expect(step(running(), { type: "failed", reason: { type: "one_stream_silent", channel: "sys" } })[1]).toEqual([]);
  });
});

describe("against the fake core's self-test stream", () => {
  afterEach(() => vi.useRealTimers());

  it("folds the scripted messages into a passed panel", async () => {
    vi.useFakeTimers();
    const fake = new FakeCore({ window: "settings" });
    const messages: SelfTestMsg[] = [];
    const res = await createCore(fake).selfTestRun({ play_clip: true }, (m) => messages.push(m));
    expect(res.status).toBe("ok");
    await vi.advanceTimersByTimeAsync(2000);
    fake.dispose();
    expect(messages.map((m) => m.seq)).toEqual(messages.map((_, i) => i + 1));
    const panel = messages.reduce((p, m) => applySelfTestEvent(p, m.event), running());
    expect(panel).toMatchObject({ state: "PASSED", arrived: { mic: true, sys: true }, aligned: true, ownSounds: "excluded", failure: null });
    expect(panel.line?.text).toBeTruthy();
  });
});
