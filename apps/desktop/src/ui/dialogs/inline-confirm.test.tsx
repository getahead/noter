import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { find, rendered } from "../testing";
import { InlineConfirm } from "./inline-confirm";

describe("InlineConfirm (cpt-noter-flow-ui-dialogs-host-inline-confirm)", () => {
  it("asks in place with Discard and Back, never a dialog or a default button", () => {
    const html = renderToString(
      <InlineConfirm onConfirm={() => {}} onBack={() => {}} />,
    );
    expect(html).toContain(
      "Discard this recording? This can&#x27;t be undone.",
    );
    expect(html).toContain("Discard");
    expect(html).toContain("Back");
    expect(html).not.toContain("dialog");
    expect(html).not.toContain('type="submit"');
  });

  it("runs the owner's handlers from its two buttons", () => {
    const onConfirm = vi.fn();
    const onBack = vi.fn();
    const tree = rendered(InlineConfirm, { onConfirm, onBack });
    (find(tree, (p) => p.label === "Discard").props.onAction as () => void)();
    (find(tree, (p) => p.label === "Back").props.onAction as () => void)();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
