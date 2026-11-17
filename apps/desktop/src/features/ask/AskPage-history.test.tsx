import { afterEach, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { AskAnswer } from "../../core/bindings";
import { rendered } from "../../ui/testing";
import { currentRoute } from "../shell/shell-state";
import { historyMove, INITIAL_HISTORY } from "../shell/history";
import { navigateEffect } from "../shell/navigate";
import { AskPage } from "./AskPage";

const phase = vi.hoisted(() => ({ layout: [] as (() => void)[], passive: [] as (() => void)[], state: [] as unknown[], at: 0 }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useEffect: (effect: () => void) => void phase.passive.push(effect),
    useLayoutEffect: (effect: () => void) => void phase.layout.push(effect),
    useState: (initial: unknown) => react.useState(phase.at < phase.state.length ? phase.state[phase.at++] : initial),
  };
});

afterEach(() => {
  phase.layout.length = 0;
  phase.passive.length = 0;
  phase.state.length = 0;
  phase.at = 0;
});

it("stores the routed Ask entry before Back can leave it (cpt-noter-seq-ask-follow-up-and-copy)", () => {
  const route = { section: "ask" as const, key: "new:Question" };
  let history = historyMove(INITIAL_HISTORY, { type: "push", route }).history;
  const release = navigateEffect((event) => {
    if (event.type === "move") history = historyMove(history, event.move).history;
  });
  try {
    const answer = { turn_id: "turn_1", question: "Question", answer_md: "Answer", citations: [] } as unknown as AskAnswer;
    phase.state.push([], "ask_1", [answer], "", null, "", false);
    const bridge = { store: { getState: () => ({ streams: {}, commands: {}, entities: {}, whole: {} }), subscribe: () => () => {} } } as unknown as Bridge;
    rendered(AskPage, { bridge, routeKey: route.key });
    // The ready view commits, then Back arrives before passive effects are flushed.
    const settlement = (effects: (() => void)[]) => effects.filter((run) => run.toString().includes("settleRoute")).forEach((run) => run());
    settlement(phase.layout);
    history = historyMove(history, { type: "back" }).history;
    settlement(phase.passive);
    expect(currentRoute(history)).toEqual({ section: "today", key: "root" });
    expect(historyMove(history, { type: "forward" }).route).toEqual({ section: "ask", key: "thread:ask_1" });
  } finally {
    release();
  }
});
