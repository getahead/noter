import { describe, expect, it } from "vitest";
import type { CallRow } from "../../core/bindings";
import type { OutputsProgress } from "../../core/bindings";
import { groupByMonth, nextSort, sortOf, subtitle, withProgress, writing } from "./calls-model";

const at = (y: number, m: number, d: number, ms = 60 * 60_000) =>
  ({
    id: `${y}-${m}-${d}`,
    started_at: Date.UTC(y, m - 1, d, 12),
    duration_ms: ms,
  }) as CallRow;

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
      "en",
      "UTC",
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
      subtitle([at(2026, 9, 2), at(2026, 10, 1, 2 * 3600_000)], 2, 0, "UTC"),
    ).toBe("2 calls · 3 hours · since 2 Sep");
    expect(subtitle([at(2026, 9, 2)], 1, 0, "UTC")).toBe(
      "1 call · 1 hour · since 2 Sep",
    );
  });

  it("adds how many are selected and uses the core's total when it has one", () => {
    expect(subtitle([at(2026, 9, 2)], 212, 3, "UTC")).toContain("212 calls · ");
    expect(subtitle([at(2026, 9, 2)], 212, 3, "UTC")).toMatch(/ · 3 selected$/);
  });
});

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
