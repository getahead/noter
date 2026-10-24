import { describe, expect, it } from "vitest";

import { pageFor, registerPage, type PageDef } from "./pages";

const def = (title: string): PageDef => ({ title: () => title, render: () => null });
const root = { section: "people", key: "root" } as const;

describe("page registry", () => {
  it("shows a placeholder naming the section until a feature registers", () => {
    expect(pageFor("topics").title(root)).toBe("Topics");
  });

  it("a page registered `when` a route matches shows only for those routes, the plain one for the rest", () => {
    const person = (r: { key: string }) => r.key.startsWith("person:");
    registerPage("people", def("People"));
    registerPage("people", def("One person"), person);
    expect(pageFor("people", root).title(root)).toBe("People");
    expect(pageFor("people", { section: "people", key: "person:p1" }).title(root)).toBe("One person");
  });

  it("the last registration for the same condition wins", () => {
    const when = (r: { key: string }) => r.key === "x";
    registerPage("agents", def("first"), when);
    registerPage("agents", def("second"), when);
    expect(pageFor("agents", { section: "agents", key: "x" }).title(root)).toBe("second");
  });
});
