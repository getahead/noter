// First-run wizard steps and stepper items as pure transition functions (docs/features/ui/first-run.md § 4).
import type { SetupStatus, SetupStep } from "../../core/bindings";

export type WizardStep = SetupStep | "done";
export const STEP_ORDER: readonly SetupStep[] = ["welcome", "models", "permissions", "call_display", "audio_storage", "assistants"];
const SKIPPABLE: readonly SetupStep[] = ["permissions", "call_display"];

export type WizardAction =
  | { type: "continue" }
  | { type: "skip" }
  | { type: "back" }
  | { type: "goto"; step: SetupStep }
  | { type: "finish" };

// @cpt-state:cpt-noter-state-ui-first-run-steps:p1
export function nextStep(current: WizardStep, action: WizardAction): WizardStep {
  if (current === "done") return current;
  const i = STEP_ORDER.indexOf(current);
  const next = STEP_ORDER[i + 1];
  switch (action.type) {
    case "continue":
      // @cpt-begin:cpt-noter-state-ui-first-run-steps:p1:inst-welcome-models
      // @cpt-begin:cpt-noter-state-ui-first-run-steps:p1:inst-models-permissions
      // @cpt-begin:cpt-noter-state-ui-first-run-steps:p1:inst-permissions-display
      // @cpt-begin:cpt-noter-state-ui-first-run-steps:p1:inst-display-storage
      // @cpt-begin:cpt-noter-state-ui-first-run-steps:p1:inst-storage-assistants
      return next ?? current; // Assistants has no Continue, only Finish
      // @cpt-end:cpt-noter-state-ui-first-run-steps:p1:inst-storage-assistants
      // @cpt-end:cpt-noter-state-ui-first-run-steps:p1:inst-display-storage
      // @cpt-end:cpt-noter-state-ui-first-run-steps:p1:inst-permissions-display
      // @cpt-end:cpt-noter-state-ui-first-run-steps:p1:inst-models-permissions
      // @cpt-end:cpt-noter-state-ui-first-run-steps:p1:inst-welcome-models
    case "skip":
      return SKIPPABLE.includes(current) && next ? next : current;
    case "finish":
      // @cpt-begin:cpt-noter-state-ui-first-run-steps:p1:inst-assistants-done
      return current === "assistants" ? "done" : current;
      // @cpt-end:cpt-noter-state-ui-first-run-steps:p1:inst-assistants-done
    case "back":
      // @cpt-begin:cpt-noter-state-ui-first-run-steps:p1:inst-back
      return i > 0 ? STEP_ORDER[i - 1]! : current;
    case "goto":
      // the stepper only takes the user back to a step they have already passed
      return STEP_ORDER.indexOf(action.step) < i ? action.step : current;
      // @cpt-end:cpt-noter-state-ui-first-run-steps:p1:inst-back
  }
}

export type StepperItemState = "UPCOMING" | "CURRENT" | "DONE" | "SKIPPED" | "ERROR" | "RUNNING_IN_BACKGROUND";
export type StepperItemEvent = "reach" | "continue_done" | "skip" | "leave_models" | "all_bundles_in" | "bundle_failed" | "click";

// @cpt-state:cpt-noter-state-ui-first-run-stepper-item:p1
export function stepperItemNext(state: StepperItemState, event: StepperItemEvent): StepperItemState {
  switch (state) {
    case "UPCOMING":
      // @cpt-begin:cpt-noter-state-ui-first-run-stepper-item:p1:inst-upcoming-current
      return event === "reach" ? "CURRENT" : state;
      // @cpt-end:cpt-noter-state-ui-first-run-stepper-item:p1:inst-upcoming-current
    case "CURRENT":
      // @cpt-begin:cpt-noter-state-ui-first-run-stepper-item:p1:inst-current-done
      // @cpt-begin:cpt-noter-state-ui-first-run-stepper-item:p1:inst-current-skipped
      // @cpt-begin:cpt-noter-state-ui-first-run-stepper-item:p1:inst-current-running
      return event === "continue_done" ? "DONE" : event === "skip" ? "SKIPPED" : event === "leave_models" ? "RUNNING_IN_BACKGROUND" : state;
      // @cpt-end:cpt-noter-state-ui-first-run-stepper-item:p1:inst-current-running
      // @cpt-end:cpt-noter-state-ui-first-run-stepper-item:p1:inst-current-skipped
      // @cpt-end:cpt-noter-state-ui-first-run-stepper-item:p1:inst-current-done
    case "RUNNING_IN_BACKGROUND":
      // @cpt-begin:cpt-noter-state-ui-first-run-stepper-item:p1:inst-running-done
      // @cpt-begin:cpt-noter-state-ui-first-run-stepper-item:p1:inst-running-error
      return event === "all_bundles_in" ? "DONE" : event === "bundle_failed" ? "ERROR" : state;
      // @cpt-end:cpt-noter-state-ui-first-run-stepper-item:p1:inst-running-error
      // @cpt-end:cpt-noter-state-ui-first-run-stepper-item:p1:inst-running-done
    case "SKIPPED":
      // @cpt-begin:cpt-noter-state-ui-first-run-stepper-item:p1:inst-skipped-current
      return event === "click" ? "CURRENT" : state;
      // @cpt-end:cpt-noter-state-ui-first-run-stepper-item:p1:inst-skipped-current
    case "ERROR":
      // @cpt-begin:cpt-noter-state-ui-first-run-stepper-item:p1:inst-error-current
      return event === "click" ? "CURRENT" : state;
      // @cpt-end:cpt-noter-state-ui-first-run-stepper-item:p1:inst-error-current
    case "DONE":
      return state;
  }
}

/** Each step's stepper state for the step the wizard shows and the core's setup status. */
export function stepperItems(current: WizardStep, status: Pick<SetupStatus, "steps" | "models">): { step: SetupStep; state: StepperItemState }[] {
  const at = current === "done" ? STEP_ORDER.length : STEP_ORDER.indexOf(current);
  const bundles = status.models.bundles;
  return STEP_ORDER.map((step, i) => {
    if (i > at) return { step, state: "UPCOMING" };
    let state = stepperItemNext("UPCOMING", "reach");
    if (i < at) {
      if (step === "models") {
        state = stepperItemNext(state, "leave_models");
        if (bundles.some((b) => b.state === "checksum_failed")) state = stepperItemNext(state, "bundle_failed");
        else if (bundles.length > 0 && bundles.every((b) => b.state === "ready")) state = stepperItemNext(state, "all_bundles_in");
      } else {
        const skipped = status.steps.some((r) => r.step === step && r.state === "skipped");
        state = stepperItemNext(state, skipped ? "skip" : "continue_done");
      }
    }
    return { step, state };
  });
}
