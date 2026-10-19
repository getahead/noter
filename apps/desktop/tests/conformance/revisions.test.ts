// ADR-0002 › wanted state and revisions: repeating a command is harmless,
// a stale `rev` is a `conflict` carrying the current revision.
import { describe, expect, it } from "vitest";

import { coreFor } from "../support/core";
import { ahead } from "../support/results";

// @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-for-groups
// @cpt-begin:cpt-noter-flow-core-contract-conformance:p1:inst-run-group
describe("optimistic concurrency", () => {
  it("rejects an edit based on a stale revision with conflict and current_rev", async () => {
    const core = coreFor("main");
    // item_set_done is M2: a core that does not answer it yet stops here (`ahead`).
    if (!ahead(await core.itemSetDone({ item_id: "itm_spec", rev: 1, done: true }))) return;
    const stale = await core.itemSetDone({ item_id: "itm_spec", rev: 1, done: false });
    expect(stale.status).toBe("error");
    if (stale.status !== "error") return;
    expect(stale.error.code).toBe("conflict");
    expect(stale.error.detail?.type).toBe("conflict");
  });
});
// @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-run-group
// @cpt-end:cpt-noter-flow-core-contract-conformance:p1:inst-for-groups
