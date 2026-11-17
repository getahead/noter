import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { effects, refs, buttons } = vi.hoisted(() => ({
  buttons: [] as { id?: string; onAction?: () => void }[],
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
vi.mock("../../ui/primitives/push-button", () => ({ PushButton: (props: { id?: string }) => (buttons.push(props), null) }));
vi.mock("./KeyField", () => ({ KeyField: () => null, useKeyDraft: () => ({ state: "idle" }) }));

const { KeyFieldRow, KeyRow } = await import("./CredentialRow");

afterEach(() => {
  effects.length = 0;
  refs.length = 0;
  buttons.length = 0;
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

  it("notes that Remove started the removal, by a mouse press or the keyboard", () => {
    for (const [render, id] of [
      [() => renderToString(<KeyRow view={{ provider: "codex", status: { type: "configured" } } as never} onAdd={() => {}} onReplace={() => {}} onRemove={() => {}} />), "credential-remove-codex"],
      [() => renderToString(<KeyFieldRow bridge={{} as never} view={{ provider: "codex", status: { type: "configured" } } as never} onRemove={() => {}} />), "first-run-key-remove-codex"],
    ] as const) {
      buttons.length = 0;
      refs.length = 0;
      const button = { id: "x", focus: vi.fn() };
      vi.stubGlobal("document", { body: {}, activeElement: button });
      render();
      const remove = buttons.find((b) => b.id?.includes("remove"));
      expect(remove, id).toBeDefined();
      button.id = remove!.id!;
      remove!.onAction!();
      expect(refs[0]!.current).toBe(true);
    }
  });
});
