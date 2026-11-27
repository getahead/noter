import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { effects, refs, stateWrites, fold } = vi.hoisted(() => ({
  fold: { forced: undefined as number | undefined },
  effects: [] as (() => void)[],
  refs: [] as { current: unknown }[],
  stateWrites: [] as unknown[],
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: <T,>(initial: T | (() => T)) => {
      const [value, setValue] = react.useState(initial);
      return [value, (next: T | ((previous: T) => T)) => {
        const resolved = typeof next === "function" ? (next as (previous: T) => T)(value) : next;
        stateWrites.push(resolved);
        setValue(resolved);
      }] as const;
    },
    useEffect: (effect: () => void) => void effects.push(effect),
    useRef: (value: unknown) => {
      const ref = react.useRef(value);
      refs.push(ref);
      return ref;
    },
  };
});

vi.mock("./header-fold", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./header-fold")>();
  return { ...actual, useHeaderFold: (...a: Parameters<typeof actual.useHeaderFold>) => fold.forced ?? actual.useHeaderFold(...a) };
});

import { App } from "../../app/App";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { CallWindowState, CaptureState, CommandName, DegradedState, EventName, Transport } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { BannerSlot, InlineBanner } from "../../ui/feedback/inline-banner";
import { IconButton } from "../../ui/primitives/icon-button";
import type { MenuItem } from "../../ui/primitives/menu";
import { find, rendered } from "../../ui/testing";
import { EmptyState } from "../../ui/feedback/empty-state";
import { IdleCallWindow } from "./idle-call-window";
import { TranscriptLog, type TranscriptLogProps } from "../transcript/hosts";
import { CallWindow, loadParticipants } from "./call-window";
import { CaptureNotice, ClosingState, type NoticeHandlers } from "./notice";
import { CallStatusStrip, CollapsedCallStrip, MoreMenu, PersonChip, type StripProps } from "./strip";

let bridge: Bridge | null = null;
let fake: FakeCore;
const sent: { cmd: CommandName; args: unknown }[] = [];
afterEach(async () => {
  await bridge?.close();
  bridge = null;
  sent.length = 0;
  effects.length = 0;
  fold.forced = undefined;
  refs.length = 0;
  stateWrites.length = 0;
  vi.unstubAllGlobals();
});

const MIN = 60_000;

/** The call window over the fake core, with the window state read as the window reads it on open. */
async function open(cap: Partial<CaptureState> = {}, win: Partial<CallWindowState> = {}, degraded: DegradedState[] = []) {
  fake = new FakeCore({ window: "call-screen" });
  Object.assign(fake.world.app.capture, cap);
  fake.world.app.degraded.states = degraded;
  Object.assign(fake.callWindow, win);
  const transport: Transport = {
    invoke: (cmd, args, on) => (sent.push({ cmd, args }), fake.invoke(cmd, args, on)),
    listen: (e: EventName, h) => fake.listen(e, h),
  };
  bridge = createBridge("call-screen", transport);
  await bridge.open();
  await bridge.act("window_call_state", "window_call_state", () => bridge!.core.windowCallState({}), { slice: "callWindow" });
}
const html = () => renderToString(<CallWindow bridge={bridge!} />);
const tree = () => rendered(CallWindow, { bridge: bridge! });
const args = (cmd: CommandName) => sent.filter((c) => c.cmd === cmd).map((c) => c.args);
const settle = () => new Promise((r) => setTimeout(r, 0));
const live = { call_id: "call_live" };
const strip = () => find(tree(), (_p, type) => type === CallStatusStrip).props as unknown as StripProps;
const notice = () => find(tree(), (_p, type) => type === CaptureNotice).props as unknown as { on: NoticeHandlers };
const more = () => {
  const items = find(tree(), (_p, type) => type === MoreMenu).props.items as MenuItem[];
  return (label: string) => items.find((i) => "label" in i && i.label === label) as Extract<MenuItem, { label: string }>;
};
const icon = (label: string) => find(tree(), (p, type) => type === IconButton && p.label === label).props as unknown as { onAction: () => void; help?: string };

describe("CallWindow (cpt-noter-component-shell-call-window)", () => {
  it("loads participants only for the current call and clears on close", async () => {
    const participants = [{ id: "per_anna", display_name: "Anna", short_name: "Anna", initials: "A", is_you: false }];
    const update = vi.fn();
    const bridgeForCall = { core: { callGet: vi.fn().mockResolvedValue({ status: "ok", data: { call: { participants } } }) } } as unknown as Bridge;
    loadParticipants(bridgeForCall, "call_live", update);
    await Promise.resolve();
    expect(bridgeForCall.core.callGet).toHaveBeenCalledWith({ call_id: "call_live" });
    expect(update).toHaveBeenCalledWith(participants);
    loadParticipants(bridgeForCall, null, update);
    expect(update).toHaveBeenLastCalledWith([]);
  });

  it("ignores an old participants read after the call changes", async () => {
    let resolve!: (result: unknown) => void;
    const callGet = vi.fn(() => new Promise((done) => { resolve = done; }));
    const update = vi.fn();
    const stop = loadParticipants({ core: { callGet } } as unknown as Bridge, "call_old", update);
    stop();
    resolve({ status: "ok", data: { call: { participants: [] } } });
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
  });

  it("is mounted by App for the call-screen window and draws the dedicated layout", async () => {
    await open();
    const page = renderToString(<App bridge={bridge!} />);
    expect(page).toContain('data-component="cpt-noter-component-shell-call-window"');
    for (const r of ["CS-R1", "CS-R2", "CS-R5"]) expect(page).toContain(`data-region="${r}"`);
    expect(page).not.toContain('data-region="CS-R0"');
    expect(page).not.toContain('data-region="CS-R3"');
    expect(page).toContain("Planning: VHI 8.0 drawer redesign");
    expect(page).toContain('aria-label="Hidden from window shares"');
    expect(page).toContain('data-state="not-key"');
  });

  it("shows loading until the window state arrives and draws nothing for a closed idle panel", async () => {
    fake = new FakeCore({ window: "call-screen" });
    bridge = createBridge("call-screen", fake);
    await bridge.open();
    expect(html()).toContain("Loading the call");
    await bridge.close();
    await open({ phase: "idle", call_id: null }, { visible: false });
    expect(html()).toBe("");
  });

  it("starts capture in the explicitly opened idle panel and reports a refusal", async () => {
    await open({ phase: "idle", call_id: null }, { visible: true });
    expect(html()).toContain("Not recording");
    const idle = rendered(IdleCallWindow, { bridge: bridge!, layout: "floating" });
    const start = find(idle, (p) => p.label === "Start Recording").props.onAction as () => Promise<void>;
    fake.failNext("capture_start", "disk_full");
    await start();
    expect(stateWrites).toContain("disk_full");
    await start();
    expect(bridge!.store.getState().whole.capture?.phase).toBe("recording");
    expect(args("capture_start")).toEqual(Array(2).fill({ source: "call_window", sensitive: false }));
  });

  it("links an idle recording blocker to Settings and closes the panel", async () => {
    await open({ phase: "idle", call_id: null }, { visible: true });
    await bridge!.core.windowShowCall({});
    bridge!.store.setState((s) => ({ whole: { ...s.whole, environment: { ...s.whole.environment!, disk_free_mb: 400 } } }));
    const idle = rendered(IdleCallWindow, { bridge: bridge!, layout: "floating" });
    const empty = find(idle, (_p, type) => type === EmptyState);
    expect(empty.props.linkLabel).toBe("Maintenance");
    expect(find(idle, (p) => p.label === "Start Recording").props.disabled).toBe(true);
    await (empty.props.onLink as () => Promise<void>)();
    expect(args("window_navigate")).toEqual([{ target: { type: "settings", pane: "maintenance" } }]);
    await (find(idle, (p) => p.label === "Close").props.onAction as () => Promise<void>)();
    expect(bridge!.store.getState().whole.callWindow?.visible).toBe(false);
  });

  it("offers to reload the snapshot if a live capture lacks its call identity", async () => {
    await open({ phase: "recording", call_id: null });
    expect(html()).toContain("Try Again");
    const banner = find(tree(), (_p, type) => type === InlineBanner).props.banner as { actions: { onAction: () => void }[] };
    banner.actions[0].onAction();
    await settle();
    expect(args("app_snapshot")).toHaveLength(2);
  });

  it("sends mode and call-ended announcements through the call-screen bridge", async () => {
    await open({ phase: "recording", notice: { type: "call_ended", stops_at: 1 } });
    vi.stubGlobal("document", { hasFocus: () => false, querySelector: () => null });
    html();
    const modeEffect = effects.find((effect) => effect.toString().includes("modeChangeAnnouncement"));
    expect(modeEffect).toBeDefined();
    refs.find((ref) => ref.current === null)!.current = "LOCAL_ONLY";
    modeEffect!();
    const captureEffect = effects.find((effect) => effect.toString().includes("captureAnnouncements"));
    expect(captureEffect).toBeDefined();
    captureEffect!();
    await settle();
    expect(args("window_announce")).toContainEqual({ text: "The call seems to have ended. Noter stops recording in 10 seconds. Press Control-Option-Command-N, then Return, to keep recording.", politeness: "assertive" });
  });

  it("keeps announcement effects safe while the call-window snapshot is still missing", async () => {
    await open({ phase: "recording", call_id: "call_live" });
    bridge!.store.setState((state) => {
      const { callWindow: _callWindow, ...whole } = state.whole;
      return { ...state, whole };
    });
    html();
    const captureEffect = effects.find((effect) => effect.toString().includes("captureAnnouncements"));
    expect(captureEffect).toBeDefined();
    expect(captureEffect!).not.toThrow();
  });

  it("shows a person chip per participant from the transcript", async () => {
    await open();
    await bridge!.subscribe("transcript_subscribe", live);
    const page = html();
    expect(page).toContain("You");
    expect(page).toContain("Anna K.");
    expect(page).toContain("Speaker 3");
  });

  it("shows each confirmed language once in the dedicated header", async () => {
    await open();
    const source = fake.world.transcripts.find((transcript) => transcript.call_id === live.call_id)!;
    const [first, second, third] = source.segments;
    const [guess] = source.hypotheses;
    source.segments = [{ ...first!, lang: "ru" }, { ...second!, lang: "en" }, { ...third!, lang: "ru" }];
    source.hypotheses = [{ ...guess!, lang: "de" }];
    await bridge!.subscribe("transcript_subscribe", live);
    const header = find(tree(), (p) => p["data-region"] === "CS-R1");
    const tags = renderToString(header).match(/data-variant="call"[^>]*aria-label="[^"]+"/g) ?? [];
    expect(tags.map((tag) => tag.match(/aria-label="([^"]+)"/)?.[1])).toEqual(["Russian", "English"]);
  });

  // cpt-noter-algo-ui-call-window-layout-content (#1162, #1163): the latency line only while Show latency is on; Text size scales the text.
  it("draws the latency line while Show latency is on and scales the text by Text size", async () => {
    await open();
    await bridge!.subscribe("transcript_subscribe", live);
    expect(html()).not.toContain("latency-line");
    expect(html()).toContain("--cw-text:1");
    await bridge!.close();
    await open();
    // Settings › Call Screen & Menu Bar changed: the call window hears it as window:call
    Object.assign(fake.world.settings.call_screen, { show_latency: true, text_size_pct: 150 });
    await fake.invoke("window_call_state", {});
    fake.publish("window:call");
    await bridge!.subscribe("transcript_subscribe", live);
    const page = html();
    expect(page).toContain("Hypothesis 1.4 s · confirmed 3.1 s");
    expect(page).toContain("--cw-text:1.5");
  });

  it("wires the live speaker chip to its first transcript line", async () => {
    await open({ phase: "recording", call_id: "call_live" });
    await bridge!.subscribe("transcript_subscribe", live);
    const chip = find(tree(), (props, type) => type === PersonChip && (props.speaker as { id: string }).id === "spk_3").props as {
      speaker: { id: string };
      onRename: (anchor: HTMLElement) => void;
    };
    expect(chip.speaker.id).toBe("spk_3");
    expect(() => chip.onRename({} as HTMLElement)).not.toThrow();
  });

  it("cpt-noter-seq-call-screen-name-speaker: the floating live transcript sends rename feedback to the status strip", async () => {
    await open({}, { layout: "floating" });
    const log = find(tree(), (_props, type) => type === TranscriptLog).props as Pick<TranscriptLogProps, "variant" | "onNamed">;
    expect(log.variant).toBe("live");
    const text = "Speaker 3 named Anna K.";
    log.onNamed!(text, "change_rename");
    expect(stateWrites).toContainEqual({ variant: "notice", text });
  });

  it("draws the floating layout and the collapsed strip, Paused 3 min while paused", async () => {
    await open({}, { layout: "floating" });
    let page = html();
    for (const r of ["FP-R1", "FP-R5", "FP-R6"]) expect(page).toContain(`data-region="${r}"`);
    expect(page).toContain('aria-label="Move to Display 2"');
    await bridge!.close();
    await open({ phase: "paused", pause: { since: Date.now() - 3 * MIN, remind_at: null } }, { layout: "floating", collapsed: true });
    page = html();
    expect(page).toContain('data-region="FP-C1"');
    expect(page).not.toContain('data-region="FP-C2"');
    expect(page).toContain("Paused 3 min");
    (find(tree(), (_p, type) => type === CollapsedCallStrip).props.onExpand as () => void)();
    await settle();
    expect(args("window_set_collapsed")).toEqual([{ collapsed: false }]);
  });

  it("stops the paused recording directly from the collapsed strip and opens the closing controls", async () => {
    await open({ phase: "paused" }, { layout: "floating", collapsed: true });
    const collapsed = find(tree(), (_p, type) => type === CollapsedCallStrip);
    await (collapsed.props.onStop as () => Promise<void>)();
    await settle();
    expect(args("capture_stop")).toEqual([live]);
    expect(args("window_set_collapsed")).toEqual([{ collapsed: false }]);
    expect(html()).toContain("Continue Recording");
  });

  it("maps degraded states to banners in CS-R3 and runs their fixes", async () => {
    const slack: DegradedState = { type: "second_audio_source", call_id: "call_live", app_name: "Slack", bundle_id: "com.tinyspeck.slackmacgap", since: 1 };
    await open({}, {}, [slack, { type: "system_audio_silent", call_id: "call_live", since: 1, confidence: 0.9 }, { type: "disk_low", free_mb: 2000 }]);
    expect(html()).toContain('data-region="CS-R3"');
    expect(html()).toContain("Recording · mic only");
    const banners = find(tree(), (_p, type) => type === BannerSlot).props.banners as { actions: { label: string; onAction: () => void }[] }[];
    for (const b of banners) for (const a of b.actions) a.onAction();
    await settle();
    expect(args("capture_exclude_source")).toEqual([{ ...live, bundle_id: slack.bundle_id }]);
    expect(args("capture_keep_source")).toEqual([{ ...live, bundle_id: slack.bundle_id }]);
    expect(args("open_external")).toEqual([{ target: { type: "system_settings", permission: "system_audio" } }]);
    expect(args("window_navigate")).toEqual([{ target: { type: "delete_old_audio" } }]);
  });

  it("replaces Pause and Stop with Try Again after the engine stopped, which resumes the same call", async () => {
    await open({ phase: "failed" }, {}, [{ type: "capture_failed", call_id: "call_live", since: 1 }]);
    expect(html()).toContain("Not recording · engine stopped");
    strip().onRetry();
    await settle();
    expect(args("capture_resume_interrupted")).toEqual([live]);
  });

  it("sends the capture controls with wanted state", async () => {
    await open();
    const s = strip();
    s.onPause(true);
    s.onStop();
    s.onMark();
    await settle();
    expect(args("capture_set_paused")).toEqual([{ ...live, paused: true }]);
    expect(args("capture_stop")).toEqual([live]);
    expect(args("capture_mark_moment")).toEqual([live]);
    fake.failNext("capture_mark_moment", "internal");
    stateWrites.length = 0;
    strip().onMark();
    await settle();
    expect(bridge!.store.getState().commands.capture_mark_moment).toMatchObject({ state: "ERROR", error: { code: "internal", tryAgain: true } });
    expect(stateWrites.filter((value) => typeof value === "string" && value.startsWith("Marked "))).toEqual([]);
  });

  it("offers the header controls: sensitive, Open in Noter, layout, presenting", async () => {
    await open();
    const item = more();
    item("Make This Call Sensitive").onSelect!();
    item("Open in Noter").onSelect!();
    item("Use Floating Panel").onSelect!();
    icon("Hide Noter for Presenting").onAction();
    await settle();
    expect(args("capture_set_sensitive")).toEqual([{ ...live, sensitive: true }]);
    expect(args("window_navigate")).toEqual([{ target: { type: "call_page", call_id: "call_live", tab: "summary" } }]);
    expect(args("window_set_call_layout")).toEqual([{ preference: "floating" }]);
    expect(args("app_set_hidden_for_presenting")).toEqual([{ hidden: true }]);
    expect(icon("Hide Noter for Presenting").help).toBe("Hide Noter for Presenting (⌃⌥⌘0)");
  });

  it("offers Move to Display 2, Collapse and Hide in the floating header, and the share warning once", async () => {
    await open({}, { layout: "floating", show_share_warning: true });
    expect(html()).toContain("Hidden from window shares only. Before sharing your whole screen, press ⌃⌥⌘0.");
    // the fake answers at once, so every handler is taken from one render
    const item = more()("Open Call Screen on Display 2");
    const [move, collapse, hide] = [icon("Move to Display 2"), icon("Collapse Panel"), icon("Hide")];
    const header = find(tree(), (p) => p["data-region"] === "FP-R1");
    const gotIt = (find(tree(), (_p, type) => type === InlineBanner).props as unknown as { banner: { actions: { onAction: () => void }[] } }).banner.actions[0]!;
    move.onAction();
    item.onSelect!();
    collapse.onAction();
    hide.onAction();
    (header.props.onDoubleClick as (e: unknown) => void)({ target: { closest: () => null } });
    (header.props.onDoubleClick as (e: unknown) => void)({ target: { closest: () => ({}) } }); // on a button: no collapse
    gotIt.onAction();
    await settle();
    expect(args("window_set_call_layout")).toEqual([{ preference: "auto" }, { preference: "auto" }]);
    expect(args("window_set_collapsed")).toEqual([{ collapsed: true }, { collapsed: true }]);
    expect(args("window_hide_call")).toEqual([{}]);
    expect(args("window_share_warning_seen")).toEqual([{}]);
  });

  it("moves Move to Display 2, Collapse and the shield into More when the floating title can't keep 8 em (#1186)", async () => {
    fold.forced = 3;
    await open({}, { layout: "floating" });
    expect(() => icon("Collapse Panel")).toThrow();
    expect(() => icon("Move to Display 2")).toThrow();
    expect(more()("Open Call Screen on Display 2")).toBeDefined();
    more()("Collapse Panel").onSelect!();
    await settle();
    expect(args("window_set_collapsed")).toEqual([{ collapsed: true }]);
  });

  it("answers the call-ended notice, holds it, and shows the countdown", async () => {
    await open({ notice: { type: "call_ended", stops_at: Date.now() + 10_000 } });
    expect(html()).toContain('data-region="CS-R0"');
    expect(html()).toMatch(/Stopping in (9|10) s\./);
    const on = notice().on;
    on.hold(true);
    on.keepRecording();
    on.stopNow();
    await settle();
    expect(args("capture_hold_notice")).toEqual([{ ...live, held: true }]);
    expect(args("capture_answer_call_end")).toEqual([
      { ...live, choice: "keep_recording" },
      { ...live, choice: "stop_now" },
    ]);
  });

  it("answers the new-meeting notice and the nothing-heard notice", async () => {
    await open({ notice: { type: "new_meeting", event: { id: "evt", title: "1:1 with Anna K.", starts_at: 0, ends_at: 1 } as never, app_name: "Microsoft Teams", detected_at: Date.now(), expires_at: Date.now() + MIN, default_choice: "start_as_new_call" } });
    expect(html()).toContain("A new meeting may have started: 1:1 with Anna K.");
    const on = notice().on;
    on.keepInCall();
    await on.startNewCall();
    await settle();
    expect(args("capture_answer_new_meeting")).toEqual([
      { ...live, choice: "keep_in_this_call" },
      { ...live, choice: "start_as_new_call" },
    ]);
    await bridge!.close();
    await open({ notice: { type: "nothing_heard", since: Date.now() - 5 * MIN } });
    expect(html()).toContain("Nothing heard yet");
    const heard = notice().on;
    heard.keepNothingHeard();
    heard.discard();
    await settle();
    expect(args("capture_keep_recording")).toEqual([live]);
    expect(args("capture_discard")).toEqual([live]);
  });

  it("keeps the notice drawn in a hidden window, for when it shows again", async () => {
    await open({ notice: { type: "call_ended", stops_at: Date.now() + 10_000 } }, { visible: false });
    expect(html()).toContain('data-region="CS-R0"');
  });

  it("shows the closing state after a stop: Continue Recording, Open in Noter, Close", async () => {
    await open({ phase: "stopped", continue_until: Date.now() + 5 * MIN });
    const page = html();
    expect(page).toContain("Saved · 23 min · Summary in about 2 minutes");
    expect(page).toContain("The panel closes in 10 s.");
    expect(page).toContain('data-state="closing"');
    const c = find(tree(), (_p, type) => type === ClosingState).props as unknown as { onContinue: () => void; onOpen: () => void; onClose: () => void };
    c.onOpen();
    c.onClose();
    fake.failNext("capture_continue", "continue_window_closed");
    c.onContinue();
    await settle();
    expect(args("capture_continue")).toEqual([live]);
    expect(bridge!.store.getState().commands.capture_continue).toMatchObject({ state: "ERROR", error: { code: "continue_window_closed", tryAgain: false } });
    expect(fake.world.app.capture.phase).toBe("stopped");
    expect(args("capture_start")).toEqual([]);
    expect(args("window_hide_call")).toEqual([{}]);
  });

  it("shows the automatic closing state in the floating layout", async () => {
    await open({ phase: "stopped", notice: { type: "stopped_automatically", call_id: "call_live" }, continue_until: Date.now() + 5 * MIN }, { layout: "floating" });
    expect(html()).toMatch(/Stopped at \d\d:\d\d · the call had ended · 23 min saved/);
    expect(html()).not.toContain(">Close<");
  });
});
