import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CallDetection, CaptureNotice, CaptureState, ModelBundle } from "../../core/bindings";
import { activeRefusal, chooseView, countdownSeconds, createPromptTimer, INITIAL_LOCAL, isBrowser, isHeld, localReduce, meetingTitle, modelPercent, sourceLine, viewKey, type PromptInput } from "./logic";

const detection = (o: Partial<CallDetection> = {}): CallDetection => ({ id: "det_teams", app_name: "Microsoft Teams", bundle_id: "com.microsoft.teams2", matched_event: null, detected_at: 0, prompt_until: 30_000, blocked: null, ...o });
const capture = (o: Partial<CaptureState> = {}): CaptureState => ({ phase: "idle", notice: null, ...o }) as CaptureState;
const input = (o: Partial<PromptInput> = {}): PromptInput => ({ setupComplete: true, presenting: false, capture: capture(), detection: detection(), dontAsk: false, systemAudioOff: false, refused: null, held: false, ...o });
const live = (notice: CaptureNotice) => input({ capture: capture({ phase: "recording", notice }), detection: null });

describe("chooseView (cpt-noter-algo-ui-record-prompt-variant)", () => {
  it("is Default with Record as Sensitive for a detected call", () => {
    expect(chooseView(input())).toEqual({ variant: "default", state: "default" });
  });
  it("is the Disk full or Speech model variant, disabled, when the core says a start would be refused", () => {
    expect(chooseView(input({ detection: detection({ blocked: "disk_full" }) }))).toEqual({ variant: "disk-full", state: "disabled" });
    expect(chooseView(input({ detection: detection({ blocked: "model_missing" }) }))).toEqual({ variant: "model-missing", state: "disabled" });
  });
  it("switches to the reason of a start the core refused, and back when it clears", () => {
    expect(chooseView(input({ refused: "disk_full" }))?.variant).toBe("disk-full");
    expect(chooseView(input({ refused: null }))?.variant).toBe("default");
  });
  it("is System audio off, still enabled, when system audio access is off", () => {
    expect(chooseView(input({ systemAudioOff: true }))).toEqual({ variant: "system-audio-off", state: "default" });
  });
  it("a refusal outranks the audio warning", () => {
    expect(chooseView(input({ systemAudioOff: true, detection: detection({ blocked: "model_missing" }) }))?.variant).toBe("model-missing");
  });
  it("is Not a call while the inline confirmation is open", () => {
    expect(chooseView(input({ dontAsk: true }))).toEqual({ variant: "default", state: "not-a-call" });
  });
  it("is the call-ended variant, running, paused while held or while the core holds the notice", () => {
    const n: CaptureNotice = { type: "call_ended", stops_at: 10_000 };
    expect(chooseView(live(n))).toEqual({ variant: "call-ended", state: "countdown-running" });
    expect(chooseView({ ...live(n), held: true })).toEqual({ variant: "call-ended", state: "countdown-paused" });
    expect(chooseView(live({ type: "call_ended", stops_at: null }))?.state).toBe("countdown-paused");
    expect(chooseView(live({ type: "call_seems_ended", stops_at: 1 }))?.variant).toBe("call-ended");
  });
  it("is the new-meeting variant for a new meeting", () => {
    const n: CaptureNotice = { type: "new_meeting", event: null, app_name: "Teams", detected_at: 0, expires_at: 60_000, default_choice: "start_as_new_call" };
    expect(chooseView(live(n))).toEqual({ variant: "new-meeting", state: "default" });
  });
  it("draws nothing without a detection or notice, while recording, before setup is complete, or while hidden for presenting", () => {
    expect(chooseView(input({ detection: null }))).toBeNull();
    expect(chooseView(input({ capture: capture({ phase: "recording" }) }))).toBeNull();
    expect(chooseView(input({ setupComplete: false }))).toBeNull();
    expect(chooseView(input({ presenting: true }))).toBeNull();
    expect(chooseView({ ...live({ type: "call_ended", stops_at: 1 }), presenting: true })).toBeNull();
    expect(chooseView(live({ type: "nothing_heard", since: 0 }))).toBeNull(); // the call window's notice, not the panel's
  });
});

describe("the prompt's texts", () => {
  it("names the matched event, else the app using the microphone", () => {
    expect(sourceLine(detection())).toBe("Microsoft Teams is using the microphone");
    expect(sourceLine(detection({ matched_event: { id: "e", title: "Planning", starts_at: 0, ends_at: 1 } }))).toBe("Planning");
  });
  it("reads the speech model's progress as a whole percent, null once it is in", () => {
    const b = (state: ModelBundle["state"], done: number): ModelBundle => ({ name: "m", size_mb: 1000, done_mb: done, state, required_for_capture: true });
    expect(modelPercent(b("downloading", 620))).toBe(62);
    expect(modelPercent(b("ready", 1000))).toBeNull();
    expect(modelPercent(undefined)).toBeNull();
  });
  it("counts the seconds left, never below 0", () => {
    expect(countdownSeconds(10_000, 0)).toBe(10);
    expect(countdownSeconds(10_000, 9_001)).toBe(1);
    expect(countdownSeconds(10_000, 20_000)).toBe(0);
    expect(countdownSeconds(null, 0)).toBeNull();
  });
});

describe("createPromptTimer (15 s, paused while the pointer or focus is on the panel)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once after 15 s", () => {
    const done = vi.fn();
    createPromptTimer(15_000, done);
    vi.advanceTimersByTime(14_999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.advanceTimersByTime(60_000);
    expect(done).toHaveBeenCalledOnce();
  });
  it("does not run while paused and continues with what was left", () => {
    const done = vi.fn();
    const t = createPromptTimer(15_000, done);
    vi.advanceTimersByTime(5_000);
    t.pause();
    vi.advanceTimersByTime(60_000);
    expect(done).not.toHaveBeenCalled();
    t.resume();
    vi.advanceTimersByTime(9_999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledOnce();
  });
  it("pausing twice or resuming twice changes nothing, and stop cancels it", () => {
    const done = vi.fn();
    const t = createPromptTimer(1_000, done);
    t.pause();
    t.pause();
    t.resume();
    t.resume();
    t.stop();
    vi.advanceTimersByTime(5_000);
    expect(done).not.toHaveBeenCalled();
  });
});

describe("the panel's own state (localReduce)", () => {
  const run = (...events: Parameters<typeof localReduce>[1][]) => events.reduce(localReduce, INITIAL_LOCAL);
  it("keeps the same state object when the pointer or focus does not change, so React skips the render", () => {
    const held = run({ type: "pointer", on: true }, { type: "focus", on: true });
    expect(localReduce(held, { type: "pointer", on: true })).toBe(held);
    expect(localReduce(held, { type: "focus", on: true })).toBe(held);
    expect(localReduce(INITIAL_LOCAL, { type: "pointer", on: false })).toBe(INITIAL_LOCAL);
  });

  it("opens the Don't Ask confirmation and Back returns", () => {
    expect(run({ type: "dont-ask" }).dontAsk).toBe(true);
    expect(run({ type: "dont-ask" }, { type: "back" }).dontAsk).toBe(false);
  });
  it("closes in two steps: closing for the 200 ms fade, then gone", () => {
    const closing = run({ type: "closing", key: "det:1" });
    expect(closing.closing).toBe("det:1");
    expect(localReduce(closing, { type: "gone" })).toMatchObject({ closing: null, gone: "det:1" });
  });
  it("remembers who is holding it and forgets everything when the prompt is over", () => {
    expect(isHeld(run({ type: "pointer", on: true }))).toBe(true);
    expect(isHeld(run({ type: "focus", on: true }))).toBe(true);
    expect(isHeld(run({ type: "pointer", on: true }, { type: "focus", on: true }, { type: "pointer", on: false }))).toBe(true); // focus still holds it
    expect(isHeld(run({ type: "pointer", on: true }, { type: "pointer", on: false }))).toBe(false);
    expect(run({ type: "dont-ask" }, { type: "closing", key: "k" }, { type: "gone" }, { type: "reset" })).toEqual(INITIAL_LOCAL);
  });
  it("a refusal shows its reason only while the world it was refused in has not changed", () => {
    const s = run({ type: "refused", reason: "disk_full", freeMb: 420, at: "env-1" });
    expect(activeRefusal(s, "env-1")).toEqual({ reason: "disk_full", freeMb: 420 });
    expect(activeRefusal(s, "env-2")).toBeNull(); // old audio deleted: the reason clears
    expect(activeRefusal(INITIAL_LOCAL, "env-1")).toBeNull();
  });
});

describe("what identifies a prompt, and the browsers", () => {
  it("is the detection, else the notice, else nothing", () => {
    expect(viewKey(detection(), null)).toBe("det:det_teams");
    expect(viewKey(null, { type: "call_ended", stops_at: 1 })).toBe("notice:call_ended");
    expect(viewKey(null, null)).toBeNull();
  });
  it("knows a browser by its bundle id, so the Don't Ask line is the browser's", () => {
    expect(isBrowser("com.apple.Safari")).toBe(true);
    expect(isBrowser("com.google.Chrome")).toBe(true);
    expect(isBrowser("com.microsoft.teams2")).toBe(false);
  });
});

describe("meetingTitle", () => {
  const meeting = (o: Partial<Extract<CaptureNotice, { type: "new_meeting" }>>): CaptureNotice => ({ type: "new_meeting", event: null, app_name: null, detected_at: 0, expires_at: 1, default_choice: "start_as_new_call", ...o });
  it("is the event's title, else the app, else empty", () => {
    expect(meetingTitle(meeting({ event: { id: "e", title: "1:1 with Anna K.", starts_at: 0, ends_at: 1 } }))).toBe("1:1 with Anna K.");
    expect(meetingTitle(meeting({ app_name: "Zoom" }))).toBe("Zoom");
    expect(meetingTitle(meeting({}))).toBe("");
    expect(meetingTitle(null)).toBe("");
    expect(meetingTitle({ type: "call_ended", stops_at: 1 })).toBe("");
  });
});
