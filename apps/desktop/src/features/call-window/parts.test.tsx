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
import { CallStatusStrip, CollapsedCallStrip, MoreMenu, PersonChip, RecordingIndicator, type StripProps } from "./strip";

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

describe("PersonChip (cpt-noter-component-ui-person-chip)", () => {
  it("reads You, a person's short name, Speaker n and Guest (your side)", () => {
    expect(renderToString(<PersonChip speaker={speaker({ type: "you" })} />)).toContain('data-variant="you"');
    const anna = renderToString(<PersonChip speaker={speaker({ type: "person", person: { id: "p", display_name: "Anna Kuznetsova", short_name: "Anna K.", initials: "AK", is_you: false } as never })} />);
    expect(anna).toContain("Anna K.");
    expect(anna).toContain('title="Anna Kuznetsova"');
    expect(renderToString(<PersonChip speaker={speaker({ type: "unnamed", n: 3 })} />)).toContain("Speaker 3");
    expect(renderToString(<PersonChip speaker={speaker({ type: "guest_your_side" })} />)).toContain("Guest (your side)");
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

  it("compact: Mark Moment and a ⋯ menu with Pause or Resume, Stop Recording, or Try Again", () => {
    const p = stripProps({ variant: "compact", feedback: { text: "Saved", variant: "blind" } });
    const tree = rendered(CallStatusStrip, p);
    expect(renderToString(<CallStatusStrip {...p} />)).toContain("Saved");
    const items = byType(tree, MoreMenu).items as { label: string; onSelect: () => void }[];
    items.forEach((i) => i.onSelect());
    expect(items.map((i) => i.label)).toEqual(["Pause", "Stop Recording"]);
    expect(p.onPause).toHaveBeenCalledWith(true);
    expect(p.onStop).toHaveBeenCalled();
    const paused = byType(rendered(CallStatusStrip, stripProps({ variant: "compact", status: "paused" })), MoreMenu).items as { label: string }[];
    expect(paused[0]!.label).toBe("Resume");
    const failed = stripProps({ variant: "compact", status: "not-recording" });
    const retry = byType(rendered(CallStatusStrip, failed), MoreMenu).items as { label: string; onSelect: () => void }[];
    retry[0]!.onSelect();
    expect(failed.onRetry).toHaveBeenCalled();
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
    expect(renderToString(<CollapsedCallStrip status="recording" clock="00:21:08" pausedFor={null} mode={mode} onExpand={onExpand} />)).toContain("00:21:08");
    expect(renderToString(<CollapsedCallStrip status="paused" clock="00:21:08" pausedFor={3} mode={mode} onExpand={onExpand} />)).toContain("Paused 3 min");
    const tree = rendered(CollapsedCallStrip, { status: "recording", clock: "", pausedFor: null, mode, onExpand });
    const key = tree.props.onKeyDown as (e: unknown) => void;
    const strip = {};
    const e = (k: string, target: unknown = strip) => ({ key: k, target, currentTarget: strip, preventDefault: vi.fn() });
    key(e("Enter"));
    key(e(" "));
    key(e("a"));
    key(e("Enter", {}));
    button(tree, "Expand Panel").onAction();
    expect(onExpand).toHaveBeenCalledTimes(3);
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
    const end = subscribeWhile(bridge, true, "transcript_subscribe", { call_id: "c" })!;
    expect(bridge.subscribe).toHaveBeenCalledWith("transcript_subscribe", { call_id: "c" });
    end();
    expect(bridge.unsubscribe).toHaveBeenCalledWith("transcript_subscribe");
  });
});
