// The fake core's scenario controls that stories rely on (fake only).
import { describe, expect, it } from "vitest";

import { createCore, ERROR_CODES } from "../../src/core/bindings";
import { isFake, fakeFor } from "../support/core";

describe.skipIf(!isFake)("fake core controls", () => {
  it("failNext makes the next call fail with that typed error, once", async () => {
    const fake = fakeFor("main");
    const core = createCore(fake);
    fake.failNext("glossary_list", "offline");
    const first = await core.glossaryList({});
    expect(first.status).toBe("error");
    if (first.status === "error") expect(ERROR_CODES).toContain(first.error.code);
    const second = await core.glossaryList({});
    expect(second.status).toBe("ok");
  });

  it("returns copies, so the UI never holds references into core state", async () => {
    const fake = fakeFor("main");
    const core = createCore(fake);
    const a = await core.appSnapshot({});
    const b = await core.appSnapshot({});
    expect(a.status === "ok" && b.status === "ok" && a.data !== b.data).toBe(true);
  });
});
