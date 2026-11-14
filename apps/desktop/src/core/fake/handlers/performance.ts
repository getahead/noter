import * as Core from "../fake-core";
import * as shared from "./shared";

export function performanceHandlers(fake: Core.FakeCore): Core.Handlers {
  return {
  // ── Performance (draft) ──────────────────────────────────────────────
  perf_overview: (_a, { world }) => world.performance,
  perf_call: (a, { world }) => {
    const c = shared.call(world, a.call_id);
    const stage = (name: string, ms: number, budget: number) => ({ stage: name, ms, budget_ms: budget, state: ms > budget ? ("over" as const) : ms > 0.9 * budget ? ("near" as const) : ("ok" as const) });
    return {
      call: shared.callRef(c),
      ticks: [
        { tick_id: "tick_1", llm_run_id: "llm_tick_1", at_ms: 61_000, trigger: "question", stages: [stage("signals", 180, 250), stage("first_token", 1900, 2000), stage("full_card", 7600, 9000)], late: false, dropped: false },
        { tick_id: "tick_2", llm_run_id: null, at_ms: 122_000, trigger: "topic_change", stages: [stage("signals", 240, 250)], late: false, dropped: true },
      ],
      dropout_ms: 0,
      cost_usd: 0.31,
      tokens_in: 48_200,
      tokens_out: 3_100,
    };
  },
  perf_brief: (a) => ({ path: `~/Downloads/Noter improvement brief (${a.period}).md`, opened_with: a.action.type === "open_in" ? (a.action.target === "codex" ? "terminal" : "claude_cli_link") : null }),

  };
}
