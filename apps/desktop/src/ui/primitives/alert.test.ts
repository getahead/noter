import { describe, expect, it } from "vitest";
import { alertButtons } from "./alert";

describe("alertButtons (cpt-noter-dod-ui-primitives-controls)", () => {
  it("puts the default button trailing, as the macOS 26 layout and the prototype do", () => {
    const buttons = [{ label: "Delete", variant: "primary" }, { label: "Cancel" }, { label: "Keep Audio" }];
    expect(alertButtons(buttons).map((b) => b.label)).toEqual(["Cancel", "Keep Audio", "Delete"]);
  });
  it("offers OK when the owner gives no buttons", () => {
    expect(alertButtons([])).toEqual([{ label: "OK", variant: "primary" }]);
  });
});
