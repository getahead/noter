// Rules the former contract.smoke.ts checked that no other conformance file did (docs/features/core/core-contract.md).
// A step on a later milestone's command goes through `ahead()`, which fails once its milestone is current.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COMMANDS, createCore, DEFAULT_RETRYABLE, ERROR_CODES, type CommandName, type Transport } from "../../src/core/bindings";
import { FakeCore } from "../../src/core/fake/fake-core";
import { isFake } from "../support/core";
import { ahead, ok, pending, refused } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import * as W from "../support/world-presets";

let s: Scenario;
beforeEach(() => {
  s = openScenario();
});
afterEach(async () => {
  await s.dispose();
});

describe("snapshot slices are versioned", () => {
  it("the capture, degraded and banners slices of a snapshot start at version 1 or later", async () => {
    const snap = ok(await s.core("main").appSnapshot({}));
    expect([snap.capture.version, snap.degraded.version, snap.banners.version].every((v) => v >= 1)).toBe(true);
  });
});

describe("window scope: the first-run window may test an account", () => {
  it("account_test from first-run answers (it is not scope-refused)", async () => {
    const res = await s.core("first-run").accountTest({ provider: "claude" });
    if (res.status === "error") expect(res.error.code).not.toBe("window_not_allowed");
  });
});

describe("forced failures are typed CoreErrors", () => {
  it("a search that fails is retryable by its code, and index_rebuilding is not", async () => {
    const filter = { people: [], call_types: [], tags: [], languages: [] };
    await s.failNext("main", "search", "search_failed");
    const first = refused(await s.core("main").search({ query: "drawer", filter }));
    await s.failNext("main", "search", "index_rebuilding");
    const second = refused(await s.core("main").search({ query: "drawer", filter }));
    expect([first.code, second.code]).toEqual(["search_failed", "index_rebuilding"]);
    expect([first.retryable, second.retryable]).toEqual([DEFAULT_RETRYABLE.includes("search_failed"), DEFAULT_RETRYABLE.includes("index_rebuilding")]);
    expect(first.retryable).toBe(true);
    expect(second.retryable).toBe(false);
    expect(ERROR_CODES).toContain(second.code);
  });
});

describe("the generated client maps Tauri's own rejections to contract codes", () => {
  const rejecting = (message: string): Transport => ({ invoke: () => Promise.reject(message), listen: async () => () => {} });
  const code = async (message: string) => refused(await createCore(rejecting(message)).itemsList({ filter: {}, page: {} })).code;
  it("a command outside the window's ACL is window_not_allowed; bad arguments are invalid_input", async () => {
    expect(await code("core:default|items_list not allowed. Command not found")).toBe("window_not_allowed");
    expect(await code("invalid args `args` for command `items_list`: missing field `filter`")).toBe("invalid_input");
  });
});

describe("capture and jobs rules", () => {
  it("un-pausing a stopped call is not_recording (Continue Recording is the way back)", async () => {
    const screen = s.core("call-screen");
    const stopped = ahead(await s.core("main").captureStop({ call_id: W.LIVE_CALL }));
    if (!stopped) return;
    expect(refused(await screen.captureSetPaused({ call_id: W.LIVE_CALL, paused: false })).code).toBe("not_recording");
  });

  it("job_run_now waits while a call is live, except the post-call analysis (D2)", async () => {
    const main = s.core("main");
    const blocked = await main.jobRunNow({ job_id: "job_evidence" });
    if (pending(blocked)) return;
    expect(refused(blocked).code).toBe("job_blocked");
    ok(await main.jobRunNow({ job_id: "job_post_call" }));
  });
});

describe("handoff generation is asynchronous (R45)", () => {
  it("handoff_generate with regenerate answers generating, and cancelling leaves it no longer generating", async () => {
    const main = s.core("main");
    expect(ok(await main.handoffGenerate({ item_id: "itm_replay", regenerate: true })).state.type).toBe("generating");
    expect(ok(await main.handoffCancel({ item_id: "itm_replay" })).state.type).not.toBe("generating");
  });
});

// The fake only: the real core owes its answers by milestone (not-implemented.test.ts), the fake owes every frozen command.
describe.skipIf(!isFake)("the fake answers every frozen command from every window it allows (QA27)", () => {
  it("a reply may be a typed error for empty arguments, never a thrown non-CoreError or not_implemented", async () => {
    const missing: string[] = [];
    for (const name of Object.keys(COMMANDS) as CommandName[]) {
      const spec = COMMANDS[name];
      for (const window of spec.windows) {
        const fake = new FakeCore({ window });
        try {
          await fake.invoke(name, {}, spec.channel ? () => {} : undefined);
        } catch (e) {
          const code = (e as { code?: string }).code;
          expect(code && (ERROR_CODES as readonly string[]).includes(code), `${name} threw a non-CoreError: ${String(e)}`).toBe(true);
          if (code === "not_implemented" && spec.stability === "frozen") missing.push(`${name}@${window}`);
        } finally {
          fake.dispose();
        }
      }
    }
    expect(missing, "frozen commands without a fake handler").toEqual([]);
  });
});
