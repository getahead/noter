import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { effects, refs } = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  refs: [] as { current: unknown }[],
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useEffect: (effect: () => void) => void effects.push(effect),
    useRef: (value: unknown) => {
      const ref = react.useRef(value);
      refs.push(ref);
      return ref;
    },
  };
});
vi.mock("./KeyField", () => ({ KeyField: () => null, useKeyDraft: () => ({ state: "idle" }) }));

const { KeyFieldRow, KeyRow } = await import("./CredentialRow");

afterEach(() => {
  effects.length = 0;
  refs.length = 0;
  vi.unstubAllGlobals();
});

describe("credential row focus recovery", () => {
  it("moves focus from Remove to Add after a successful key removal", () => {
    const focus = vi.fn();
    vi.stubGlobal("document", {
      getElementById: (id: string) => id === "credential-add-codex" ? { focus, hasAttribute: () => false } : null,
    });
    renderToString(<KeyRow view={{ provider: "codex", status: { type: "not_set" } } as never} onAdd={() => {}} onReplace={() => {}} onRemove={() => {}} />);
    refs[0]!.current = true;
    refs[1]!.current = "configured";
    effects.at(-1)!();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("returns focus to the key field after first-run removal", () => {
    const focus = vi.fn();
    vi.stubGlobal("document", {
      getElementById: (id: string) => id === "fr-key-codex" ? { focus, hasAttribute: () => false } : null,
    });
    renderToString(<KeyFieldRow bridge={{} as never} view={{ provider: "codex", status: { type: "not_set" } } as never} onRemove={() => {}} />);
    refs[0]!.current = true;
    refs[1]!.current = true;
    effects.at(-1)!();
    expect(focus).toHaveBeenCalledOnce();
  });
});
