import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AskAnswer, AskRating } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { AnswerFeedback } from "./AnswerFeedback";

const answer = (rating: AskRating | null = null) => ({ turn_id: "t1", rating, stopped: false } as AskAnswer);

describe("answer feedback (cpt-noter-dod-ui-ask-citations)", () => {
  it("renders acknowledged feedback, measured work and singular/plural labels; stopped answers cannot be rated", () => {
    const a = { ...answer("not_helpful"), meta: { call_hits: 1, item_hits: 0, document_hits: 2, elapsed_ms: 123 } };
    const h = renderToString(<AnswerFeedback bridge={{} as never} answer={a} />);
    expect(h).toContain("1 transcript match");
    expect(h).toContain("0 item matches");
    expect(h).toContain("2 document matches");
    expect(h).toContain("123 ms");
    expect(h).toMatch(/aria-pressed="true"[^>]*><span>Not helpful/);
    const stopped = renderToString(<AnswerFeedback bridge={{} as never} answer={{ ...answer(), stopped: true }} />);
    expect(stopped).not.toContain("<button");
    expect(stopped).not.toContain("matches");
  });

  for (const [stored, chosen, next, status] of [
    [null, "helpful", "helpful", "ok"],
    ["helpful", "helpful", null, "ok"],
    ["helpful", "not_helpful", "not_helpful", "error"],
  ] as const) {
    it(`sends ${String(next)} from ${String(stored)} and handles ${status} without duplicate writes`, async () => {
      let finish!: (value: unknown) => void;
      const result = new Promise((resolve) => { finish = resolve; });
      const core = { askRate: vi.fn(() => result) };
      const act = vi.fn((_key, _cmd, run: () => Promise<unknown>) => run());
      const tree = rendered(AnswerFeedback, { bridge: { act, core } as never, answer: answer(stored) });
      const click = find(tree, (p) => p.label === (chosen === "helpful" ? "Helpful" : "Not helpful")).props.onAction as () => void;
      click();
      click();
      expect(core.askRate).toHaveBeenCalledExactlyOnceWith({ turn_id: "t1", rating: next });
      finish({ status, error: { code: "internal" } });
      await result;
      await Promise.resolve();
      click(); // the pending guard releases on both success and failure
      expect(core.askRate).toHaveBeenCalledTimes(2);
    });
  }
});
