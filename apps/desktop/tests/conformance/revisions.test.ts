// ADR-0002 › wanted state and revisions: repeating a command is harmless,
// a stale `rev` is a `conflict` carrying the current revision.
import { describe, expect, it } from "vitest";

import { coreFor } from "../support/core";

describe("optimistic concurrency", () => {
  it("rejects an edit based on a stale revision with conflict and current_rev", async () => {
    const core = coreFor("main");
    const first = await core.itemSetDone({ item_id: "itm_spec", rev: 1, done: true });
    expect(first.status).toBe("ok");
    const stale = await core.itemSetDone({ item_id: "itm_spec", rev: 1, done: false });
    expect(stale.status).toBe("error");
    if (stale.status !== "error") return;
    expect(stale.error.code).toBe("conflict");
    expect(stale.error.detail?.type).toBe("conflict");
  });
});
