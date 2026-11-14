import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallRow, UiPrefs } from "../../core/bindings";
import type { OutputsProgress } from "../../core/bindings";
import { groupByMonth, nextSort, sortOf, subtitle, withProgress, writing } from "./calls-model";

const at = (y: number, m: number, d: number, ms = 60 * 60_000) =>
  ({
    id: `${y}-${m}-${d}`,
    started_at: Date.UTC(y, m - 1, d, 12),
    duration_ms: ms,
  }) as CallRow;
const prefs = (time_zone: string) => ({ time_zone, time_format: "h24" }) as UiPrefs;

describe("sort columns", () => {
  it("toggles When between newest and oldest and keeps the others on their one order", () => {
    expect(nextSort("newest", "when")).toBe("oldest");
    expect(nextSort("oldest", "when")).toBe("newest");
    expect(nextSort("newest", "length")).toBe("longest");
    expect(nextSort("longest", "length")).toBe("longest");
    expect(nextSort("newest", "call")).toBe("title");
  });

  it("names each column's state for aria-sort", () => {
    expect(sortOf("newest", "when")).toBe("desc");
    expect(sortOf("oldest", "when")).toBe("asc");
    expect(sortOf("longest", "length")).toBe("desc");
    expect(sortOf("title", "call")).toBe("asc");
    expect(sortOf("title", "when")).toBeUndefined();
  });
});

describe("groupByMonth", () => {
  it("starts a group at each month change, in the order given, with the month named", () => {
    const g = groupByMonth(
      [at(2026, 10, 5), at(2026, 10, 1), at(2026, 9, 30)],
      prefs("UTC"),
    );
    expect(g.map((x) => [x.label, x.rows.length])).toEqual([
      ["October 2026", 2],
      ["September 2026", 1],
    ]);
  });
});

describe("subtitle", () => {
  it("counts calls, hours and the first day with plural rules", () => {
    expect(
      subtitle([at(2026, 9, 2), at(2026, 10, 1, 2 * 3600_000)], 2, 0, prefs("UTC")),
    ).toBe("2 calls · 3 hours · since Sep 2");
    expect(subtitle([at(2026, 9, 2)], 1, 0, prefs("UTC"))).toBe(
      "1 call · 1 hour · since Sep 2",
    );
  });

  it("gives the count alone while only part of the library is loaded", () => {
    expect(subtitle([at(2026, 9, 2)], 212, 0, prefs("UTC"))).toBe("212 calls");
  });

  it("adds how many are selected and uses the core's total when it has one", () => {
    expect(subtitle([at(2026, 9, 2)], 212, 3, prefs("UTC"))).toContain("212 calls · ");
    expect(subtitle([at(2026, 9, 2)], 212, 3, prefs("UTC"))).toMatch(/ · 3 selected$/);
  });

  it("formats the since date in the interface locale and the user's time zone", () => {
    vi.stubGlobal("navigator", { language: "en-GB" });
    const row = at(2026, 9, 2);
    row.started_at = Date.UTC(2026, 8, 2, 0, 30);
    expect(subtitle([row], 1, 0, prefs("America/Los_Angeles"))).toBe(
      "1 call · 1 hour · since 1 Sept",
    );
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("outputs:progress on the rows (inst-live-status)", () => {
  const sec = (call_id: string, section: string, type: string) =>
    ({ [`${call_id}/${section}`]: { call_id, section, state: { type } } }) as unknown as Record<string, OutputsProgress>;
  const row = (id: string, outputs: string) => ({ id, outputs }) as CallRow;

  it("shows Writing while a section is being written, and ready or failed when none is", () => {
    const rows = [row("a", "ready"), row("b", "writing"), row("c", "ready")];
    const progress = { ...sec("a", "summary", "writing"), ...sec("b", "summary", "ready"), ...sec("b", "actions", "failed") };
    expect(withProgress(rows, progress).map((r) => r.outputs)).toEqual(["writing", "failed", "ready"]);
    expect(withProgress(rows, {})).toBe(rows);
  });

  it("keeps a row the progress agrees with, and reads the sidebar's glyph off any writing section", () => {
    const rows = [row("a", "ready")];
    expect(withProgress(rows, sec("a", "summary", "ready"))).toBe(rows);
    expect(writing(sec("a", "summary", "writing"))).toBe(true);
    expect(writing({ ...sec("a", "summary", "ready"), ...sec("b", "actions", "pending") })).toBe(false);
  });
});
