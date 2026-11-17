import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { effects, refs, buttons, sheets, open } = vi.hoisted(() => ({
  open: { asking: false },
  sheets: [] as { onConfirm: (also: boolean) => void }[],
  buttons: [] as { id?: string; onAction?: () => void }[],
  effects: [] as (() => void)[],
  refs: [] as { current: unknown }[],
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) => (initial === false && open.asking ? [true, vi.fn()] : react.useState(initial)),
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

vi.mock("../../app/use-window", () => ({ useWindow: () => undefined }));
vi.mock("./signin-store", () => ({ useSignIn: () => ({ machines: {} }) }));
vi.mock("./AccountSignInSheet", () => ({ AccountSignInSheet: () => null }));
vi.mock("./SignOutSheet", () => ({ SignOutSheet: (props: { onConfirm: (also: boolean) => void }) => (sheets.push(props), null) }));
vi.mock("./accounts", async (importOriginal) => ({ ...(await importOriginal<object>()), signOutAccount: async () => ({ status: "ok" }) }));

const { AccountRow, KeyFieldRow, KeyRow } = await import("./CredentialRow");

afterEach(() => {
  effects.length = 0;
  refs.length = 0;
  buttons.length = 0;
  sheets.length = 0;
  open.asking = false;
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

  it("moves focus to the Sign In button when a confirmed Sign Out replaced the Sign Out… button", async () => {
    const focus = vi.fn();
    vi.stubGlobal("document", { body: {}, activeElement: null, getElementById: (id: string) => (id === "account-signin-claude" ? { focus, hasAttribute: () => false } : null) });
    const view = (type: string) => ({ provider: "claude", status: type === "signed_in" ? { type, identity: { email: "a@b.c", plan: "Max" } } : { type }, agents: [], cli: { installed: true } }) as never;
    renderToString(<AccountRow bridge={{} as never} view={view("signed_in")} keyConfigured />);
    const confirm = refs.length; // the row's refs are created in render order; the sign-out flag is the last one
    buttons.length = 0;
    renderToString(<AccountRow bridge={{} as never} view={view("signed_in")} keyConfigured />);
    expect(confirm).toBeGreaterThan(0);
    expect(buttons.some((b) => b.id === "account-signin-claude")).toBe(false);
    // sheet confirm sets the flag, the row re-renders signed out, the effect gives focus to Sign In
    effects.length = 0;
    refs.length = 0;
    open.asking = true; // the Sign Out sheet is up: confirming it sets the flag the signed-out render acts on
    renderToString(<AccountRow bridge={{} as never} view={view("signed_in")} keyConfigured />);
    const flag = refs.at(-1)!;
    sheets[0]!.onConfirm(false);
    expect(flag.current).toBe(true);
    open.asking = false;
    effects.length = 0;
    buttons.length = 0;
    renderToString(<AccountRow bridge={{} as never} view={view("not_signed_in")} keyConfigured />);
    expect(buttons.some((b) => b.id === "account-signin-claude")).toBe(true);
    refs.at(-1)!.current = true;
    effects.at(-1)!();
    expect(focus).toHaveBeenCalledOnce();
  });
});
