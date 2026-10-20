// The fake core's scenario controls that stories rely on (fake only).
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCore, ERROR_CODES } from "../../src/core/bindings";
import { isFake, fakeFor } from "../support/core";

describe.skipIf(!isFake)("fake core controls", () => {
  afterEach(() => vi.useRealTimers());

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

  it("corruptNextDownload fails the speech bundle's check once; retry brings it to ready", async () => {
    vi.useFakeTimers();
    const fake = fakeFor("first-run");
    const core = createCore(fake);
    fake.world.app.setup.models.bundles.forEach((b) => Object.assign(b, { state: "pending", done_mb: 0 }));
    fake.corruptNextDownload();
    const speech = () => fake.world.app.setup.models.bundles.find((b) => b.required_for_capture)!;

    expect((await core.modelsDownload({ action: "start" })).status).toBe("ok");
    await vi.advanceTimersByTimeAsync(800);
    expect(speech().state).toBe("checksum_failed");
    expect(fake.world.app.setup.models.error).toBe("checksum_failed");

    const retried = await core.modelsDownload({ action: "retry" });
    expect(retried.status === "ok" && retried.data.models.error).toBeNull();
    await vi.advanceTimersByTimeAsync(800);
    expect(speech().state).toBe("ready");
    expect(fake.world.app.setup.models.error).toBeNull();
  });

  it("returns copies, so the UI never holds references into core state", async () => {
    const fake = fakeFor("main");
    const core = createCore(fake);
    const a = await core.appSnapshot({});
    const b = await core.appSnapshot({});
    expect(a.status === "ok" && b.status === "ok" && a.data !== b.data).toBe(true);
  });
});
