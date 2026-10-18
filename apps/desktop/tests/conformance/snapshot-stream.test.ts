// ADR-0002 › snapshot, then stream; whole-state app snapshot per window.
import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION, type TranscriptMsg, type WindowLabel } from "../../src/core/bindings";
import { coreFor } from "../support/core";
import { ahead } from "../support/results";

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
