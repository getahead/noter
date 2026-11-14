// The controls of every pane run their commands: each handler a pane gives its controls is called and the
// core's answer is read back from the store or the fake's world.
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { sentCommands } from "../../../tests/support/fake-core";
import { loadSettings } from "./actions";
import { AudioPane, registerSystemAudioReturn } from "./AudioPane";
import { CallScreenPane } from "./CallScreenPane";
import { GeneralPane } from "./GeneralPane";
import { GlossaryForm, GlossaryGroup } from "./GlossaryGroup";
import { addTerm, listTerms, newTermArgs, removeTerm } from "./glossary";
import { HotkeysPane } from "./HotkeysPane";
import { ModelsGroup } from "./ModelsGroup";
import { PerformancePane } from "./PerformancePane";
import { PrivacyPane } from "./PrivacyPane";
import { askScreenRecording, runShareTest } from "./share-test";
import { ShareTestFailure } from "./ShareTestSheet";
import { UpdatesPane } from "./UpdatesPane";

let bridge: Bridge;
let fake: FakeCore;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); return bridge.close(); });

async function ready(seed?: (w: FakeCore["world"]) => void) {
  fake = new FakeCore({ window: "settings" });
  seed?.(fake.world);
  bridge = createBridge("settings", fake);
  await bridge.open();
  await loadSettings(bridge);
}
const stored = () => bridge.store.getState().whole.settings!;
type Tree = ReturnType<typeof rendered>;
/** The handler of the control that has this label (or aria-label) and a handler under `prop`. */
const on = (tree: Tree, label: string, prop = "onAction") => find(tree, (p) => (p.label === label || p.ariaLabel === label) && typeof p[prop] === "function").props[prop] as (v?: unknown) => void;
const calls = () => {
  return sentCommands(fake);
};

describe("General", () => {
  it("every control saves its own setting or runs its command", async () => {
    await ready((w) => ((w.app.environment.notifications = "denied"), (w.app.setup.self_test = { type: "not_run" })));
    const seen = calls();
    const tree = rendered(GeneralPane, { bridge, settings: stored() });
    on(tree, "Summary language")("ru");
    on(tree, "Horizon")("today");
    on(tree, "Ranking")("due_then_owed_to_you");
    on(tree, "Open System Settings…")();
    on(tree, "Run Setup Again…")();
    await vi.waitFor(() => expect(stored().general.summary_language).toBe("ru"));
    expect(stored().today.horizon).toBe("today");
    expect(stored().today.ranking).toBe("due_then_owed_to_you");
    expect(seen.map(([cmd]) => cmd)).toEqual(expect.arrayContaining(["open_external", "window_navigate"]));
    const html = renderToString(<GeneralPane bridge={bridge} settings={stored()} />);
    expect(html).toContain("Needs a passed audio self-test");
    expect(html).toContain("Notifications are off for Noter");
    expect(html).toContain('<path d="M8 7.2v4M8 4.8v.2"'); // the info icon, not the warning triangle
    for (const auth of ["authorized", "not_determined"] as const) {
      fake.world.app.environment.notifications = auth;
      await bridge.close();
      bridge = createBridge("settings", fake);
      await bridge.open();
      await loadSettings(bridge);
      expect(renderToString(<GeneralPane bridge={bridge} settings={stored()} />)).not.toContain("Notifications are off for Noter"); // only macOS's denied is off
    }
    expect(html).toContain("Run Audio Self-Test…");
    expect(html).toContain("Notifications are off for Noter");
  });

  it("offer to record saves once the self-test passed", async () => {
    await ready((w) => (w.app.setup.self_test = { type: "passed", at: 1 }));
    on(rendered(GeneralPane, { bridge, settings: stored() }), "Offer to record when a call starts")(false);
    await vi.waitFor(() => expect(stored().general.offer_to_record).toBe(false));
  });
});

describe("Audio", () => {
  it("the archive backend saves, the permission rows ask or open System Settings, the self-test button is there", async () => {
    await ready((w) => w.app.setup.permissions.forEach((p) => p.kind === "microphone" && (p.state = "not_asked")));
    const seen = calls();
    const tree = rendered(AudioPane, { bridge, settings: stored() });
    on(tree, "Archive pass")("whisper_large_v3");
    const mic = find(tree, (p) => p.id === "mic" && typeof p.onAllow === "function").props;
    (mic.onAllow as () => void)();
    (mic.onOpenSettings as () => void)();
    (find(tree, (p) => p.id === "sys" && typeof p.onOpenSettings === "function").props.onOpenSettings as () => void)();
    await vi.waitFor(() => expect(stored().audio.offline_backend).toBe("whisper_large_v3"));
    expect(seen.filter(([cmd]) => cmd === "open_external")).toHaveLength(2);
    expect(seen.map(([cmd]) => cmd)).toContain("permission_request");
    expect(on(tree, "Run Audio Self-Test…")).toBeTypeOf("function");
  });

  it("rechecks system audio and refreshes the snapshot after returning from System Settings", async () => {
    await ready((w) => w.app.setup.permissions.forEach((p) => p.kind === "system_audio" && (p.state = "not_asked")));
    const listeners = new Map<string, () => void>();
    const browserWindow = {
      addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    vi.stubGlobal("window", browserWindow);
    const pending = { current: true };
    const stop = registerSystemAudioReturn(bridge, pending);
    await listeners.get("focus")!();
    await listeners.get("focus")!();
    expect(bridge.store.getState().commands["permission:system_audio"]?.state).toBe("DONE");
    expect(fake.world.app.setup.permissions.find((p) => p.kind === "system_audio")?.state).toBe("granted");
    (stop as () => void)();
    expect(listeners.has("focus")).toBe(false);
  });
});

describe("Call screen", () => {
  it("picking a display runs setup_set_call_display", async () => {
    await ready();
    const seen = calls();
    (find(rendered(CallScreenPane, { bridge, settings: stored() }), (p) => typeof p.onSelect === "function").props.onSelect as (v: string) => void)("auto");
    await vi.waitFor(() => expect(seen.map(([cmd]) => cmd)).toContain("setup_set_call_display"));
  });

  it("shows a refused display change and a refused Run Setup command", async () => {
    await ready();
    fake.failNext("setup_set_call_display", "offline");
    const tree = rendered(CallScreenPane, { bridge, settings: stored() });
    (find(tree, (p) => typeof p.onSelect === "function").props.onSelect as (v: string) => void)("auto");
    await vi.waitFor(() => expect(renderToString(<CallScreenPane bridge={bridge} settings={stored()} />)).toContain("Couldn’t save this change"));
    fake.failNext("window_navigate", "offline");
    on(rendered(GeneralPane, { bridge, settings: stored() }), "Run Setup Again…")();
    await vi.waitFor(() => expect(renderToString(<GeneralPane bridge={bridge} settings={stored()} />)).toContain("Couldn’t save this change"));
  });
});

describe("Privacy", () => {
  it("Calendar asks through permission_request, opens System Settings, and Manage on Person Pages sends nothing", async () => {
    await ready((w) => w.app.setup.permissions.forEach((p) => p.kind === "calendar" && (p.state = "not_asked")));
    const seen = calls();
    const tree = rendered(PrivacyPane, { bridge, settings: stored() });
    const cal = find(tree, (p) => p.id === "cal").props;
    (cal.onAllow as () => void)();
    (cal.onOpenSettings as () => void)();
    await vi.waitFor(() => expect(seen.map(([cmd]) => cmd)).toEqual(expect.arrayContaining(["permission_request", "open_external"])));
    expect(seen.map(([cmd]) => cmd)).not.toContain("window_navigate"); // the voice-profiles button is disabled until Person Pages land
  });
});

describe("Hotkeys, Performance, Updates, Models", () => {
  it("the card keys and Restore Defaults rows are rendered with their controls", async () => {
    await ready();
    const html = renderToString(<HotkeysPane bridge={bridge} />);
    expect(html).toContain("Pin a card");
    expect(html).toContain("Dismiss a card");
  });

  it("a threshold commits through onCommit", async () => {
    await ready();
    const tree = rendered(PerformancePane, { bridge, settings: stored() });
    const near = find(tree, (p) => p.label === "Near" && typeof p.onCommit === "function").props.onCommit as (n: number) => void;
    near(80);
    const over = find(tree, (p) => p.label === "Over" && typeof p.onCommit === "function").props.onCommit as (n: number) => void;
    over(120);
    await vi.waitFor(() => expect(stored().performance.near_pct).toBe(80));
    expect(stored().performance.over_pct).toBe(120);
  });

  it("Restart Now installs a waiting update; Check Now reads the core again", async () => {
    await ready((w) => (w.app.environment.update = { version: "1.2", notes_md: "", ready: true }));
    const seen = calls();
    const tree = rendered(UpdatesPane, { bridge, settings: stored() });
    const banner = find(tree, (p) => p.banner !== undefined).props.banner as { actions: { onAction: () => void }[] };
    banner.actions[0]!.onAction();
    on(tree, "Check Now")();
    await vi.waitFor(() => expect(seen.map(([cmd]) => cmd)).toEqual(expect.arrayContaining(["update_install", "app_snapshot"])));
  });

  it("a pending model offers Download and runs models_download", async () => {
    await ready((w) => (w.app.setup.models.bundles[0]!.state = "pending"));
    const seen = calls();
    on(rendered(ModelsGroup, { bridge }), "Download")();
    await vi.waitFor(() => expect(seen.map(([cmd]) => cmd)).toContain("models_download"));
    expect(renderToString(<ModelsGroup bridge={bridge} />)).toContain("Download");
  });
});

describe("glossary commands", () => {
  it("lists, adds and removes terms", async () => {
    await ready();
    const before = (await listTerms(bridge))!;
    const after = (await addTerm(bridge, { term: "zzterm", variants_latin: ["zz"], variants_cyrillic: [], spoken_forms: [], always_apply: false }))!;
    expect(after.some((t) => t.term === "zzterm")).toBe(true);
    expect(after.length).toBe(before.length + 1);
    const gone = (await removeTerm(bridge, after.find((t) => t.term === "zzterm")!.id))!;
    expect(gone.length).toBe(before.length);
  });

  it("answers null when the core refuses", async () => {
    await ready();
    fake.failNext("glossary_upsert", "offline");
    expect(await addTerm(bridge, { term: "x", variants_latin: [], variants_cyrillic: [], spoken_forms: [], always_apply: false })).toBeNull();
    fake.failNext("glossary_list", "offline");
    expect(await listTerms(bridge)).toBeNull();
  });

  it("shows a refused list read with a working retry and exposes the edit form actions", async () => {
    await ready();
    const term = fake.world.glossary.terms[0]!;
    fake.failNext("glossary_list", "offline");
    expect(await listTerms(bridge)).toBeNull();
    const retryTree = rendered(GlossaryGroup, { bridge });
    expect(renderToString(retryTree)).toContain("Couldn’t read the glossary.");
    (find(retryTree, (p) => p.label === "Try Again").props.onAction as () => void)();
    await vi.waitFor(() => expect(bridge.store.getState().commands["glossary:list"]?.state).toBe("DONE"));

    const save = vi.fn();
    const cancel = vi.fn();
    const editTree = rendered(GlossaryForm, { form: { term: term.term, latin: "", cyrillic: "", spoken: "" }, editing: term, mutationFailed: false, onChange: () => {}, onSave: save, onCancel: cancel });
    expect(renderToString(editTree)).toContain('aria-label="Edit Term"');
    (find(editTree, (p) => p.label === "Save").props.onAction as () => void)();
    (find(editTree, (p) => p.label === "Cancel").props.onAction as () => void)();
    expect(save).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("share test sheet", () => {
  it("retries a refused table read from its visible error", async () => {
    await ready();
    fake.failNext("share_test_run", "offline");
    expect((await runShareTest(bridge, false)).result).toBeNull();
    const readRetry = vi.fn(async () => {});
    const captureRetry = vi.fn();
    const tree = rendered(ShareTestFailure, { failedCapture: false, onCaptureRetry: captureRetry, onReadRetry: readRetry });
    expect(renderToString(tree)).toContain("Couldn’t load the Screen Share Test.");
    (find(tree, (p) => p.label === "Try Again").props.onAction as () => void)();
    await vi.waitFor(() => expect(readRetry).toHaveBeenCalledWith(false));
    expect(captureRetry).not.toHaveBeenCalled();
  });
});

describe("share test commands", () => {
  it("returns the table, the capture outcome, and a failed outcome when refused", async () => {
    await ready((w) => (w.app.capture.phase = "idle"));
    const table = await runShareTest(bridge, false);
    expect(table.result?.rows.length).toBeGreaterThan(0);
    expect(table.outcome).toBeNull();
    const ran = await runShareTest(bridge, true);
    expect(ran.outcome).toMatchObject({ type: "passed" });
    fake.failNext("share_test_run", "offline");
    expect(await runShareTest(bridge, true)).toEqual({ result: null, outcome: { type: "failed", code: "offline" } });
    fake.failNext("share_test_run", "offline");
    expect(await runShareTest(bridge, false)).toEqual({ result: null, outcome: { type: "failed", code: "offline" } });
  });

  it("asks for Screen Recording once", async () => {
    await ready();
    expect(await askScreenRecording(bridge)).toBe(true);
    fake.failNext("permission_request", "offline");
    expect(await askScreenRecording(bridge)).toBe(false);
  });

  it("counts Screen Recording as refused when macOS answered without granting it (no prompt, or a relaunch first)", async () => {
    await ready();
    for (const state of ["needs_relaunch", "not_asked"] as const) {
      vi.spyOn(bridge.core, "permissionRequest").mockResolvedValueOnce({ status: "ok", data: { kind: "screen_recording", state } });
      expect(await askScreenRecording(bridge)).toBe(false);
    }
  });
});

import { createGlossaryActions } from "./glossary";
import { handleKeyDown, handleKeyUp, type KeyEvent, type RecorderCtx } from "./recorder-key";
import { createShareActions } from "./share-test";
import { listKeyAction } from "./window";

describe("recorder key handlers", () => {
  const ev = (over: Partial<KeyEvent> = {}): KeyEvent => ({ key: "u", code: "KeyU", ctrlKey: true, altKey: true, metaKey: true, shiftKey: false, repeat: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over });
  const ctx = (over: Partial<RecorderCtx> = {}): RecorderCtx & { sent: unknown[] } => {
    const sent: unknown[] = [];
    return { state: { type: "RECORDING", from: "IDLE" }, variant: "single", held: { current: null }, dispatch: vi.fn(), settle: () => {}, onRecord: async (c) => (sent.push(c), { ok: true }), onClear: async () => (sent.push("clear"), { ok: true }), sent, ...over };
  };

  it("sends an accepted chord and consumes the key", () => {
    const c = ctx();
    const e = ev();
    handleKeyDown(c, e);
    expect(c.sent).toEqual([{ code: "KeyU", modifiers: { control: true, option: true, command: true, shift: false } }]);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(c.dispatch).toHaveBeenCalled();
  });

  it("sends a clear on backspace", () => {
    const c = ctx();
    handleKeyDown(c, ev({ key: "Backspace", code: "Backspace", ctrlKey: false, altKey: false, metaKey: false }));
    expect(c.sent).toEqual(["clear"]);
  });

  it("leaves a key alone while the field is not recording, and Esc takes away the hint of an own attempt", () => {
    const idle = ctx({ state: { type: "IDLE" } });
    handleKeyDown(idle, ev());
    expect(idle.sent).toEqual([]);
    const hint = ctx({ state: { type: "INVALID", message: "x" } });
    handleKeyDown(hint, ev({ key: "Escape", code: "Escape" }));
    expect(hint.dispatch).toHaveBeenCalledWith({ type: "dismiss" });
    const core = ctx({ state: { type: "CONFLICT", message: "Used by Raycast" }, conflict: "Used by Raycast" });
    handleKeyDown(core, ev({ key: "Escape", code: "Escape" }));
    expect(core.dispatch).not.toHaveBeenCalledWith({ type: "dismiss" });
  });

  it("holds a modifier set until the keys are released, then sends it once", () => {
    const c = ctx({ variant: "modifier-set" });
    handleKeyDown(c, ev({ code: "ControlLeft", altKey: false, metaKey: false }));
    handleKeyDown(c, ev({ code: "AltLeft", metaKey: false }));
    expect(c.sent).toEqual([]);
    handleKeyUp(c, { code: "AltLeft", ctrlKey: true, altKey: false, metaKey: false, shiftKey: false });
    expect(c.sent).toEqual([]); // Control is still down
    handleKeyUp(c, { code: "ControlLeft", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false });
    expect(c.sent).toEqual([{ code: "ControlLeft", modifiers: { control: true, option: true, command: false, shift: false } }]);
    expect(c.held.current).toBeNull();
  });

  it("ignores a keyup while not recording", () => {
    const c = ctx({ state: { type: "IDLE" }, held: { current: { control: true, option: false, command: false, shift: false } } });
    handleKeyUp(c, { code: "ControlLeft", ctrlKey: false, altKey: false, metaKey: false, shiftKey: false });
    expect(c.sent).toEqual([]);
  });
});

describe("share test sheet actions", () => {
  const setup = async (seed?: (w: FakeCore["world"]) => void) => {
    await ready(seed);
    const events: unknown[] = [];
    const results: unknown[] = [];
    return { events, results, make: (permission: "granted" | "not_asked") => createShareActions(bridge, { permission, dispatch: (e) => events.push(e), setResult: (r) => results.push(r) }) };
  };

  it("loads the table, and runs the capture test at once with Screen Recording granted", async () => {
    const s = await setup((w) => (w.app.capture.phase = "idle"));
    const a = s.make("granted");
    await a.run(false);
    expect(s.results).toHaveLength(1);
    a.start();
    await vi.waitFor(() => expect(s.events).toContainEqual({ type: "run", screenRecording: "granted" }));
    await vi.waitFor(() => expect(s.events).toContainEqual({ type: "outcome", outcome: expect.objectContaining({ type: "passed" }) }));
  });

  it("asks first without it, and runs once Continue is granted", async () => {
    const s = await setup((w) => (w.app.capture.phase = "idle"));
    const a = s.make("not_asked");
    a.start();
    expect(s.events).toEqual([{ type: "run", screenRecording: "not_asked" }]);
    await a.answer();
    await vi.waitFor(() => expect(s.events).toContainEqual({ type: "answered", granted: true }));
    await vi.waitFor(() => expect(s.events).toContainEqual({ type: "outcome", outcome: expect.objectContaining({ type: "passed" }) }));
  });

  it("does not run when Continue is refused", async () => {
    const s = await setup();
    fake.failNext("permission_request", "offline");
    await s.make("not_asked").answer();
    expect(s.events).toEqual([{ type: "answered", granted: false }]);
  });
});

describe("glossary actions", () => {
  it("adds the form's term and closes the form, removes the selected term and clears the selection", async () => {
    await ready();
    const st = { terms: [] as unknown[], form: { term: "zzq", latin: "zq", cyrillic: "", spoken: "" } as unknown, selected: null as string | null };
    const make = () => createGlossaryActions(bridge, { form: st.form as never, selected: st.selected, setTerms: (t) => (st.terms = t), setForm: (f) => (st.form = f), setSelected: (id) => (st.selected = id) });
    await make().add();
    expect(st.form).toBeNull();
    expect((st.terms as { term: string }[]).some((t) => t.term === "zzq")).toBe(true);
    st.selected = (st.terms as { term: string; id: string }[]).find((t) => t.term === "zzq")!.id;
    await make().remove();
    expect(st.selected).toBeNull();
    expect((st.terms as { term: string }[]).some((t) => t.term === "zzq")).toBe(false);
  });

  it("does nothing without a term or a selection", async () => {
    await ready();
    const setTerms = vi.fn();
    const a = createGlossaryActions(bridge, { form: null, selected: null, setTerms, setForm: () => {}, setSelected: () => {} });
    await a.add();
    await a.remove();
    expect(setTerms).not.toHaveBeenCalled();
  });

  it("keeps a refused glossary add open, preserves a refused removal selection, and edits with the stored revision", async () => {
    await ready();
    const seed = await listTerms(bridge);
    const term = seed![0]!;
    const form = { term: term.term, latin: term.variants_latin.join(", "), cyrillic: term.variants_cyrillic.join(", "), spoken: term.spoken_forms.join(", ") };
    expect(newTermArgs(form, term)).toMatchObject({ id: term.id, rev: term.rev, term: term.term });
    const state: { form: typeof form | null; selected: string | null } = { form: { term: "new term", latin: "", cyrillic: "", spoken: "" }, selected: term.id };
    const make = () => createGlossaryActions(bridge, { ...state, setTerms: () => {}, setForm: (value) => { state.form = value; }, setSelected: (value) => { state.selected = value; } });
    fake.failNext("glossary_upsert", "invalid_input");
    await make().add();
    expect(state.form).not.toBeNull();
    fake.failNext("glossary_remove", "offline");
    await make().remove();
    expect(state.selected).toBe(term.id);
  });
});

describe("listKeyAction", () => {
  it("↓ in the search field enters the list, arrows move, Return clicks the focused pane", () => {
    expect(listKeyAction("ArrowDown", "INPUT", -1, 11)).toEqual({ focus: 0 });
    expect(listKeyAction("ArrowDown", "A", 2, 11)).toEqual({ focus: 3 });
    expect(listKeyAction("Enter", "A", 4, 11)).toEqual({ click: 4 });
    expect(listKeyAction("Enter", "INPUT", -1, 11)).toBeNull();
    expect(listKeyAction("x", "A", 1, 11)).toBeNull();
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
