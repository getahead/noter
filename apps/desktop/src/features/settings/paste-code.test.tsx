// #1136: the sign-in sheet's paste field sends the code to the waiting login and says how it went.
import { describe, expect, it, vi } from "vitest";

const { setters, held } = vi.hoisted(() => ({ setters: [] as ReturnType<typeof vi.fn>[], held: { code: "abc#123" } }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    // the component runs outside a render: the code state holds `held.code`, the other its initial value
    useState: (initial: unknown) => {
      const set = vi.fn();
      setters.push(set);
      return [initial === "" ? held.code : initial, set];
    },
  };
});

const { PasteCode } = await import("./AccountSignInSheet");
const { find } = await import("../../ui/testing");

function bridgeAnswering(status: "ok" | "error") {
  const accountSigninCode = vi.fn(async () => ({ status }));
  const bridge = { act: async (_k: string, _c: string, run: () => Promise<unknown>) => run(), core: { accountSigninCode } };
  return { bridge, accountSigninCode };
}

describe("PasteCode (cpt-noter-seq-settings-sign-in-account)", () => {
  it("#1136: Send Code passes the trimmed code to the session and says it was sent", async () => {
    setters.length = 0;
    const { bridge, accountSigninCode } = bridgeAnswering("ok");
    const tree = PasteCode({ bridge: bridge as never, sessionId: "ses_1" });
    const [, setState] = setters;
    await (find(tree, (p) => p.label === "Send Code").props.onAction as () => Promise<void>)();
    await vi.waitFor(() => expect(setState).toHaveBeenLastCalledWith("sent"));
    expect(setState).toHaveBeenCalledWith("sending");
    expect(accountSigninCode).toHaveBeenCalledWith({ session_id: "ses_1", code: "abc#123" });
  });

  it("#1136: a refused code marks the field failed; typing clears it; Return sends too", async () => {
    setters.length = 0;
    const { bridge } = bridgeAnswering("error");
    const tree = PasteCode({ bridge: bridge as never, sessionId: "ses_1" });
    const [setCode, setState] = setters;
    const field = find(tree, (p) => p.ariaLabel === "Code from the page");
    (field.props.onEnter as () => void)();
    await vi.waitFor(() => expect(setState).toHaveBeenLastCalledWith("failed"));
    (field.props.onChange as (v: string) => void)("new");
    expect(setCode).toHaveBeenLastCalledWith("new");
    expect(setState).toHaveBeenLastCalledWith("idle");
  });

  it("#1136: an empty code sends nothing", async () => {
    setters.length = 0;
    held.code = "   ";
    const { bridge, accountSigninCode } = bridgeAnswering("ok");
    const tree = PasteCode({ bridge: bridge as never, sessionId: "ses_1" });
    (find(tree, (p) => p.ariaLabel === "Code from the page").props.onEnter as () => void)();
    expect(accountSigninCode).not.toHaveBeenCalled();
    held.code = "abc#123";
  });
});
