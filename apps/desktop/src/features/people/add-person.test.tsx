import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { find, rendered } from "../../ui/testing";
import { undoMode } from "../history/undo";
import { AddPersonPopover, createPerson, setAddPerson } from "./add-person";
import { holdPeople } from "./count";

const ref = { type: "new" as const, display_name: "Lena K.", email: null };
const bridgeOf = (res: unknown) => ({ act: vi.fn(async (_k: string, _c: string, run: () => unknown) => (run(), res)), core: { personCreate: vi.fn(), windowNavigate: vi.fn() } }) as never;

describe("cpt-noter-flow-ui-people-name", () => {
  it("person_create sends the name and email and offers the core's change in the Undo strip", async () => {
    const b = bridgeOf({ status: "ok", data: { person: { display_name: "Lena K." }, change_id: "chg_1" } }) as { act: never; core: { personCreate: ReturnType<typeof vi.fn> } };
    expect(await createPerson(b as never, ref)).toBe(true);
    expect(b.core.personCreate).toHaveBeenCalledWith({ display_name: "Lena K.", email: null });
    expect(undoMode()).toBe("undo");
  });
  it("a refusal returns false so the form stays with its error", async () => {
    expect(await createPerson(bridgeOf({ status: "error", error: { code: "invalid_input" } }), ref)).toBe(false);
  });
  it("the New person popover shows only while open, with Name, Email and Role", () => {
    const bridge = bridgeOf({});
    holdPeople([]);
    setAddPerson(false);
    expect(renderToString(<AddPersonPopover bridge={bridge} anchor={null} />)).toBe("");
    setAddPerson(true);
    const h = renderToString(<AddPersonPopover bridge={bridge} anchor={null} />);
    for (const s of ["New person", "Name", "Email", "Role", "Create"]) expect(h).toContain(s);
    // DESIGN: Cancel closes it, and Create waits for a name
    expect(h).toContain("Cancel");
    expect(h).not.toContain(">Back<");
    expect(h).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Create/s);
    expect(h).toContain("pe-add");
    setAddPerson(false);
    holdPeople(null);
  });
  it("Back closes the popover; a confirmed new person creates, a confirmed existing one opens it", async () => {
    setAddPerson(true);
    const bridge = bridgeOf({ status: "ok", data: { person: { display_name: "Lena K." }, change_id: "chg_2" } }) as { act: ReturnType<typeof vi.fn> };
    const tree = rendered(AddPersonPopover, { bridge: bridge as never, anchor: null });
    const form = find(tree, (p) => typeof p.onConfirm === "function");
    await (form.props.onConfirm as (r: unknown, n: string, isNew: boolean) => Promise<void>)(ref, "Lena K.", true);
    expect(bridge.act).toHaveBeenCalledWith("people:create", "person_create", expect.any(Function), expect.anything());
    await (form.props.onConfirm as (r: unknown, n: string, isNew: boolean) => Promise<void>)({ type: "existing", person_id: "per_a" }, "A", false);
    expect(bridge.act).toHaveBeenCalledWith("window_navigate", "window_navigate", expect.any(Function), expect.anything());
    (form.props.onBack as () => void)();
    setAddPerson(false);
  });
});
