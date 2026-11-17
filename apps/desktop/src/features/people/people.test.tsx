import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PersonRow } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { view } from "./identity";
import { PeopleBody, type PeopleBodyProps } from "./PeoplePage";
import { PeopleToolbar } from "./PeopleToolbar";
import { holdPeople } from "./count";
import { setPeopleQuery } from "./model";

const person = (o: Partial<PersonRow>): PersonRow => ({
  id: "per_a", rev: 1, display_name: "Anna Kuznetsova", short_name: "Anna K.", initials: "AK", email: null, role: "PM", org: "Acme",
  aliases: [], is_you: false, voice_profile: true, last_call_at: 1_700_000_000_000, open_items: 2, you_owe: 0, notes: null, ...o,
});
const listed = (people: PersonRow[], unnamed = [] as never[], query = "") => view({ people, unnamed }, query);
const props = (o: Partial<PeopleBodyProps>): PeopleBodyProps => ({
  status: "READ", shown: listed([person({})]), query: "", prefs: undefined, selection: { ids: [], anchor: null }, slow: false,
  onOpen: vi.fn(), onSelect: vi.fn(), onRetry: vi.fn(), ...o,
});

describe("cpt-noter-flow-ui-people-prepare", () => {
  it("LISTED: a row with name, role · org, open items, last call and the voice profile", () => {
    const h = renderToString(<PeopleBody {...props({})} />);
    expect(h).toContain("Anna Kuznetsova");
    expect(h).toContain("PM · Acme");
    expect(h).toContain("Voice profile on");
    expect(h).toContain('data-state="listed"');
  });
  it("EMPTY and NO_MATCH are different messages; NO_MATCH names the query and offers Clear Search", () => {
    expect(renderToString(<PeopleBody {...props({ shown: listed([]) })} />)).toContain("No people yet");
    const h = renderToString(<PeopleBody {...props({ shown: listed([person({})], [], "lena"), query: " lena " })} />);
    expect(h).toContain("No people match “lena”".replace(/[“”]/g, (c) => c));
    expect(h).toContain("Clear Search");
  });
  it("a failed reload keeps the list on screen and offers Try Again", () => {
    const h = renderToString(<PeopleBody {...props({ status: "ERROR" })} />);
    expect(h).toContain("Anna Kuznetsova");
    expect(h).toContain("Couldn’t read your people");
    expect(h).toContain("Try Again");
  });
  it("has no You owe column until the core counts it", () => {
    expect(renderToString(<PeopleBody {...props({})} />)).not.toContain("You owe");
  });
  it("LOADING shows skeleton rows only after the delay; ERROR offers Try Again", () => {
    expect(renderToString(<PeopleBody {...props({ shown: null, status: "LOADING" })} />)).not.toContain("pe-skel");
    expect(renderToString(<PeopleBody {...props({ shown: null, status: "LOADING", slow: true })} />)).toContain("pe-skel");
    const onRetry = vi.fn();
    const tree = rendered(PeopleBody, props({ shown: null, status: "ERROR", onRetry }));
    expect(renderToString(<PeopleBody {...props({ shown: null, status: "ERROR" })} />)).toContain("Try Again");
    expect(tree).toBeTruthy();
  });
  it("Return and a double-click open the person, Space and a click select, ⌘-click adds", () => {
    const p = props({});
    const tree = rendered(PeopleBody, p);
    const row = find(tree, (x) => x["data-pe-row"] === "per_a");
    const ev = (o = {}) => ({ preventDefault() {}, stopPropagation() {}, metaKey: false, ctrlKey: false, shiftKey: false, ...o });
    (row.props.onKeyDown as (e: unknown) => void)(ev({ key: "Enter" }));
    expect(p.onOpen).toHaveBeenCalledWith("per_a");
    (row.props.onKeyDown as (e: unknown) => void)(ev({ key: " " }));
    expect(p.onSelect).toHaveBeenCalledWith("per_a", {});
    (row.props.onClick as (e: unknown) => void)(ev({ metaKey: true }));
    expect(p.onSelect).toHaveBeenCalledWith("per_a", { meta: true, shift: false });
    (row.props.onDoubleClick as () => void)();
    expect(p.onOpen).toHaveBeenCalledTimes(2);
  });
  it("lists unnamed speakers keyed by call and speaker, with no Name action yet", () => {
    const u = { call: { id: "call_1", title: "Sync", started_at: 0, call_type: "x" }, speaker_id: "spk_2", n: 2, segment_count: 1, sample: null, suggestion: null } as never;
    const h = renderToString(<PeopleBody {...props({ shown: listed([person({})], [u]) })} />);
    expect(h).toContain("Speaker 2");
    expect(h).toContain("in Sync");
  });
});

describe("PeopleToolbar", () => {
  const base = { title: "", actions: [], hasSearch: true, narrow: false, canBack: false, canForward: false, showToggle: false, search: "", searchOpen: false, onBack() {}, onForward() {}, onToggleSidebar() {}, onSearch() {}, onRunSearch() {}, onOpenSearch() {} };
  const draw = () => renderToString(<PeopleToolbar route={{ section: "people", key: "root" }} bridge={{} as never} base={base} inspectorOpen={false} onToggleInspector={() => {}} />);
  it("shows the count and its own search field, not the global one", () => {
    holdPeople([person({}), person({ id: "b" }), person({ id: "c" })]);
    setPeopleQuery("ann");
    const h = draw();
    expect(h).toContain("3 people");
    expect(h).toContain('value="ann"');
    expect(h).not.toContain("mw-search");
    holdPeople([]);
    expect(draw()).toContain("No people yet");
    holdPeople(null);
    setPeopleQuery("");
  });
});

describe("PeoplePage", () => {
  it("starts in LOADING under the bridge: the heading is there, no rows yet", async () => {
    const { BridgeProvider } = await import("../../app/bridge/context");
    const { PeoplePage } = await import("./PeoplePage");
    const bridge = { label: "main", store: { getState: () => ({ entities: { person: {} }, app: null, commands: {} }), subscribe: () => () => {} }, act: () => new Promise(() => {}), core: {} } as never;
    const h = renderToString(<BridgeProvider value={bridge}><PeoplePage /></BridgeProvider>);
    expect(h).toContain('data-state="loading"');
    expect(h).not.toContain("pe-row");
  });
});
