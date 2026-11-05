import { describe, expect, it } from "vitest";
import type { ChangeRow, UiPrefs } from "../../core/bindings";
import { actorLabel, groupByDay, historyKey, historyState, jobsOf, sameTarget, undoTarget } from "./history";

const prefs: UiPrefs = { time_format: "h24", first_weekday: 1, time_zone: "UTC" };
const NOW = Date.UTC(2026, 10, 5, 12);
const row = (id: string, at: number, over: Partial<ChangeRow> = {}) => ({ id, at, actor: { type: "you" }, batch_id: null, batch_size: 1, ...over }) as ChangeRow;

describe("history (cpt-noter-flow-ui-history-undo-read)", () => {
  it("groups newest first as Today, Yesterday, then dates", () => {
    const g = groupByDay([row("a", NOW - 86_400_000 * 5), row("b", NOW), row("c", NOW - 86_400_000), row("d", NOW - 1000)], NOW, prefs);
    expect(g.map((x) => x.day)).toEqual(["Today", "Yesterday", "Oct 31"]);
    expect(g[0]!.rows.map((r) => r.id)).toEqual(["b", "d"]);
  });

  it("keys a read by target, actor and job", () => {
    const k = (a: "all" | "you", j: string | null) => historyKey({ type: "call", call_id: "c1" }, a, j);
    expect(k("all", null)).not.toBe(k("you", null));
    expect(k("all", null)).not.toBe(k("all", "job_1"));
    expect(historyKey({ type: "all" }, "all", null)).toBe("history:all:all:");
  });

  it("names the read state", () => {
    const s = (o: Partial<Parameters<typeof historyState>[0]>) => historyState({ loading: false, failed: false, rows: 0, filtered: false, ...o });
    expect(s({ loading: true })).toBe("LOADING");
    expect(s({ rows: 3 })).toBe("READY");
    expect(s({})).toBe("EMPTY");
    expect(s({ filtered: true })).toBe("FILTERED_EMPTY");
    expect(s({ failed: true, loading: true })).toBe("ERROR");
  });

  it("lists each job once and targets a batch by its id, a single change by its own", () => {
    const job = { type: "job", job_id: "job_1", name: "Reconcile" } as const;
    expect(jobsOf([row("a", 1, { actor: job }), row("b", 2, { actor: job }), row("c", 3)])).toEqual([{ id: "job_1", name: "Reconcile" }]);
    expect(undoTarget(row("a", 1, { batch_id: "bat_1", batch_size: 37 }))).toEqual({ type: "batch", batch_id: "bat_1" });
    expect(undoTarget(row("a", 1, { batch_id: "bat_1", batch_size: 1 }))).toEqual({ type: "change", change_id: "a" });
    expect(sameTarget({ type: "change", change_id: "a" }, { type: "change", change_id: "a" })).toBe(true);
    expect(sameTarget({ type: "change", change_id: "a" }, { type: "batch", batch_id: "a" })).toBe(false);
  });

  it("labels the actor", () => {
    expect(actorLabel(row("a", 1))).toBe("you");
    expect(actorLabel(row("a", 1, { actor: { type: "job", job_id: "j", name: "Reconcile" } }))).toBe("job: Reconcile");
    expect(actorLabel(row("a", 1, { actor: { type: "model", llm_run_id: "r", runtime: "claude_account", model: "m" } }))).toBe("model: Claude");
  });
});
