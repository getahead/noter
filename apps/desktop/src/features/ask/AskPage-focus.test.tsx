import { afterEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  refs: [] as { current: unknown }[],
  refAt: 0,
  state: [] as unknown[],
  stateAt: 0,
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useEffect: (effect: () => void) => void hooks.effects.push(effect),
    useRef: (initial: unknown) => (hooks.refs[hooks.refAt++] ??= { current: initial }),
    useState: (initial: unknown) => {
      const at = hooks.stateAt++;
      return at < hooks.state.length ? [hooks.state[at], vi.fn()] : react.useState(initial);
    },
  };
});

import type { Bridge } from "../../app/bridge/bridge";
import type { AskMsg } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { AskPage, AskView, type AskViewProps } from "./AskPage";

afterEach(() => {
  hooks.effects.length = 0;
  hooks.refs.length = 0;
  hooks.state.length = 0;
  hooks.refAt = hooks.stateAt = 0;
  messages = null;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

let messages: AskMsg[] | null = null;
const bridge = {
  store: {
    getState: () => ({ streams: messages ? { ask_start: { data: { turn_id: "turn", thread_id: "thread", messages } } } : {}, commands: {}, entities: {}, whole: {} }),
    subscribe: () => () => {},
  },
  subscribe: vi.fn(),
  act: vi.fn(() => new Promise(() => {})),
} as unknown as Bridge;

function draw(asking: string | null = null) {
  hooks.effects.length = 0;
  hooks.refAt = hooks.stateAt = 0;
  hooks.state = [[], null, [], "", asking, "", false, undefined];
  const props = find(rendered(AskPage, { bridge }), (_props, type) => type === AskView).props as unknown as AskViewProps;
  const focusEffect = hooks.effects.find((effect) => effect.toString().includes("focusComposer"));
  expect(focusEffect).toBeDefined();
  return { props, commit: () => focusEffect!() };
}

function documentWithFocus(active: object | null = null) {
  const focus = vi.fn();
  const body = {};
  const doc = { body, activeElement: active ?? body, getElementById: () => ({ focus, hasAttribute: () => false }) };
  vi.stubGlobal("document", doc);
  return { doc, focus };
}

describe("Ask composer focus (cpt-noter-flow-ui-ask-question)", () => {
  it("leaves lost focus alone when an ordinary answer starts or settles", () => {
    const { focus } = documentWithFocus();
    draw().commit();
    draw("Question").commit();
    draw(null).commit();
    expect(focus).not.toHaveBeenCalled();
  });

  it.each(["onWiden", "onRetry"] as const)("restores focus once after %s replaces its control", (action) => {
    const { focus } = documentWithFocus();
    const before = draw("Question");
    before.commit();
    if (action === "onWiden") before.props.onWiden!("Question");
    else before.props.onRetry();
    draw("Question").commit();
    expect(focus).toHaveBeenCalledOnce();
    draw(null).commit();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("restores lost focus once after the core confirms Stop", () => {
    const { focus } = documentWithFocus();
    messages = [];
    const before = draw("Question");
    before.commit();
    before.props.onStop();
    expect(bridge.act).toHaveBeenCalledWith("ask:stop", "ask_stop", expect.any(Function));
    expect(focus).not.toHaveBeenCalled();
    messages = [{ seq: 1, event: { type: "failed", error: { code: "answer_stopped", message: "Stopped", retryable: false, detail: null } } }];
    draw("Question").commit();
    expect(focus).toHaveBeenCalledOnce();
    draw(null).commit();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("does not take focus from a control after recovery, or on later unrelated updates", () => {
    const { doc, focus } = documentWithFocus({ matches: () => false });
    const before = draw("Question");
    before.commit();
    before.props.onRetry();
    draw("Question").commit();
    expect(focus).not.toHaveBeenCalled();
    doc.activeElement = doc.body;
    draw(null).commit();
    expect(focus).not.toHaveBeenCalled();
  });

  it("drops a pending Stop focus hand-off when another thread is opened", () => {
    const { focus } = documentWithFocus();
    messages = [];
    const before = draw("Question");
    before.commit();
    before.props.onStop();
    before.props.onOpen("other-thread");
    draw(null).commit();
    expect(focus).not.toHaveBeenCalled();
  });
});
