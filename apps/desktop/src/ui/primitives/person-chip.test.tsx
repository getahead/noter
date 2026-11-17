import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { find, rendered } from "../testing";
import { PersonChip } from "./person-chip";

describe("PersonChip (cpt-noter-component-ui-person-chip)", () => {
  it("draws initials and the short name; a secondary chip is dimmed; the full name is in the help tag", () => {
    const h = renderToString(<PersonChip variant="call-window" initials="AK" name="Anna K." title="Anna Kuznetsova" />);
    expect(h).toContain('data-component="cpt-noter-component-ui-person-chip"');
    expect(h).toContain('data-variant="call-window"');
    expect(h).toContain("np-person np-person--cw");
    expect(h).toContain('title="Anna Kuznetsova"');
    expect(h).toContain("AK");
    expect(renderToString(<PersonChip variant="unnamed" initials="?" name="Speaker 3" secondary />)).toContain("is-secondary");
  });
  it("is a plain span without an action and a labelled button with one that passes its element on", () => {
    expect(renderToString(<PersonChip variant="you" initials="Y" name="You" />)).toContain("<span ");
    const onAction = vi.fn();
    const html = renderToString(<PersonChip variant="link" initials="AK" name="Anna K." label="Open Anna K." onAction={onAction} />);
    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Open Anna K."');
    const el = {} as HTMLElement;
    (find(rendered(PersonChip, { variant: "link", initials: "AK", name: "Anna K.", onAction }), (p) => typeof p.onClick === "function").props.onClick as (e: { currentTarget: HTMLElement }) => void)({ currentTarget: el });
    expect(onAction).toHaveBeenCalledWith(el);
  });
});
