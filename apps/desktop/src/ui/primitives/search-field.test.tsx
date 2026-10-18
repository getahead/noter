import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { searchKey, SearchField } from "./search-field";

describe("search-field", () => {
  it("is a search field with the glyph, empty or typing", () => {
    const html = renderToString(<SearchField placeholder="Search" id="mw-search" />);
    expect(html).toMatch(/^<label class="np-search np-search--plain" data-component="cpt-noter-component-ui-primitives" data-primitive="search-field" data-variant="plain" data-state="empty"><svg class="np-ic np-search__icon"/);
    expect(html).toContain('<input type="search" id="mw-search" placeholder="Search" aria-label="Search" autoComplete="off" value=""/>');
    expect(renderToString(<SearchField value="retro" />)).toContain('data-state="typing"');
    expect(renderToString(<SearchField state="searching" />)).toContain('data-state="searching"');
  });

  it("shows removable capsule tokens; the token field has no glyph", () => {
    const html = renderToString(<SearchField tokens={[{ label: "Anna" }, { label: "Tag: release", kind: "tag" }]} />);
    expect(html).toContain('data-variant="tokens" data-state="tokens"');
    expect(html).toContain('<span class="np-token" data-token-kind="filter">Anna<button type="button" class="np-token__x" aria-label="Remove Anna"><svg');
    expect(html).toContain('data-token-kind="tag"');
    expect(renderToString(<SearchField variant="token-field" placeholder="Add tag…" />)).not.toContain("np-search__icon");
  });

  it("maps keys: Return runs, ⌫ at the start removes the last token, Esc clears then leaves", () => {
    const f = { value: "re", caret: 2, tokens: 1, tokenField: false };
    expect(searchKey("Enter", f)).toBe("run");
    expect(searchKey("Backspace", f)).toBeNull();
    expect(searchKey("Backspace", { ...f, value: "", caret: 0 })).toBe("remove-last-token");
    expect(searchKey("Backspace", { ...f, caret: 0, tokens: 0 })).toBeNull();
    expect(searchKey("Escape", f)).toBe("clear");
    expect(searchKey("Escape", { ...f, value: "" })).toBe("leave");
    expect(searchKey(",", f)).toBeNull();
    expect(searchKey("a", f)).toBeNull();
  });

  it("adds a tag on Return or a comma in a token field", () => {
    const f = { value: "release ", caret: 8, tokens: 0, tokenField: true };
    expect(searchKey("Enter", f)).toBe("add-token");
    expect(searchKey(",", f)).toBe("add-token");
    expect(searchKey("Enter", { ...f, value: " " })).toBeNull();
  });

  it("hands each key action to the owner", () => {
    const h = { onChange: vi.fn(), onEnter: vi.fn(), onAddToken: vi.fn(), onRemoveToken: vi.fn() };
    const key = (variant: "plain" | "token-field", k: string, value: string, caret = value.length) => {
      const input = { value, selectionStart: caret, blur: vi.fn() };
      const preventDefault = vi.fn();
      const el = SearchField({ variant, tokens: [{ label: "Anna" }], value, ...h });
      el.props.children[2].props.onKeyDown({ key: k, currentTarget: input, preventDefault });
      return { input, preventDefault };
    };
    key("plain", "Enter", "retro");
    expect(h.onEnter).toHaveBeenCalledWith("retro");
    key("token-field", ",", " release ");
    expect(h.onAddToken).toHaveBeenCalledWith("release");
    expect(key("plain", "Backspace", "", 0).preventDefault).not.toHaveBeenCalled();
    expect(h.onRemoveToken).toHaveBeenCalledWith(0);
    key("plain", "Escape", "x");
    expect(h.onChange).toHaveBeenCalledWith("");
    expect(key("plain", "Escape", "").input.blur).toHaveBeenCalled();
    expect(key("plain", "q", "").preventDefault).not.toHaveBeenCalled();
    const el = SearchField({ tokens: [{ label: "Anna" }], ...h });
    el.props.children[1][0].props.children[1].props.onClick();
    expect(h.onRemoveToken).toHaveBeenCalledTimes(2);
    el.props.children[2].props.onChange({ target: { value: "an" } });
    expect(h.onChange).toHaveBeenCalledWith("an");
  });
});
