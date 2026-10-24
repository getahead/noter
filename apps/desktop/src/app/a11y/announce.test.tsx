import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Politeness, Result, Ack } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { createBridge } from "../bridge/bridge";
import {
  announcerFor,
  createAnnouncer,
  routeAnnouncement,
  writeLive,
  type AnnounceKind,
} from "./announce";
import { LiveRegions } from "./LiveRegions";

const ok: Result<Ack> = { status: "ok", data: {} };
const key = { label: "main", isKey: true } as const;

describe("routeAnnouncement", () => {
  it.each([
    "transcript_line",
    "level_meter",
    "clock_tick",
    "countdown_second",
  ] as AnnounceKind[])("never announces %s", (kind) => {
    expect(
      routeAnnouncement({ kind, text: "x", key: "1" }, key, new Set()),
    ).toBeNull();
  });

  it("is assertive for capture failures and decisions, polite otherwise", () => {
    for (const kind of [
      "capture_failure",
      "call_ended",
      "new_meeting",
    ] as AnnounceKind[])
      expect(
        routeAnnouncement({ kind, text: "x", key: "1" }, key, new Set()),
      ).toEqual({ route: "live", politeness: "assertive" });
    expect(
      routeAnnouncement({ kind: "undo", text: "x", key: "1" }, key, new Set()),
    ).toEqual({ route: "live", politeness: "polite" });
  });

  it("announces an event once", () => {
    const seen = new Set<string>();
    expect(
      routeAnnouncement({ kind: "undo", text: "x", key: "1" }, key, seen),
    ).not.toBeNull();
    expect(
      routeAnnouncement({ kind: "undo", text: "x", key: "1" }, key, seen),
    ).toBeNull();
    // the same text as a new event (another save) is spoken again
    expect(
      routeAnnouncement({ kind: "undo", text: "x", key: "2" }, key, seen),
    ).not.toBeNull();
  });

  it("goes native only for a panel that is not key", () => {
    const e = { kind: "recording", text: "x", key: "1" } as const;
    expect(
      routeAnnouncement(e, { label: "call-screen", isKey: false }, new Set())
        ?.route,
    ).toBe("native");
    expect(
      routeAnnouncement(
        { ...e, text: "a" },
        { label: "record-prompt", isKey: false },
        new Set(),
      )?.route,
    ).toBe("native");
    expect(
      routeAnnouncement(e, { label: "call-screen", isKey: true }, new Set())
        ?.route,
    ).toBe("live");
    expect(
      routeAnnouncement(e, { label: "main", isKey: false }, new Set())?.route,
    ).toBe("live");
  });
});

describe("createAnnouncer", () => {
  const mk = (
    label: "main" | "call-screen",
    isKey: boolean,
    native = vi.fn(async (): Promise<Result<Ack>> => ok),
  ) => {
    const live = vi.fn();
    return {
      native,
      live,
      announce: createAnnouncer({ label, isKey: () => isKey, native, live }),
    };
  };

  it("writes the live region in a key window, once", async () => {
    const t = mk("main", true);
    await t.announce({ kind: "confirmation", text: "Copied", key: "1" });
    await t.announce({ kind: "confirmation", text: "Copied", key: "1" });
    expect(t.live).toHaveBeenCalledTimes(1);
    expect(t.live).toHaveBeenCalledWith("polite", "Copied");
    expect(t.native).not.toHaveBeenCalled();
  });

  it("goes native from a panel that is not key", async () => {
    const t = mk("call-screen", false);
    await t.announce({
      kind: "recording",
      text: "Recording started",
      key: "1",
    });
    expect(t.native).toHaveBeenCalledWith({
      text: "Recording started",
      politeness: "polite",
    });
    expect(t.live).not.toHaveBeenCalled();
  });

  it("falls back to the live region when the native call fails", async () => {
    const t = mk(
      "call-screen",
      false,
      vi.fn(
        async () =>
          ({
            status: "error",
            error: { code: "offline" },
          }) as unknown as Result<Ack>,
      ),
    );
    await t.announce({ kind: "call_ended", text: "Call ended", key: "1" });
    expect(t.live).toHaveBeenCalledWith("assertive", "Call ended");
  });

  it("says nothing for silent events", async () => {
    const t = mk("main", true);
    await t.announce({ kind: "level_meter", text: "0.5", key: "1" });
    expect(t.live).not.toHaveBeenCalled();
  });
});

describe("writeLive", () => {
  it("clears the matching region, sets it a moment later (so a repeated text is a change) and ignores a missing one", () => {
    vi.useFakeTimers();
    const el = { textContent: "old" };
    const writes: string[] = [];
    Object.defineProperty(el, "textContent", {
      get: () => "",
      set: (v: string) => void writes.push(v),
    });
    const q = vi.fn((s: string) => (s === '[data-live="polite"]' ? el : null));
    const write = writeLive({ querySelector: q } as never);
    write("polite" as Politeness, "hi");
    expect(writes).toEqual([""]);
    vi.runAllTimers();
    expect(writes).toEqual(["", "hi"]);
    write("assertive", "x");
    vi.runAllTimers();
    expect(writes).toHaveLength(2);
    vi.useRealTimers();
  });
});

describe("announcerFor", () => {
  it("shares one announcer per bridge", () => {
    const bridge = createBridge("main", new FakeCore({ window: "main" }));
    const env = { isKey: () => true, live: vi.fn() };
    expect(announcerFor(bridge, env)).toBe(announcerFor(bridge, env));
  });
});

describe("LiveRegions", () => {
  it("renders a polite status region and an assertive live region that is not an alert", () => {
    const html = renderToString(<LiveRegions />);
    expect(html).toContain('data-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).toContain('data-live="assertive"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).not.toContain('role="alert"'); // an empty region must not read as an error alert
  });
});
