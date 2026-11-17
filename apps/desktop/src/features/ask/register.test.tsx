import { describe, expect, it } from "vitest";

import { pageFor } from "../shell/pages";
import "./register";

describe("Ask registration (cpt-noter-component-screen-ask)", () => {
  it("gives the shell the Ask page: its title and its screen", () => {
    const page = pageFor("ask");
    const route = { section: "ask", key: "root" } as never;
    expect(page.title(route)).toBe("Ask");
    expect(page.render(route, {} as never)).toBeTruthy();
  });
});
