import { describe, expect, it } from "vitest";
import { find, rendered } from "../../ui/testing";
import { CallsToolbar } from "./CallsToolbar";

const props = (key: string) => ({ route: { section: "library", key }, base: { trailing: null } }) as never;

describe("CallsToolbar (LC-R1)", () => {
  it("adds Export… to the Calls toolbar, disabled with its help tag", () => {
    const btn = find(rendered(CallsToolbar, props("root")).props.trailing as never, (p) => p.label === "Export…");
    expect(btn.props.disabled).toBe(true);
    expect(btn.props.help).toBe("Select calls to export");
    expect(btn.props.shortcut).toBe("Meta+E");
  });
  it("leaves other Library routes with the shell's toolbar", () => {
    expect(rendered(CallsToolbar, props("search:x")).props.trailing).toBeNull();
  });
});
