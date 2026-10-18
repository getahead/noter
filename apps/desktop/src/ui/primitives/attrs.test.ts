import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { base, cx, PRIM } from "./attrs";

describe("primitive attributes", () => {
  it("names the primitives component and the primitive, as the prototype's base() does", () => {
    expect(PRIM).toBe("cpt-noter-component-ui-primitives");
    expect(base("push-button", { variant: "primary", size: "small", state: "loading", region: "TD-R3", id: "rec", help: "Start" })).toEqual({
      "data-component": PRIM,
      "data-primitive": "push-button",
      "data-variant": "primary",
      "data-size": "small",
      "data-state": "loading",
      "data-region": "TD-R3",
      id: "rec",
      title: "Start",
    });
  });

  it("leaves out what is not set, like the prototype's attrs()", () => {
    expect(base("key-cap", {})).toEqual({ "data-component": PRIM, "data-primitive": "key-cap" });
  });

  it("joins class names, skipping empty parts", () => {
    expect(cx("np-btn", undefined, false, "", "np-btn--small")).toBe("np-btn np-btn--small");
  });
});

describe("component stylesheets", () => {
  const dir = fileURLToPath(new URL("../../styles/components/", import.meta.url));
  const sheets = readdirSync(dir).filter((f) => f.endsWith(".css"));
  const all = sheets.map((f) => readFileSync(dir + f, "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

  it("drop the prototype harness and its token blocks", () => {
    expect(sheets).toEqual(expect.arrayContaining(["00-base.css", "01-macos27.css"]));
    for (const proto of [".np-cap", ".np-desk", ".np-hbar", ".np-hpanel", ".np-inspect-tip", "data-proto-", ":root {", "prefers-reduced-motion"]) expect(all).not.toContain(proto);
  });

  it("give every control drawn smaller than 24 pt a 24 by 24 pt hit area", () => {
    for (const small of [".np-btn--small::after", ".np-ibtn--inline::after", ".np-disc::after"]) expect(all).toContain(small);
    expect(all).toMatch(/width: max\(100%, 24px\); height: max\(100%, 24px\)/);
  });
});
