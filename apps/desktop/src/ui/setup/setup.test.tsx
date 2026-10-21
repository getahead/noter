import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DisplayInfo } from "../../core/bindings";
import { defaultDisplay } from "../../features/first-run/default-display";
import { applySelfTestEvent, initialSelfTestPanel, runSelfTest, type SelfTestPanel as Panel } from "../../features/first-run/self-test";
import { find, rendered } from "../testing";
import { DisplayPicker, layoutDisplays } from "./display-picker";
import { PermissionCheckRow } from "./permission-check-row";
import { lineParts, SelfTestPanel } from "./self-test-panel";
import { stepLabel, WizardStepper, type StepperEntry } from "./wizard-stepper";

/** Call a handler of an element of a rendered tree, as the browser would. */
const fire = (el: { props: Record<string, unknown> }, name: string, ...args: unknown[]) => (el.props[name] as (...a: unknown[]) => void)(...args);
const entry = (step: StepperEntry["step"], state: StepperEntry["state"], progress?: number): StepperEntry => ({ step, state, progress });

describe("wizard-stepper (cpt-noter-component-ui-wizard-stepper)", () => {
  const steps = [entry("welcome", "done"), entry("models", "running", 64), entry("permissions", "current"), entry("call_display", "skipped"), entry("audio_storage", "error"), entry("assistants", "upcoming")];
  const html = renderToString(<WizardStepper steps={steps} variant="resumed" />);

  it("is the list Setup steps, with the state and aria-current on each step", () => {
    expect(html).toContain('aria-label="Setup steps"');
    expect(html).toContain('data-variant="resumed" data-state="step-3"');
    expect(html).toContain('aria-current="step"');
    for (const s of ["done", "running", "current", "skipped", "error", "upcoming"]) expect(html).toContain(`data-state="${s}"`);
    expect(stepLabel("call_display")).toBe("Call display");
  });

  it("rings the step that runs in the background, and reads a skipped one as Skipped", () => {
    expect(html).toContain('title="Downloading in the background · 64 %"');
    expect(html).toContain("--p:64");
    expect(html).toMatch(/np-sr">Skipped</);
  });

  it("makes done, background, skipped and failed steps clickable, not the current or upcoming ones", () => {
    expect(html.match(/<button/g)).toHaveLength(4);
    const goto = vi.fn();
    const tree = rendered(WizardStepper, { steps, onGoto: goto });
    fire(find(tree, (p) => p.className === "fr-step__btn" && typeof p.onClick === "function"), "onClick");
    expect(goto).toHaveBeenCalledWith("welcome");
    expect(renderToString(<WizardStepper steps={[entry("welcome", "current")]} />)).toContain('data-variant="first-pass"');
  });
});

describe("permission-check-row (cpt-noter-component-ui-permission-check-row)", () => {
  const row = (p: Partial<Parameters<typeof PermissionCheckRow>[0]>) => renderToString(<PermissionCheckRow id="mic" label="Microphone" state="NOT_ASKED" why="Records your side of the call." {...p} />);

  it("asks the microphone with Allow…, system audio never", () => {
    expect(row({})).toContain("Allow…");
    expect(row({})).toContain("Microphone</span><span class=\"fr-perm__word\"> · <!-- -->Not allowed yet");
    expect(row({ id: "sys", state: "MISSING" })).toContain("Open System Settings…");
    expect(row({ id: "sys", state: "MISSING" })).not.toContain("Allow…");
  });

  it("offers Open System Settings… when denied or missing, and nothing while checking or granted", () => {
    expect(row({ state: "DENIED" })).toContain("not allowed");
    expect(row({ state: "DENIED" })).toContain("Open System Settings…");
    expect(row({ state: "CHECKING" })).toContain("Checking…");
    expect(row({ state: "CHECKING" })).not.toContain("<button");
    expect(row({ state: "GRANTED" })).not.toContain("<button");
    expect(row({ state: "GRANTED" })).toContain("Granted");
  });

  it("shows the device, the how-to until granted, and the meter with Hearing you", () => {
    const granted = row({ state: "GRANTED", detail: "MacBook Pro Microphone", howto: "How to allow it", hearing: { level: 6 } });
    expect(granted).toContain("MacBook Pro Microphone");
    expect(granted).not.toContain("How to allow it");
    expect(granted).toContain("Hearing you");
    expect(row({ state: "MISSING", howto: "How to allow it" })).toContain("How to allow it");
  });

  it("hides the reason, the how-to and the meter in the status variant, and asks Continue in the test-only one", () => {
    const status = row({ variant: "status", state: "MISSING", howto: "How to allow it" });
    expect(status).not.toContain("Records your side");
    expect(status).not.toContain("How to allow it");
    expect(row({ variant: "status", state: "GRANTED", hearing: { level: 3 } })).not.toContain("Hearing you");
    expect(row({ variant: "test-only", id: "sys", state: "NOT_ASKED" })).toContain(">Continue<");
  });

  it("runs the owner's handlers", () => {
    const allow = vi.fn();
    const open = vi.fn();
    fire(find(rendered(PermissionCheckRow, { id: "mic", label: "m", state: "NOT_ASKED", onAllow: allow }), (p) => p.label === "Allow…"), "onAction");
    fire(find(rendered(PermissionCheckRow, { id: "sys", label: "s", state: "DENIED", onOpenSettings: open }), (p) => p.label === "Open System Settings…"), "onAction");
    expect(allow).toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
  });
});

describe("self-test-panel (cpt-noter-component-ui-self-test-panel)", () => {
  const idle = initialSelfTestPanel("IDLE", true);
  const show = (panel: Panel, o: Partial<Parameters<typeof SelfTestPanel>[0]> = {}) => renderToString(<SelfTestPanel panel={panel} {...o} />);
  const fold = (panel: Panel, ...events: Parameters<typeof applySelfTestEvent>[1][]) => events.reduce(applySelfTestEvent, panel);
  const running = runSelfTest(idle, true);

  it("shows the meters, the empty transcript line and both buttons when idle", () => {
    const html = show(idle);
    expect(html).toContain('data-state="idle"');
    expect(html).toContain("The live transcript line appears here while the test runs.");
    expect(html).toContain("Play Test Clip");
    expect(html).toContain("Run Test");
    expect(html).not.toContain('role="status"');
    expect(html).toContain('data-variant="step"');
  });

  it("dims both buttons while waiting for the speech model, with its progress (D-21)", () => {
    const html = show(initialSelfTestPanel("WAITING_FOR_MODEL", true), { waitingPercent: 62 });
    expect(html).toContain("Waiting for the speech model · 62 %");
    expect(html).toContain('aria-valuenow="62"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("names the missing permission with Open System Settings…, buttons dimmed", () => {
    const html = show(initialSelfTestPanel("PERMISSION_MISSING", true));
    expect(html).toContain("System audio recording is not allowed yet.");
    expect(html).toContain("Open System Settings…");
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("shows the running state with its progress line, the pending result lines and a busy Run Test", () => {
    expect(show(running)).toContain("Checking that Noter&#x27;s own sounds stay out…");
    expect(show(running)).toContain('aria-busy="true"');
    expect(show(running)).toContain("is-pending");
    expect(show(running, { playClip: true })).toContain("Listening for the clip…");
    const both = fold(running, { type: "stream_arrived", channel: "mic" }, { type: "stream_arrived", channel: "sys" });
    expect(show(both, { playClip: true })).toContain("Checking that Noter");
  });

  it("shows Self-test passed with the four result lines, and the own-sounds line as information or a warning", () => {
    const passed = fold(running, { type: "stream_arrived", channel: "sys" }, { type: "stream_arrived", channel: "mic" }, { type: "levels", mic_db: -30, sys_db: -20 }, { type: "line", channel: "sys", text: "Noter test. Привет. Hallo." }, { type: "passed" });
    const html = show(passed);
    expect(html).toContain('<span class="fr-st__passed" role="status" aria-live="off">');
    for (const l of ["System audio arrives", "Your microphone arrives", "Both streams line up", "Noter&#x27;s own sounds stay out of the recording"]) expect(html).toContain(l);
    expect(html).toContain('lang="ru">Привет.');
    expect(html).toContain('aria-valuenow="50"'); // -30 dB on the You meter
    expect(show(fold(running, { type: "passed" }) && { ...passed, ownSounds: "off" })).toContain("Change this in Settings");
    expect(show({ ...passed, ownSounds: "leaked" })).toContain("reached the recording");
    expect(show({ ...passed, ownSounds: "leaked" })).toContain("is-warn");
  });

  it("names the silent stream and uses the primary Run Test in the sheet", () => {
    const failed = fold(running, { type: "failed", reason: { type: "one_stream_silent", channel: "sys" } });
    expect(show(failed)).toContain("We hear your microphone but not system audio.");
    expect(show(failed)).not.toContain('role="status"');
    expect(show(failed, { variant: "sheet" })).toContain("np-btn--primary");
    expect(show(failed)).not.toContain("np-btn--primary");
  });

  it("runs the owner's handlers", () => {
    const [clip, run, open] = [vi.fn(), vi.fn(), vi.fn()];
    const tree = rendered(SelfTestPanel, { panel: idle, onPlayClip: clip, onRun: run });
    fire(find(tree, (p) => p.label === "Play Test Clip"), "onAction");
    fire(find(tree, (p) => p.label === "Run Test"), "onAction");
    fire(find(rendered(SelfTestPanel, { panel: initialSelfTestPanel("PERMISSION_MISSING", true), onOpenSettings: open }), (p) => p.label === "Open System Settings…"), "onAction");
    expect([clip, run, open].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("splits the transcript line into sentences and tags the Cyrillic one as Russian", () => {
    expect(lineParts("Noter test. Привет. Hallo.")).toEqual([{ text: "Noter test.", lang: "und" }, { text: "Привет.", lang: "ru" }, { text: "Hallo.", lang: "und" }]); // the core sends no language: Cyrillic is Russian, the rest undetermined
    expect(lineParts("")).toEqual([]);
  });
});

describe("display-picker (cpt-noter-component-ui-display-picker)", () => {
  const display = (id: string, name: string, w: number, h: number, holds = false): DisplayInfo => ({ id, name, is_main: holds, holds_call_app: holds, width_pt: w, height_pt: h });
  const two = [display("builtin", "Built-in Retina Display", 1512, 982, true), display("studio", "Studio Display", 2560, 1440)];

  it("draws the displays to scale inside the box, side by side and centred", () => {
    const boxes = layoutDisplays(two);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.left).toBeGreaterThanOrEqual(0);
    expect(boxes[1]!.left).toBeGreaterThan(boxes[0]!.left + boxes[0]!.width);
    expect(boxes[1]!.left + boxes[1]!.width).toBeLessThanOrEqual(384);
    expect(Math.max(...boxes.map((b) => b.height))).toBeLessThanOrEqual(132);
    expect(layoutDisplays([])).toEqual([]);
  });

  it("lists the options with the recommended default selected, and marks the display without the call app", () => {
    const html = renderToString(<DisplayPicker picker={defaultDisplay(two, null)} displays={two} />);
    expect(html).toContain('data-variant="several-displays"');
    expect(html).toContain("Recommended");
    expect(html).toContain("Built-in Retina Display · Call app is here");
    expect(html).toContain('<input type="radio" name="call-display" checked="" value="auto"/>');
    expect(html).toContain("1512 × 982");
    expect(html.match(/is-sel/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Studio Display"');
  });

  it("selects the remembered display, and keeps an absent one selectable", () => {
    expect(renderToString(<DisplayPicker picker={defaultDisplay(two, "builtin")} displays={two} />)).toMatch(/is-sel" style="[^"]*" aria-label="Built-in Retina Display"/);
    const absent = renderToString(<DisplayPicker picker={defaultDisplay(two, "lg5k", "LG UltraFine 5K")} displays={two} />);
    expect(absent).toContain('data-variant="remembered-absent"');
    expect(absent).toContain("LG UltraFine 5K (not connected)");
  });

  it("explains the floating panel when there is one display", () => {
    const one = [two[0]!];
    const html = renderToString(<DisplayPicker picker={defaultDisplay(one, null)} displays={one} />);
    expect(html).toContain('data-variant="one-display"');
    expect(html).toContain("floating panel");
    expect(html).toContain("fr-dp__float");
    expect(html.match(/type="radio"/g)).toHaveLength(1);
  });

  it("reports the choice", () => {
    const pick = vi.fn();
    const tree = rendered(DisplayPicker, { picker: defaultDisplay(two, null), displays: two, onSelect: pick });
    fire(find(tree, (p) => p["aria-label"] === "Studio Display"), "onClick");
    fire(find(tree, (p) => typeof p.onAction === "function" && Array.isArray(p.options)), "onAction", "builtin");
    expect(pick.mock.calls).toEqual([["studio"], ["builtin"]]);
  });
});
