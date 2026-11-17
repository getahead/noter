import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { isNewKey, setAskState } from "./ask-state";
import { AskToolbar } from "./AskToolbar";

const base = { actions: [], hasSearch: false, narrow: false, canBack: false, canForward: false, showToggle: false, search: "", searchOpen: false, title: "", onBack() {}, onForward() {}, onToggleSidebar() {}, onSearch() {}, onRunSearch() {}, onOpenSearch() {} };
const html = () => renderToString(<AskToolbar route={{ section: "ask", key: "root" }} bridge={{ store: { getState: () => ({ streams: {}, whole: {} }), subscribe: () => () => {} } } as never} base={base} inspectorOpen={false} onToggleInspector={() => {}} />);

describe("AskToolbar (cpt-noter-component-screen-ask)", () => {
  it("shows the scope pop-up once the core's presets are known, with the chosen one selected", () => {
    expect(html()).not.toContain('data-primitive="popup-button"');
    setAskState({ presets: [{ id: "all", label: "All calls and all sources" }, { id: "calls_only", label: "Calls only" }] as never, scopeId: "calls_only" });
    const h = html();
    expect(h).toContain('data-region="AK-R1"');
    expect(h).toContain('data-primitive="popup-button"');
    expect(h).toContain("Calls only");
  });
  it("shows the privacy mode indicator in the Ask form", () => {
    const h = html();
    expect(h).toContain('data-component="cpt-noter-component-ui-mode-indicator"');
    expect(h).toContain('data-variant="ask"');
  });
  it("offers New Question as the primary action, bound to ⌘N", () => {
    expect(html()).toContain("New Question");
    expect(isNewKey({ key: "n", metaKey: true, shiftKey: false })).toBe(true);
    expect(isNewKey({ key: "N", metaKey: true, shiftKey: true })).toBe(false);
    expect(isNewKey({ key: "n", metaKey: false, shiftKey: false })).toBe(false);
  });
});
