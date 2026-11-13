import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const { effects, stateValues, stateIndex } = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  stateValues: [] as unknown[],
  stateIndex: { value: 0 },
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useEffect: (effect: () => void) => void effects.push(effect),
    useState: (initial: unknown) => {
      const index = stateIndex.value++;
      if (index >= 3) return react.useState(initial);
      return [stateValues[index], (value: unknown) => {
        stateValues[index] = typeof value === "function" ? (value as (previous: unknown) => unknown)(stateValues[index]) : value;
      }];
    },
  };
});
vi.mock("../../ui/dialogs/host", async (importOriginal) => {
  const host = await importOriginal<typeof import("../../ui/dialogs/host")>();
  return { ...host, useAlert: () => async () => true, useSheet: () => ({ open: vi.fn() }) };
});

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { EmptyState } from "../../ui/feedback/empty-state";
import { RepositoriesPane } from "./RepositoriesPane";
import { GlossaryGroup } from "./GlossaryGroup";
import { byTerm } from "./glossary";
import { readRepos, resetRepos } from "../handoff/mappings";

let bridge: Bridge;
let fake: FakeCore;
const draw = (Component: (props: { bridge: Bridge }) => ReactNode) => rendered(Component, { bridge });
const configureState = (values: unknown[]) => {
  stateValues.splice(0, stateValues.length, ...values);
  stateIndex.value = 0;
};

beforeEach(async () => {
  resetRepos();
  fake = new FakeCore({ window: "settings" });
  bridge = createBridge("settings", fake);
  await bridge.open();
});
afterEach(async () => {
  await bridge.close();
  resetRepos();
  effects.length = 0;
  stateValues.length = 0;
  stateIndex.value = 0;
  vi.unstubAllGlobals();
});

describe("focus after removing a row", () => {
  it("moves from Glossary minus to the next term after removal", async () => {
    const terms = byTerm(fake.world.glossary.terms);
    configureState([terms, terms[0]!.id, null]);
    const focus = vi.fn();
    vi.stubGlobal("document", {
      activeElement: { id: "glossary-remove" },
      getElementById: (id: string) => id === "g0" ? { focus, hasAttribute: () => false } : null,
    });
    const before = draw(GlossaryGroup);
    const restore = effects.find((effect) => effect.toString().includes("focusAfterRemove.current"));
    expect(restore).toBeDefined();
    const foot = find(before, (props) => props.foot !== undefined).props.foot as ReactNode;
    (find(foot, (props) => props.id === "glossary-remove").props.onAction as () => void)();
    await vi.waitFor(() => expect(fake.world.glossary.terms).toHaveLength(terms.length - 1));
    restore!();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("focuses the Empty state add action after removing the last repository", async () => {
    await readRepos(bridge);
    const mapping = fake.world.repos.mappings[0]!;
    configureState([mapping.id, false, null]);
    const focus = vi.fn();
    vi.stubGlobal("document", {
      activeElement: { id: "repo-remove" },
      getElementById: (id: string) => id === "repo-add" ? { focus, hasAttribute: () => false } : null,
    });
    const before = draw(RepositoriesPane);
    const restore = effects.find((effect) => effect.toString().includes("focusAfterRemove.current"));
    expect(restore).toBeDefined();
    const foot = find(before, (props) => props.foot !== undefined).props.foot as ReactNode;
    (find(foot, (props) => props.id === "repo-remove").props.onAction as () => void)();
    await vi.waitFor(() => expect(fake.world.repos.mappings).toHaveLength(0));
    configureState([null, false, null]);
    const after = draw(RepositoriesPane);
    const emptyState = find(after, (props) => props.title === "No repositories mapped");
    const afterContents = rendered(EmptyState, emptyState.props as never);
    expect(find(afterContents, (props) => props.id === "repo-add")).toBeDefined();
    restore!();
    expect(focus).toHaveBeenCalledOnce();
  });
});
