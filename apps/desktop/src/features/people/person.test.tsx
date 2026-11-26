import { createWindowStore } from "../../app/store/window-store";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PersonPage as Page, PersonRow } from "../../core/bindings";
import { find, rendered } from "../../ui/testing";
import { PeopleToolbar, personIdOf } from "./PeopleToolbar";
import { DialogsProvider } from "../../ui/dialogs/host";
import { BridgeProvider } from "../../app/bridge/context";
import { Overview, PersonBody, PersonPage, readPerson, type PersonBodyProps } from "./PersonPage";
import { holdPerson, setPersonTab } from "./person-store";

const person = (o: Partial<PersonRow> = {}): PersonRow => ({
  id: "per_a", rev: 1, display_name: "Anna Kuznetsova", short_name: "Anna K.", initials: "AK", email: "anna@x.io", role: "PM", org: null,
  aliases: ["Anya"], is_you: false, voice_profile: false, last_call_at: null, open_items: 0, you_owe: 0, notes: null, ...o,
});
const page = (o: Partial<Page> = {}): Page => ({ person: person(), calls: [], owns_open: [], you_owe: [], open_questions: [], topics: [], talk_share: null, ...o });
const bridge = { act: vi.fn(async () => ({ status: "ok" })), core: { windowNavigate: vi.fn() }, store: { getState: () => ({ entities: {}, commands: {}, app: null }), subscribe: () => () => {} } } as never;
const props = (o: Partial<PersonBodyProps> = {}): PersonBodyProps => ({
  bridge, state: { status: "OK", page: page(), error: null }, tab: "overview", prefs: undefined, slow: false, onRetry: vi.fn(), ...o,
});
const call = { id: "call_1", title: "Planning", started_at: 1_700_000_000_000, participants: [], languages: [], tags: [], call_type: "one_on_one", status: "ready", privacy: "normal", duration_s: 60 } as never;

describe("cpt-noter-flow-ui-people-prepare", () => {
  it("shows the recorded profile date, available profiles and distinct matched calls", () => {
    const p = person({ voice_profile: true, voice_profile_stats: { opted_in_at: Date.UTC(2026, 9, 3, 12), profiles: 2, matched_calls: 28 } } as Partial<PersonRow>);
    const h = renderToString(<Overview bridge={bridge} page={page({ person: p, calls: [call] })} prefs={undefined} />);
    expect(h).toContain("On since Oct 3");
    expect(h).toContain("On since Oct 3 · 2 profiles · matched in 28 calls"); // #1152, one line
    expect(h).not.toContain("2 profiles matched");
  });
  it("PE-R5 Languages lists their languages with shares; none without transcribed lines (#1152)", () => {
    const h = renderToString(<Overview bridge={bridge} page={page({ calls: [call], languages: [{ lang: "ru", share: 0.71 }, { lang: "en", share: 0.29 }] } as never)} prefs={undefined} />);
    expect(h).toContain("<dt>Languages</dt><dd>Russian 71 % · English 29 %</dd>");
    expect(renderToString(<Overview bridge={bridge} page={page({ calls: [call] })} prefs={undefined} />)).not.toContain("Languages");
  });
  it("NO_CALLS: the person's first-call message, no blocks", () => {
    const h = renderToString(<PersonBody {...props()} />);
    expect(h).toContain("No calls with Anna K. yet");
    expect(h).not.toContain("Open commitments");
  });
  it("OVERVIEW: commitments, Asked you, topics and identity; the talk-time row only when the core sends it", () => {
    const withCalls = page({ calls: [call], topics: [{ id: "top_1", name: "Pricing" }] as never });
    const h = renderToString(<PersonBody {...props({ state: { status: "OK", page: withCalls, error: null } })} />);
    for (const s of ["Open commitments", "Asked you", "Nothing open", "Pricing", "Identity", "Anna K., Anya", "anna@x.io", "Off", "Last calls", "Show All"]) expect(h).toContain(s);
    expect(h).not.toContain("Talk time");
    const metrics = renderToString(<PersonBody {...props({ state: { status: "OK", page: { ...withCalls, talk_share: 0.42 }, error: null } })} />);
    expect(metrics).toContain("Talk time");
    expect(metrics).toContain("42%");
  });
  it("the voice profile row follows the person", () => {
    const on = page({ calls: [call], person: person({ voice_profile: true }) });
    const h = renderToString(<PersonBody {...props({ state: { status: "OK", page: on, error: null } })} />);
    expect(h).toContain("Delete Profile…");
    // #1278: with a profile, Find in Past Calls runs the match again
    expect(h).toContain("Find in Past Calls");
    const find1 = vi.fn();
    const tree = rendered(Overview, { bridge, page: on, prefs: undefined, onFindVoice: find1 });
    (find(tree, (x) => x.id === "pe-voice-find").props.onAction as () => void)();
    expect(find1).toHaveBeenCalledOnce();
  });
  it("Identity offers Set Up Voice Profile… when Off and Delete Profile… when On, and shows a done action as a status line", () => {
    const off = renderToString(<PersonBody {...props({ state: { status: "OK", page: page({ calls: [call] }), error: null }, status: "Voice profile created for Anna K." })} />);
    expect(off).toContain("Set Up Voice Profile…");
    expect(off).toContain('role="status"');
    expect(off).toContain("Voice profile created for Anna K.");
  });
  it("a topic chip opens the topic route", () => {
    const p = page({ calls: [call], topics: [{ id: "top_1", name: "Pricing" }] as never });
    const tree = rendered(Overview, { bridge, page: p, prefs: undefined });
    (find(tree, (x) => typeof x.name === "string" && typeof x.onOpen === "function").props.onOpen as () => void)(); // a TopicChip (#1090)
    expect((bridge as never as { act: ReturnType<typeof vi.fn> }).act).toHaveBeenCalledWith("window_navigate", "window_navigate", expect.any(Function), expect.anything());
  });
  it("CALLS lists the person's calls; HISTORY mounts the person's timeline", () => {
    const p = page({ calls: [call] });
    expect(renderToString(<PersonBody {...props({ tab: "calls", state: { status: "OK", page: p, error: null } })} />)).toContain("Planning");
    expect(renderToString(<DialogsProvider><PersonBody {...props({ tab: "history", state: { status: "OK", page: p, error: null } })} /></DialogsProvider>)).toContain('data-region="PE-HISTORY"');
  });
  it("LOADING has skeleton rows only after the delay; ERROR offers Try Again", () => {
    const loading = { status: "LOADING" as const, page: null, error: null };
    expect(renderToString(<PersonBody {...props({ state: loading })} />)).not.toContain("lb-skel");
    expect(renderToString(<PersonBody {...props({ state: loading, slow: true })} />)).toContain("lb-skel");
    expect(renderToString(<PersonBody {...props({ state: { ...loading, status: "ERROR" } })} />)).toContain("Try Again");
  });
});

describe("Person toolbar", () => {
  const base = { title: "", actions: [], hasSearch: true, narrow: false, canBack: false, canForward: false, showToggle: false, search: "", searchOpen: false, onBack() {}, onForward() {}, onToggleSidebar() {}, onSearch() {}, onRunSearch() {}, onOpenSearch() {} };
  const draw = (key: string) => renderToString(<DialogsProvider><PeopleToolbar route={{ section: "people", key }} bridge={bridge} base={base} inspectorOpen={false} onToggleInspector={() => {}} /></DialogsProvider>);
  it("reads the person id from the route and shows the name with the Overview, Calls and History control", () => {
    expect(personIdOf("person:per_a")).toBe("per_a");
    expect(personIdOf("root")).toBeNull();
    holdPerson(page());
    setPersonTab("per_a", "calls");
    const h = draw("person:per_a");
    expect(h).toContain("Anna K.");
    for (const s of ["Overview", "Calls", "History"]) expect(h).toContain(s);
    expect(h).not.toContain("pl-search");
    holdPerson(null);
  });
});

describe("Show All (QA #908)", () => {
  it("switches the person's view to Calls", () => {
    const withCalls = page({ calls: [call] });
    const onShowAll = vi.fn();
    const tree = rendered(Overview, { bridge, page: withCalls, prefs: undefined, onShowAll });
    (find(tree, (x) => x.cls === "pe-showall").props.onAction as () => void)(); // the Show All push button (#1090)
    expect(onShowAll).toHaveBeenCalledOnce();
  });
  it("the page wires it to the Calls view of that person", async () => {
    const { usePersonTab } = await import("./person-store");
    const { showAll } = await import("./PersonPage");
    showAll("per_show");
    let tab = "";
    renderToString((() => { const P = () => ((tab = usePersonTab("per_show")), null); return <P />; })());
    expect(tab).toBe("calls");
  });
});

describe("PersonPage", () => {
  it("reads one person: OK with the page, ERROR with the core's error", async () => {
    const ok = { status: "ok", data: page() };
    expect(await readPerson({ act: async () => ok, core: { personGet: vi.fn() } } as never, "per_a")).toEqual({ status: "OK", page: page(), error: null });
    const err = { status: "error", error: { code: "not_found" } };
    expect(await readPerson({ act: async () => err, core: {} } as never, "per_a")).toEqual({ status: "ERROR", page: null, error: { code: "not_found" } });
  });
  it("starts LOADING under the bridge and dialogs providers", () => {
    const b = { label: "main", store: createWindowStore("main"), act: () => new Promise(() => {}), core: {} } as never;
    const h = renderToString(<BridgeProvider value={b}><DialogsProvider><PersonPage id="per_a" /></DialogsProvider></BridgeProvider>);
    expect(h).toContain('data-state="loading"');
  });
});
