// The archive note on an evidence span: what it says, and the toggle only when there are words to compare.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { find, rendered } from "../../ui/testing";
import { ArchiveNotice } from "./ArchiveNotice";

describe("ArchiveNotice (inst-archive)", () => {
  it("says the archive pass changed the words and offers Show Archive Changes when it has a before and after", () => {
    const html = renderToString(<ArchiveNotice note={{ change: { before: "ship it friday", after: "ship it on Friday" } }} />);
    expect(html).toContain("Words changed by the archive pass");
    expect(html).toContain("Show Archive Changes");
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("ship it friday"); // the diff stays hidden until asked
  });

  it("offers no toggle when the archive pass replaced the lines and there is nothing to compare", () => {
    const html = renderToString(<ArchiveNotice note={{ change: null }} />);
    expect(html).toContain("Words changed by the archive pass");
    expect(html).not.toContain("Archive Changes");
  });

  it("the toggle is a button the user can press", () => {
    const tree = rendered(ArchiveNotice, { note: { change: { before: "a", after: "b" } } });
    const toggle = find(tree, (p, type) => type === "button" && p.className === "np-link");
    expect(toggle.props.onClick).toBeTypeOf("function");
    expect(() => (toggle.props.onClick as () => void)()).not.toThrow();
  });
});
