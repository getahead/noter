import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Bridge } from "../../app/bridge/bridge";
import type { SpeakerView } from "../../core/bindings";
import { IconButton } from "../../ui/primitives/icon-button";
import { PushButton } from "../../ui/primitives/push-button";
import { find, rendered } from "../../ui/testing";
import type { ModeView } from "../shell/mode-indicator";
import { subscribeWhile } from "./call-window";
import { CaptureNotice, ClosingState, type CaptureNoticeProps } from "./notice";
import { CallStatusStrip, CollapsedCallStrip, LatencyLine, MoreMenu, PersonChip, RecordingIndicator, type StripProps } from "./strip";

const mode: ModeView = { state: "CLOUD_REDACTED", warning: false } as ModeView;
const speaker = (label: SpeakerView["label"]): SpeakerView => ({ id: "s", call_id: "c", label, channel: "mic", segment_count: 1, talk_ms: null, sample: null, suggestion: null, named_by: null });
type Props = Record<string, unknown>;
const byType = (tree: ReactElement, type: unknown) => find(tree, (_p, t) => t === type).props as Props;
const button = (tree: ReactElement, label: string) => find(tree, (p, t) => (t === PushButton || t === IconButton) && p.label === label).props as unknown as { onAction: () => void };

describe("RecordingIndicator (cpt-noter-component-ui-recording-indicator)", () => {
  it("gives the dot its word as the image label, and shows the word where there is no dot", () => {
    expect(renderToString(<RecordingIndicator variant="dot" status="recording" clock="00:21:08" />)).toContain('aria-label="Recording"');
    expect(renderToString(<RecordingIndicator variant="dot" status="not-recording" />)).toContain(">Not recording<");
    expect(renderToString(<RecordingIndicator variant="dot-text" status="mic-only" clock="00:01:00" />)).toContain("Recording · mic only");
    const stopped = renderToString(<RecordingIndicator variant="dot-text" status="stopped" clock="00:01:00" />);
    expect(stopped).toContain("Stopped");
    expect(stopped).not.toContain("00:01:00");
    expect(renderToString(<RecordingIndicator variant="dot" status="paused" />)).toContain("is-paused");
  });
});

describe("LatencyLine (cpt-noter-algo-ui-call-window-layout-content, #1162)", () => {
  it("reads both delays in seconds, a dash before the first of a kind, and warns with its icon when either is over budget", () => {
    expect(renderToString(<LatencyLine />)).toBe("");
    const calm = renderToString(<LatencyLine hypothesis={{ ms: 1400, budget_ms: 2000 }} confirmed={{ ms: 3140, budget_ms: 4000 }} />);
    expect(calm).toContain("Hypothesis 1.4 s · confirmed 3.1 s");
    expect(calm).not.toContain("is-over");
    expect(renderToString(<LatencyLine hypothesis={{ ms: 900, budget_ms: 2000 }} />)).toContain("Hypothesis 0.9 s · confirmed – s");
    const late = renderToString(<LatencyLine hypothesis={{ ms: 1200, budget_ms: 2000 }} confirmed={{ ms: 4600, budget_ms: 4000 }} />);
    expect(late).toContain("is-over");
    expect(late).toContain('aria-label="Over budget"');
  });
});

describe("PersonChip (cpt-noter-component-ui-person-chip)", () => {
  it("reads You, a person's short name, Speaker n and Guest (your side)", () => {
    expect(renderToString(<PersonChip speaker={speaker({ type: "you" })} />)).toContain('data-variant="you"');
    const anna = renderToString(<PersonChip speaker={speaker({ type: "person", person: { id: "p", display_name: "Anna Kuznetsova", short_name: "Anna K.", initials: "AK", is_you: false } as never })} />);
    expect(anna).toContain("Anna K.");
    expect(anna).toContain('title="Anna Kuznetsova"');
    expect(renderToString(<PersonChip speaker={speaker({ type: "unnamed", n: 3 })} />)).toContain("Speaker 3");
    expect(renderToString(<PersonChip speaker={speaker({ type: "guest_your_side" })} />)).toContain("Guest (your side)");
  });
  it("makes a renameable participant chip an accessible button", () => {
    const onRename = vi.fn();
    const tree = rendered(PersonChip, { speaker: speaker({ type: "unnamed", n: 3 }), onRename });
    // the chip is the shared primitive: the rename action and its VoiceOver name are its props
    const chip = find(tree, (p) => p.label === "Rename Speaker 3").props as { onAction: (anchor: HTMLElement) => void };
    const anchor = {} as HTMLElement;
    chip.onAction(anchor);
    expect(onRename).toHaveBeenCalledWith(anchor);
  });
});

const stripProps = (patch: Partial<StripProps> = {}): StripProps => ({
  variant: "dedicated",
  status: "recording",
  clock: "00:21:08",
  mode,
  keys: { mark: "⌃⌥⌘M", pause: "⌃⌥⌘P", stop: "⌃⌥⌘R" },
  marked: null,
  busy: { pause: false, stop: false, mark: false, retry: false },
  feedback: null,
  onFeedbackExpire: vi.fn(),
  onMark: vi.fn(),
  onPause: vi.fn(),
  onStop: vi.fn(),
  onRetry: vi.fn(),
  ...patch,
});

describe("CallStatusStrip (cpt-noter-component-ui-call-status-strip)", () => {
  it("dedicated: Mark Moment, Pause, then Stop Recording; Resume is primary while paused", () => {
    const p = stripProps();
    const tree = rendered(CallStatusStrip, p);
    button(tree, "Mark Moment").onAction();
    button(tree, "Pause").onAction();
    button(tree, "Stop Recording").onAction();
    expect(p.onMark).toHaveBeenCalled();
    expect(p.onPause).toHaveBeenCalledWith(true);
    expect(p.onStop).toHaveBeenCalled();
    const paused = stripProps({ status: "paused", marked: "Marked 00:21:08", feedback: { text: "Something went wrong", variant: "notice" } });
    const html = renderToString(<CallStatusStrip {...paused} />);
    expect(html).toContain("Resume");
    expect(html).toContain("Marked 00:21:08");
    expect(html).toContain("Something went wrong");
    button(rendered(CallStatusStrip, paused), "Resume").onAction();
    expect(paused.onPause).toHaveBeenCalledWith(false);
  });

  it("dedicated: Try Again after the engine stopped, no buttons once stopped", () => {
    const p = stripProps({ status: "not-recording" });
    button(rendered(CallStatusStrip, p), "Try Again").onAction();
    expect(p.onRetry).toHaveBeenCalled();
    const stopped = renderToString(<CallStatusStrip {...stripProps({ status: "stopped" })} />);
    expect(stopped).not.toContain("Mark Moment");
    expect(stopped).toContain("Stopped");
  });

  // cpt-noter-seq-menu-bar-control-recording, #1042 (owner, 21 Nov): nothing can be marked while paused, as in the menu bar
  it("dims Mark Moment while paused, in both variants", () => {
    const disabled = (variant: "dedicated" | "compact", status: "recording" | "paused") =>
      (button(rendered(CallStatusStrip, stripProps({ variant, status })), "Mark Moment") as unknown as { disabled?: boolean }).disabled ?? false;
    for (const variant of ["dedicated", "compact"] as const) {
      expect(disabled(variant, "recording")).toBe(false);
      expect(disabled(variant, "paused")).toBe(true);
    }
  });

  it("compact: Stop Recording is a direct control and ⋯ holds Pause or Resume", () => {
    const p = stripProps({ variant: "compact", feedback: { text: "Saved", variant: "blind" } });
    const tree = rendered(CallStatusStrip, p);
    expect(renderToString(<CallStatusStrip {...p} />)).toContain("Saved");
    const items = byType(tree, MoreMenu).items as { label: string; onSelect: () => void }[];
    items.forEach((i) => i.onSelect());
    expect(items.map((i) => i.label)).toEqual(["Pause"]);
    button(tree, "Stop Recording").onAction();
    expect(p.onPause).toHaveBeenCalledWith(true);
    expect(p.onStop).toHaveBeenCalled();
    const paused = stripProps({ variant: "compact", status: "paused", busy: { ...p.busy, stop: true } });
    expect(byType(rendered(CallStatusStrip, paused), MoreMenu).items).toMatchObject([{ label: "Resume" }]);
    const pausedHtml = renderToString(<CallStatusStrip {...paused} />);
    expect(pausedHtml).toMatch(/aria-busy="true"[^>]*>.*?Stop Recording/);
    const failed = stripProps({ variant: "compact", status: "not-recording" });
    const retry = byType(rendered(CallStatusStrip, failed), MoreMenu).items as { label: string; onSelect: () => void }[];
    retry[0]!.onSelect();
    expect(failed.onRetry).toHaveBeenCalled();
    expect(renderToString(<CallStatusStrip {...failed} />)).not.toContain("Stop Recording");
    expect(renderToString(<CallStatusStrip {...stripProps({ variant: "compact", status: "stopped" })} />)).not.toContain("Mark Moment");
  });
});

describe("MoreMenu", () => {
  it("is a pull-down icon button named More", () => {
    const tree = rendered(MoreMenu, { items: [{ label: "Open in Noter" }] });
    const b = find(tree, (_p, t) => t === IconButton).props as unknown as { label: string; onAction: () => void };
    expect(b.label).toBe("More");
    b.onAction(); // opens under the button (a state change of the rendered component)
  });
});

describe("CollapsedCallStrip (cpt-noter-component-ui-collapsed-call-strip)", () => {
  it("shows the dot and clock, or Paused N min, and expands on Return, Space or Expand Panel", () => {
    const onExpand = vi.fn();
    const onStop = vi.fn();
    const props = { status: "recording" as const, clock: "00:21:08", pausedFor: null, mode, onExpand, onStop, stopKey: "⌃⌥⌘R", stopping: false };
    expect(renderToString(<CollapsedCallStrip {...props} />)).toContain("00:21:08");
    expect(renderToString(<CollapsedCallStrip {...props} status="paused" pausedFor={3} />)).toContain("Paused 3 min");
    expect(renderToString(<CollapsedCallStrip {...props} status="not-recording" />)).not.toContain("Stop Recording");
    const tree = rendered(CollapsedCallStrip, props);
    const key = tree.props.onKeyDown as (e: unknown) => void;
    const strip = {};
    const e = (k: string, target: unknown = strip) => ({ key: k, target, currentTarget: strip, preventDefault: vi.fn() });
    key(e("Enter"));
    key(e(" "));
    key(e("a"));
    key(e("Enter", {}));
    button(tree, "Expand Panel").onAction();
    expect(onExpand).toHaveBeenCalledTimes(3);
    button(tree, "Stop Recording").onAction();
    expect(onStop).toHaveBeenCalledOnce();
  });
});

const noticeProps = (patch: Partial<CaptureNoticeProps>): CaptureNoticeProps => ({
  notice: { type: "call_ended", stops_at: 1 },
  floating: false,
  seconds: 7,
  detectedAt: "14:30",
  levels: { mic: 3, sys: 0 },
  on: { keepRecording: vi.fn(), stopNow: vi.fn(), hold: vi.fn(), startNewCall: vi.fn(), keepInCall: vi.fn(), keepNothingHeard: vi.fn(), discard: vi.fn() },
  ...patch,
});
/** The notice's frame element, rendered: its pointer and focus handlers hold the countdown. */
const frame = (p: CaptureNoticeProps) => {
  const el = find(rendered(CaptureNotice, p), (_p, t) => typeof t === "function");
  return rendered(el.type as (props: Props) => ReactElement, el.props);
};

describe("CaptureNotice (cpt-noter-component-ui-capture-notice)", () => {
  it("call ended: the countdown, Keep Recording and Stop Now, held while pointed at or focused", () => {
    const p = noticeProps({});
    expect(renderToString(<CaptureNotice {...p} />)).toContain("Stopping in 7 s.");
    expect(renderToString(<CaptureNotice {...p} seconds={null} />)).toContain("Paused while you&#x27;re here");
    // an alert-style group labelled by its title: it never takes focus, so it is no (modal) dialog
    expect(renderToString(<CaptureNotice {...p} />)).toMatch(/role="group"[^>]*aria-label=/);
    expect(renderToString(<CaptureNotice {...p} />)).not.toContain("alertdialog");
    const f = frame(p);
    (f.props.onMouseEnter as () => void)();
    (f.props.onMouseLeave as () => void)();
    (f.props.onFocus as () => void)();
    const inside = {};
    (f.props.onBlur as (e: unknown) => void)({ currentTarget: { contains: (n: unknown) => n === inside }, relatedTarget: inside });
    (f.props.onBlur as (e: unknown) => void)({ currentTarget: { contains: () => false }, relatedTarget: null });
    expect(p.on.hold).toHaveBeenNthCalledWith(1, true);
    expect(p.on.hold).toHaveBeenNthCalledWith(2, false);
    expect(p.on.hold).toHaveBeenCalledTimes(4);
    expect(renderToString(<CaptureNotice {...noticeProps({ notice: { type: "call_seems_ended", stops_at: 1 }, floating: true })} />)).toContain("is-floating");
  });

  it("new meeting: the title, the app line, Start as New Call and Keep in This Call", () => {
    const p = noticeProps({ notice: { type: "new_meeting", event: { id: "e", title: "1:1 with Anna K." } as never, app_name: "Microsoft Teams", detected_at: 1, expires_at: 2, default_choice: "start_as_new_call" } });
    const html = renderToString(<CaptureNotice {...p} />);
    expect(html).toContain("A new meeting may have started: 1:1 with Anna K.");
    expect(html).toContain("Microsoft Teams joined a new meeting at 14:30.");
    const untitled = renderToString(<CaptureNotice {...noticeProps({ notice: { type: "new_meeting", event: null, app_name: null, detected_at: 1, expires_at: 2, default_choice: "start_as_new_call" } })} />);
    expect(untitled).toContain("A new meeting may have started");
    expect(untitled).not.toContain("joined");
  });

  it("nothing heard: the You and Others meters, Discard Recording and Keep Recording", () => {
    const html = renderToString(<CaptureNotice {...noticeProps({ notice: { type: "nothing_heard", since: 1 } })} />);
    for (const s of ["Nothing heard yet", "You", "Others", "Discard Recording", "Keep Recording", 'aria-label="Microphone level"']) expect(html).toContain(s);
  });

  it("leaves stopped_automatically to the closing state", () => {
    expect(renderToString(<CaptureNotice {...noticeProps({ notice: { type: "stopped_automatically", call_id: "c" } })} />)).toBe("");
  });
});

describe("ClosingState (cpt-noter-algo-ui-call-window-closing-state)", () => {
  it("offers Continue Recording while it can, Open in Noter, and Close after a manual stop", () => {
    const on = { onContinue: vi.fn(), onOpen: vi.fn(), onClose: vi.fn() };
    const manual = renderToString(<ClosingState title={{ auto: false, text: "Saved · 48 min · Summary in about 2 minutes" }} floating={false} canContinue continuing={false} {...on} />);
    for (const s of ["Continue Recording", "Open in Noter", "Close", "The panel closes in 10 s."]) expect(manual).toContain(s);
    const auto = renderToString(<ClosingState title={{ auto: true, text: "Stopped at 11:02" }} floating canContinue={false} continuing={false} {...on} />);
    expect(auto).not.toContain(">Continue Recording<");
    expect(auto).not.toContain(">Close<");
  });
});

describe("subscribeWhile", () => {
  it("opens the Channel while on and ends it on cleanup", () => {
    const bridge = { subscribe: vi.fn(async () => {}), unsubscribe: vi.fn(async () => {}) } as unknown as Bridge;
    expect(subscribeWhile(bridge, false, "levels_subscribe", { call_id: "c" })).toBeUndefined();
    const end = subscribeWhile(bridge, true, "levels_subscribe", { call_id: "c" })!;
    expect(bridge.subscribe).toHaveBeenCalledWith("levels_subscribe", { call_id: "c" });
    end();
    expect(bridge.unsubscribe).toHaveBeenCalledWith("levels_subscribe");
  });
});
