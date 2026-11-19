import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { Bridge } from "../../app/bridge/bridge";

const effects = vi.hoisted(() => [] as (() => (() => void) | void)[]);
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => (() => void) | void) => void effects.push(effect),
}));

import { UndoStrip } from "./UndoStrip";
import { dismissUndo, holdUndo, resetUndo } from "./undo";

beforeEach(() => { vi.useFakeTimers(); resetUndo(); });
afterEach(() => { resetUndo(); effects.length = 0; vi.useRealTimers(); vi.unstubAllGlobals(); });

function mounted(modal = false) {
  let key!: (event: KeyboardEvent) => void;
  const removeEventListener = vi.fn();
  vi.stubGlobal("window", { addEventListener: (_name: string, listener: typeof key) => { key = listener; }, removeEventListener });
  vi.stubGlobal("document", { querySelector: () => modal ? {} : null });
  const changeUndo = vi.fn(async () => ({ status: "ok", data: { undone: 1, skipped_edited_later: 0 } }));
  const bridge = { core: { changeUndo }, act: async (_key: string, _cmd: string, run: () => unknown) => run() } as unknown as Bridge;
  holdUndo({ target: { type: "change", change_id: "change_previous_page" }, message: "Tagged call", mode: "undo" });
  renderToString(<UndoStrip bridge={bridge} />);
  const cleanup = effects[0]!();
  return { key, changeUndo, cleanup, removeEventListener };
}
const event = (over: object = {}) => ({ code: "KeyZ", metaKey: true, shiftKey: false, altKey: false, ctrlKey: false, defaultPrevented: false, repeat: false, target: { tagName: "BUTTON" }, preventDefault: vi.fn(), ...over }) as unknown as KeyboardEvent;

describe("UndoStrip command scope (cpt-noter-flow-ui-history-undo-reverse)", () => {
  it("never undoes a background change from a sheet button, including after the strip disappears", () => {
    const { key, changeUndo } = mounted(true);
    dismissUndo();
    key(event());
    expect(changeUndo).not.toHaveBeenCalled();
  });
  it("leaves an event already consumed by a deeper handler alone", () => {
    const { key, changeUndo } = mounted();
    key(event({ defaultPrevented: true }));
    expect(changeUndo).not.toHaveBeenCalled();
  });
  it("keeps native text undo in a field and runs page undo from a button", () => {
    const { key, changeUndo, cleanup, removeEventListener } = mounted();
    const typing = event({ target: { tagName: "TEXTAREA" } });
    key(typing);
    expect(typing.preventDefault).not.toHaveBeenCalled();
    expect(changeUndo).not.toHaveBeenCalled();
    const page = event();
    key(page);
    expect(page.preventDefault).toHaveBeenCalledOnce();
    expect(changeUndo).toHaveBeenCalledWith({ target: { type: "change", change_id: "change_previous_page" } });
    cleanup!();
    expect(removeEventListener).toHaveBeenCalledWith("keydown", key);
  });
});
