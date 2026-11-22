import { describe, expect, it } from "vitest";
import { find, rendered } from "../../ui/testing";
import { CallsToolbar } from "./CallsToolbar";
import { exportStore } from "./export-store";

const props = (key: string) => ({ route: { section: "library", key }, base: { trailing: null } }) as never;

describe("CallsToolbar (LC-R1)", () => {
  it("adds Export… to the Calls toolbar, disabled with its help tag", () => {
    const btn = find(rendered(CallsToolbar, props("root")).props.trailing as never, (p) => p.label === "Export…");
    expect(btn.props.disabled).toBe(true);
    expect(btn.props.help).toBe("Select calls to export");
    expect(btn.props.shortcut).toBe("Meta+E");
  });
  // #1053: only calls still recording selected: nothing to export yet, and the help tag says why
  it("keeps Export… disabled for a selection of calls still recording, with the reason", () => {
    exportStore.setIds(["call_live"], true);
    const btn = find(rendered(CallsToolbar, props("root")).props.trailing as never, (p) => p.label === "Export…");
    expect(btn.props.disabled).toBe(true);
    expect(btn.props.help).toBe("Nothing to export yet: the selected calls are still recording");
    exportStore.setIds(["call_live", "call_backend"], false);
    const on = find(rendered(CallsToolbar, props("root")).props.trailing as never, (p) => p.label === "Export…");
    expect([on.props.disabled, on.props.help]).toEqual([false, undefined]);
    exportStore.setIds([]);
  });
  it("leaves other Library routes with the shell's toolbar", () => {
    expect(rendered(CallsToolbar, props("search:x")).props.trailing).toBeNull();
  });
});
