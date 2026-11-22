import { describe, expect, it } from "vitest";

import { foldOrder, nextFold, TITLE_MIN_EM } from "./header-fold";

describe("FP-R1 overflow (#1186)", () => {
  it("folds Move to Display 2 first, then Collapse, then the shield; Move only with two displays", () => {
    expect(foldOrder(true)).toEqual(["move", "collapse", "shield"]);
    expect(foldOrder(false)).toEqual(["collapse", "shield"]);
  });
  it("folds one more control while the title is under 8 em, up to all of them", () => {
    expect(nextFold(0, 3, TITLE_MIN_EM * 13 - 1, 13)).toBe(1);
    expect(nextFold(3, 3, 10, 13)).toBe(3);
  });
  it("unfolds one only with room for it, and holds in between so the header never flaps", () => {
    expect(nextFold(2, 3, (TITLE_MIN_EM + 3) * 13, 13)).toBe(1);
    expect(nextFold(2, 3, (TITLE_MIN_EM + 1) * 13, 13)).toBe(2);
    expect(nextFold(0, 3, 400, 13)).toBe(0);
  });
});
