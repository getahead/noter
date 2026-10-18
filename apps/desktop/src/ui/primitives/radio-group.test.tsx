import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { RadioGroup } from "./radio-group";

const options = [{ value: "owed", label: "Owed to today's people, then due date" }, { value: "due", label: "Due date, then owed to you", note: "Ignores who is in today's calls", disabled: true }];

describe("radio-group", () => {
  it("is a radio group of native radios sharing a name, with notes and disabled options", () => {
    const html = renderToString(<RadioGroup name="rank" options={options} value="owed" label="Ranking" />);
    expect(html).toMatch(/^<div class="np-radios" role="radiogroup" data-component="cpt-noter-component-ui-primitives" data-primitive="radio-group" data-variant="vertical" aria-label="Ranking">/);
    expect(html).toContain('<input type="radio" name="rank" checked="" value="owed"/><span class="np-radio__dot" aria-hidden="true"></span><span><span class="np-radio__label">Owed to today&#x27;s people, then due date</span></span>');
    expect(html).toContain('<input type="radio" disabled="" name="rank" value="due"/>');
    expect(html).toContain('<span class="np-radio__note">Ignores who is in today&#x27;s calls</span>');
  });

  it("reports the chosen value to the owner", () => {
    const onAction = vi.fn();
    RadioGroup({ name: "rank", options, value: "owed", onAction }).props.children[1].props.children[0].props.onChange();
    expect(onAction).toHaveBeenCalledWith("due");
  });
});
