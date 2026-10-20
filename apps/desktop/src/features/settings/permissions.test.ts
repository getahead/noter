import { describe, expect, it } from "vitest";

import { rowState } from "./permissions";

describe("rowState", () => {
  it("reads the core's state for the kind", () => {
    expect(rowState("calendar", [{ kind: "calendar", state: "granted" }])).toBe("GRANTED");
    expect(rowState("calendar", [{ kind: "calendar", state: "denied" }])).toBe("DENIED");
  });

  it("reads a permission the core does not list as never asked", () => {
    expect(rowState("calendar", [])).toBe("NOT_ASKED");
    expect(rowState("calendar", undefined)).toBe("NOT_ASKED");
  });
});
