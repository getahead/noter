// ADR-0002 › snapshot, then stream; whole-state app snapshot per window.
import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION, createCore, type SelfTestMsg, type TranscriptMsg, type Transport, type WindowLabel } from "../../src/core/bindings";
import { coreFor } from "../support/core";
import { ahead, ok, until } from "../support/results";
import { openScenario } from "../support/scenario";

// @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-for-groups
// @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-run-group
const WINDOWS: WindowLabel[] = ["main", "call-screen", "record-prompt", "settings", "first-run"];

describe("app snapshot", () => {
  it.each(WINDOWS)("%s gets a snapshot for itself with a compatible contract version", async (window) => {
    const res = await coreFor(window).appSnapshot({});
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.data.window).toBe(window);
    expect(res.data.contract_version.split(".")[0]).toBe(CONTRACT_VERSION.split(".")[0]);
  });
});

describe("transcript stream", () => {
  it("continues from last_seq with no gap and no duplicate", async () => {
    const core = coreFor("call-screen");
    const got: TranscriptMsg[] = [];
    // transcript_subscribe is M1: a core that does not answer it yet stops here (`ahead`).
    const sub = ahead(await core.transcriptSubscribe({ call_id: "call_live" }, (m) => got.push(m)));
    if (!sub) return;
    await expect.poll(() => got.length, { timeout: 8000, interval: 100 }).toBeGreaterThanOrEqual(2);
    got.forEach((m, i) => expect(m.seq).toBe(sub.last_seq + i + 1));
  });
});

// core-ipc-host AC: Tauri can hand a Channel message to the page before the subscribing `invoke`
// resolves. The core never writes one before the result on its wire (crates/noter-core-harness/tests/wire.rs),
// so the page side is reproduced here: the window's transport holds the result back until the core's
// first message has arrived, and replays that message once more, as a duplicate.
describe("snapshot, then stream: a Channel message that arrives before the snapshot", () => {
  it("is delivered after the subscribing invoke resolves, once and in seq order; nothing with seq <= last_seq", async () => {
    const s = openScenario();
    // The scenario's raw transport for the window (protected: the stories only use the typed client).
    const raw = (s as unknown as { transport(window: WindowLabel, fresh: boolean): Transport }).transport("settings", true);
    const wire: SelfTestMsg[] = [];
    let invoking = false;
    const held: Transport = {
      async invoke(cmd, args, onMessage) {
        if (!onMessage) return raw.invoke(cmd, args); // the gate's own stream_ack
        invoking = true;
        const result = await raw.invoke(cmd, args, (m) => (wire.push(m as SelfTestMsg), onMessage(m)));
        await until(() => wire.length >= 1, "a Channel message before the subscribing invoke resolves");
        onMessage(wire[0]);
        invoking = false;
        return result;
      },
      listen: (event, handler) => raw.listen(event, handler),
    };
    const got: Array<{ msg: SelfTestMsg; early: boolean }> = [];
    try {
      ok(await createCore(held).selfTestRun({ play_clip: false }, (msg) => got.push({ msg, early: invoking })));
      await until(() => got.some((g) => g.msg.event.type === "ended"), "the self-test stream to end");
    } finally {
      await s.dispose();
    }
    // The self-test's handle has no last_seq: its stream starts at 1 (last_seq = 0).
    expect(wire[0].seq).toBe(1);
    expect(got.filter((g) => g.early)).toEqual([]);
    expect(got[0].msg).toEqual(wire[0]);
    got.forEach((g, i) => expect(g.msg.seq).toBe(i + 1));
  });
});
// @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-run-group
// @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-for-groups
