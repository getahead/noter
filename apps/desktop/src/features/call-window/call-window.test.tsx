import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "../../app/App";
import { createBridge, type Bridge } from "../../app/bridge/bridge";
import type { CallWindowState, CaptureState, CommandName, DegradedState, EventName, Transport } from "../../core/bindings";
import { FakeCore } from "../../core/fake/fake-core";
import { BannerSlot, InlineBanner } from "../../ui/feedback/inline-banner";
import { IconButton } from "../../ui/primitives/icon-button";
import type { MenuItem } from "../../ui/primitives/menu";
import { find, rendered } from "../../ui/testing";
import { CallWindow } from "./call-window";
import { CaptureNotice, ClosingState, type NoticeHandlers } from "./notice";
import { CallStatusStrip, CollapsedCallStrip, MoreMenu, type StripProps } from "./strip";

let bridge: Bridge | null = null;
let fake: FakeCore;
const sent: { cmd: CommandName; args: unknown }[] = [];
afterEach(async () => {
  await bridge?.close();
  bridge = null;
  sent.length = 0;
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

  it("renders nothing before the window state is read, or once the call closed", async () => {
    fake = new FakeCore({ window: "call-screen" });
    bridge = createBridge("call-screen", fake);
    await bridge.open();
    expect(html()).toBe("");
    await bridge.close();
    await open({ phase: "idle", call_id: null });
    expect(html()).toBe("");
  });

  it("shows a person chip per participant from the transcript", async () => {
    await open();
    await bridge!.subscribe("transcript_subscribe", live);
    const page = html();
    expect(page).toContain("You");
    expect(page).toContain("Anna K.");
    expect(page).toContain("Speaker 3");
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
    expect(args("window_navigate")).toEqual([{ target: { type: "settings", pane: "maintenance" } }]);
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
    strip().onMark();
    await settle();
    expect(strip().keys).toEqual({ mark: "⌃⌥⌘M", pause: "⌃⌥⌘P", stop: "⌃⌥⌘R" });
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
    expect(args("window_hide_call")).toEqual([{}]);
  });

  it("shows the automatic closing state in the floating layout", async () => {
    await open({ phase: "stopped", notice: { type: "stopped_automatically", call_id: "call_live" }, continue_until: Date.now() + 5 * MIN }, { layout: "floating" });
    expect(html()).toMatch(/Stopped at \d\d:\d\d · the call had ended · 23 min saved/);
    expect(html()).not.toContain(">Close<");
  });
});
