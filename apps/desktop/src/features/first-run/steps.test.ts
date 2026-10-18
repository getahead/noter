import { describe, expect, it } from "vitest";
import type { BundleState, ModelBundle, SetupStatus, StepState } from "../../core/bindings";
import { nextStep, STEP_ORDER, stepperItemNext, stepperItems, type StepperItemEvent, type StepperItemState, type WizardAction, type WizardStep } from "./steps";

const go = (from: WizardStep, ...actions: WizardAction[]) => actions.reduce(nextStep, from);

describe("nextStep (cpt-noter-state-ui-first-run-steps)", () => {
  it("walks Continue from Welcome to Assistants and Finish to DONE", () => {
    const seen: WizardStep[] = ["welcome"];
    for (let i = 0; i < 5; i++) seen.push(nextStep(seen[i]!, { type: "continue" }));
    expect(seen).toEqual(STEP_ORDER);
    expect(nextStep("assistants", { type: "finish" })).toBe("done");
  });

  it("has no Continue on Assistants, no Finish elsewhere and nothing after DONE", () => {
    expect(nextStep("assistants", { type: "continue" })).toBe("assistants");
    expect(nextStep("audio_storage", { type: "finish" })).toBe("audio_storage");
    for (const a of ["continue", "skip", "back", "finish"] as const) expect(nextStep("done", { type: a })).toBe("done");
    expect(nextStep("done", { type: "goto", step: "welcome" })).toBe("done");
  });

  it("skips only Permissions and Call display", () => {
    expect(nextStep("permissions", { type: "skip" })).toBe("call_display");
    expect(nextStep("call_display", { type: "skip" })).toBe("audio_storage");
    for (const s of ["welcome", "models", "audio_storage", "assistants"] as const) expect(nextStep(s, { type: "skip" })).toBe(s);
  });

  it("goes Back one step, and stays on Welcome", () => {
    expect(nextStep("call_display", { type: "back" })).toBe("permissions");
    expect(go("assistants", { type: "back" }, { type: "back" })).toBe("call_display");
    expect(nextStep("welcome", { type: "back" })).toBe("welcome");
  });

  it("takes a stepper click only to an earlier step", () => {
    expect(nextStep("assistants", { type: "goto", step: "models" })).toBe("models");
    expect(nextStep("models", { type: "goto", step: "assistants" })).toBe("models");
    expect(nextStep("models", { type: "goto", step: "models" })).toBe("models");
  });
});

describe("stepperItemNext (cpt-noter-state-ui-first-run-stepper-item)", () => {
  const table: [StepperItemState, StepperItemEvent, StepperItemState][] = [
    ["UPCOMING", "reach", "CURRENT"],
    ["CURRENT", "continue_done", "DONE"],
    ["CURRENT", "skip", "SKIPPED"],
    ["CURRENT", "leave_models", "RUNNING_IN_BACKGROUND"],
    ["RUNNING_IN_BACKGROUND", "all_bundles_in", "DONE"],
    ["RUNNING_IN_BACKGROUND", "bundle_failed", "ERROR"],
    ["SKIPPED", "click", "CURRENT"],
    ["ERROR", "click", "CURRENT"],
  ];
  it.each(table)("%s on %s is %s", (from, event, to) => expect(stepperItemNext(from, event)).toBe(to));

  it("ignores every other event", () => {
    const states: StepperItemState[] = ["UPCOMING", "CURRENT", "DONE", "SKIPPED", "ERROR", "RUNNING_IN_BACKGROUND"];
    const events: StepperItemEvent[] = ["reach", "continue_done", "skip", "leave_models", "all_bundles_in", "bundle_failed", "click"];
    for (const s of states) for (const e of events) {
      if (!table.some(([f, ev]) => f === s && ev === e)) expect(stepperItemNext(s, e)).toBe(s);
    }
  });
});

const bundle = (state: BundleState): ModelBundle => ({ name: "m", size_mb: 100, done_mb: 0, state, required_for_capture: false });
const status = (bundles: BundleState[], skipped: SetupStatus["steps"][number]["step"][] = []) => ({
  steps: STEP_ORDER.map((step) => ({ step, state: (skipped.includes(step) ? "skipped" : "todo") as StepState })),
  models: { bundles: bundles.map(bundle), total_mb: 0, done_mb: 0, error: null },
});
const states = (current: WizardStep, s: ReturnType<typeof status>) => stepperItems(current, s).map((i) => i.state);

describe("stepperItems", () => {
  it("shows the current step with upcoming steps after it", () => {
    expect(states("welcome", status([]))).toEqual(["CURRENT", "UPCOMING", "UPCOMING", "UPCOMING", "UPCOMING", "UPCOMING"]);
  });

  it("rings Models while downloads go on after the user continues", () => {
    expect(states("permissions", status(["downloading", "ready"]))[1]).toBe("RUNNING_IN_BACKGROUND");
    expect(states("permissions", status([]))[1]).toBe("RUNNING_IN_BACKGROUND");
  });

  it("marks Models done once every bundle is in, and error when one fails its check", () => {
    expect(states("permissions", status(["ready", "ready"]))[1]).toBe("DONE");
    expect(states("permissions", status(["ready", "checksum_failed"]))[1]).toBe("ERROR");
  });

  it("keeps Models current while the user is on it, whatever the downloads do", () => {
    expect(states("models", status(["checksum_failed"]))[1]).toBe("CURRENT");
  });

  it("marks passed steps done or skipped from the core's step rows", () => {
    expect(states("audio_storage", status(["ready"], ["permissions"]))).toEqual(["DONE", "DONE", "SKIPPED", "DONE", "CURRENT", "UPCOMING"]);
  });

  it("marks every step passed once the wizard is done", () => {
    expect(states("done", status(["ready"], ["call_display"]))).toEqual(["DONE", "DONE", "DONE", "SKIPPED", "DONE", "DONE"]);
  });
});
