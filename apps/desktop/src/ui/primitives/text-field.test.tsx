import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TextField } from "./text-field";

describe("text-field", () => {
  it("is a single-line text field named by its label", () => {
    const html = renderToString(<TextField id="name" value="Anna" ariaLabel="Name" placeholder="Name…" />);
    expect(html).toBe(
      '<span class="np-field np-field--single" data-component="cpt-noter-component-ui-primitives" data-primitive="text-field" data-variant="single"><input type="text" id="name" class="np-field__input" placeholder="Name…" aria-label="Name" value="Anna"/></span>',
    );
  });

  it("renders the secure, number, date and multi-line variants", () => {
    expect(renderToString(<TextField variant="secure" value="sk" />)).toContain('type="password"');
    expect(renderToString(<TextField variant="number" value="3" min={1} max={9} step={1} />)).toContain('type="number"');
    expect(renderToString(<TextField variant="date" />)).toContain('type="date"');
    const multi = renderToString(<TextField multiline value="line" label="Notes" showLabel mono rows={5} lang="ru" />);
    expect(multi).toContain('class="np-field np-field--multi"');
    expect(multi).toContain('<span class="np-field__label">Notes</span><textarea rows="5"');
    expect(multi).toContain('class="np-field__input np-mono"');
    expect(multi).toContain('spellCheck="false"');
    expect(multi).toContain(">line</textarea>");
  });

  it("exposes an invalid field's message as its description", () => {
    const html = renderToString(<TextField value="x" invalid message="Enter an email address" ariaLabel="Email" />);
    expect(html).toContain('class="np-field np-field--single is-invalid"');
    expect(html).toContain('data-state="invalid"');
    expect(html).toContain('aria-invalid="true"');
    const id = /aria-describedby="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`<span class="np-field__msg" id="${id}"><svg`);
    expect(html).toContain("Enter an email address</span>");
  });

  it("marks disabled and read-only fields", () => {
    expect(renderToString(<TextField disabled />)).toContain('data-state="disabled"');
    const ro = renderToString(<TextField readonly value="~/p" onChange={() => {}} />);
    expect(ro).toContain('data-state="read-only"');
    expect(ro).toContain('readOnly=""');
  });
});

describe("text-field Return (cpt-noter-flow-ui-primitives-operate-control)", () => {
  it("runs onEnter on Return, but not while an input method is composing", async () => {
    const { vi } = await import("vitest");
    const onEnter = vi.fn();
    const { find, rendered } = await import("../testing");
    const input = find(rendered(TextField, { value: "a", ariaLabel: "Title", onEnter }), (p) => typeof p.onKeyDown === "function");
    (input.props.onKeyDown as (e: unknown) => void)({ key: "Enter", nativeEvent: { isComposing: true } });
    expect(onEnter).not.toHaveBeenCalled();
    (input.props.onKeyDown as (e: unknown) => void)({ key: "Enter", nativeEvent: { isComposing: false } });
    expect(onEnter).toHaveBeenCalledOnce();
  });
});
