// DESIGN-core › Stream hub: the UI sends `stream_ack` every 100 messages or after 1 s. The generated
// client's Channel gate does it; a stub transport and fake timers pin the cadence without a core.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCore, type Transport } from "../../src/core/bindings";

/** A transport that answers the subscription and records every `stream_ack`. */
function stub() {
  const acks: unknown[] = [];
  let push: (message: unknown) => void = () => undefined;
  const transport: Transport = {
    invoke: async (cmd, args, onMessage) => {
      if (cmd === "stream_ack") acks.push(args);
      if (onMessage) push = onMessage;
      return { subscription_id: "sub_1", last_seq: 0 };
    },
    listen: async () => () => undefined,
  };
  const send = (from: number, to: number) => {
    for (let seq = from; seq <= to; seq++) push({ seq, event: { type: "confirmed" } });
  };
  return { core: createCore(transport), acks, send };
}

describe("stream_ack cadence of the generated client", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("acks 1 s after the first unacknowledged message, not before", async () => {
    const { core, acks, send } = stub();
    await core.transcriptSubscribe({ call_id: "call_1" }, () => undefined);
    send(1, 3);
    vi.advanceTimersByTime(999);
    expect(acks).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(acks).toEqual([{ subscription_id: "sub_1", seq: 3 }]);
  });

  it("acks at once on the 100th unacknowledged message, and not again for the same messages", async () => {
    const { core, acks, send } = stub();
    await core.transcriptSubscribe({ call_id: "call_1" }, () => undefined);
    send(1, 99);
    expect(acks).toEqual([]);
    send(100, 100);
    expect(acks).toEqual([{ subscription_id: "sub_1", seq: 100 }]);
    vi.advanceTimersByTime(1000);
    expect(acks).toHaveLength(1);
  });
});
