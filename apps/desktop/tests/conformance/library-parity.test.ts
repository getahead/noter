// Fixture parity for the M1 Library read models (docs/features/core/core-library-calls.md,
// `cpt-noter-dod-core-library-calls-parity`): `calls_list`, `call_get` and the transcript snapshot
// of every fixture call equal the fixture world field by field. Against the fake that proves the
// fake serves the fixture as data; against the real core (seeded with the same calls, segments,
// speakers, marks and gaps by noter-core-harness) it is the parity test. M1 commands go through
// `ahead()`, so a core that does not answer them yet stops at that step.
// @cpt-algo:cpt-noter-algo-core-library-calls-fixture-parity:p2
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FakeWorld } from "../../src/core/bindings";
import worldJson from "../../../../contracts/fixtures/world.json";
import { exercised } from "../support/core";
import { ahead, refused } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import { PAST_CALL } from "../support/world-presets";

const fixture = worldJson as unknown as FakeWorld;

let s: Scenario;
beforeEach(() => {
  s = openScenario({ alsoRecord: exercised });
});
afterEach(async () => {
  await s.dispose();
});

describe.each(fixture.calls.map((c) => [c.id, c] as const))("fixture parity of %s", (id, row) => {
  const detail = fixture.call_details.find((d) => d.call.id === id)!;
  const transcript = fixture.transcripts.find((t) => t.call_id === id)!;

  it("calls_list serves the fixture row", async () => {
    // @cpt-begin:cpt-noter-algo-core-library-calls-fixture-parity:p2:inst-parity-run
    const page = ahead(await s.core("main").callsList({ filter: {}, sort: "newest", page: {} }));
    // @cpt-end:cpt-noter-algo-core-library-calls-fixture-parity:p2:inst-parity-run
    if (!page) return;
    // @cpt-begin:cpt-noter-algo-core-library-calls-fixture-parity:p2:inst-parity-compare
    expect(page.rows.find((r) => r.id === id)).toEqual(row);
    // @cpt-end:cpt-noter-algo-core-library-calls-fixture-parity:p2:inst-parity-compare
  });

  it("call_get serves the fixture detail: the row, speakers, marks and gaps", async () => {
    const got = ahead(await s.core("main").callGet({ call_id: id }));
    if (!got) return;
    expect(got).toEqual(detail);
  });

  it("the transcript snapshot serves the fixture's segments, speakers, marks and gaps", async () => {
    const snap = ahead(await s.core("main").transcriptSubscribe({ call_id: id }, () => {}));
    if (!snap) return;
    // The subscription and `live` follow the capture state, not the stored transcript.
    const { subscription_id: _sub, live: _live, ...stored } = transcript;
    const { subscription_id: _s, live: _l, ...served } = snap;
    // @cpt-begin:cpt-noter-algo-core-library-calls-fixture-parity:p2:inst-parity-return
    expect(served).toEqual(stored);
    // @cpt-end:cpt-noter-algo-core-library-calls-fixture-parity:p2:inst-parity-return
  });
});

describe("a deleted call", () => {
  it("is gone from call_get and the transcript snapshot, with everything recorded in it", async () => {
    const deleted = ahead(await s.core("main").callsDelete({ call_ids: [PAST_CALL] }));
    if (!deleted) return;
    expect(refused(await s.core("main").callGet({ call_id: PAST_CALL })).code).toBe("not_found");
    expect(refused(await s.core("main").transcriptSubscribe({ call_id: PAST_CALL }, () => {})).code).toBe("not_found");
  });
});
