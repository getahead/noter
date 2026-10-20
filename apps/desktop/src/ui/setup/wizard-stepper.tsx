import type { SetupStep } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { Msg } from "../../i18n/Msg";
import { Icon } from "../icons";
import "./setup.css";

export type StepperState = "upcoming" | "current" | "done" | "skipped" | "error" | "running";
export interface StepperEntry {
  step: SetupStep;
  state: StepperState;
  /** The download's progress, for the ring of a step that runs in the background. */
  progress?: number;
}
export interface WizardStepperProps {
  steps: readonly StepperEntry[];
  /** `resumed` when the window opened where setup had stopped. */
  variant?: "first-pass" | "resumed";
  onGoto?: (step: SetupStep) => void;
}

const LABEL: Record<SetupStep, MsgKey> = {
  welcome: "first_run.step.welcome",
  models: "first_run.step.models",
  permissions: "first_run.step.permissions",
  call_display: "first_run.step.call_display",
  audio_storage: "first_run.step.audio_storage",
  assistants: "first_run.step.assistants",
};
/** data-state of the stepper and of the screen: which step shows. */
export const STEP_AT = ["step-1", "step-2", "step-3", "step-4", "step-5", "step-6"];
export const stepLabel = (step: SetupStep): string => t(LABEL[step]);

// @cpt-dod:cpt-noter-dod-ui-first-run-window:p1
// @cpt-component:cpt-noter-component-ui-wizard-stepper:p1
/** wizard-stepper: the six steps as a list; a done, skipped, failed or background step can be clicked to go back to it. */
export function WizardStepper({ steps, variant = "first-pass", onGoto }: WizardStepperProps) {
  const at = Math.max(0, steps.findIndex((s) => s.state === "current"));
  return (
    <ol className="fr-steps" data-component="cpt-noter-component-ui-wizard-stepper" data-variant={variant} data-state={STEP_AT[at]} aria-label={t("first_run.steps")}>
      {steps.map((s, i) => {
        const clickable = s.state === "done" || s.state === "skipped" || s.state === "error" || s.state === "running";
        const glyph =
          s.state === "done" || s.state === "running" ? <Icon name="check" size={12} /> : s.state === "skipped" ? <span aria-hidden="true">–</span> : s.state === "error" ? <Icon name="warning" size={12} /> : String(i + 1);
        const inner = (
          <>
            <span className="fr-step__mark">{glyph}</span>
            <span className="fr-step__label">{stepLabel(s.step)}</span>
            {/* @cpt-begin:cpt-noter-flow-ui-first-run-download-models:p1:inst-continue-bg */}
            {s.state === "running" && <span className="fr-ring" title={t("first_run.background", { value: s.progress ?? 0 })} style={{ "--p": s.progress ?? 0 } as React.CSSProperties} />}
            {/* @cpt-end:cpt-noter-flow-ui-first-run-download-models:p1:inst-continue-bg */}
            {s.state === "skipped" && (
              <span className="np-sr">
                <Msg id="first_run.skipped" />
              </span>
            )}
          </>
        );
        return (
          <li key={s.step} className={`fr-step is-${s.state === "running" ? "done" : s.state}`} data-state={s.state} aria-current={s.state === "current" ? "step" : undefined}>
            {clickable ? (
              <button type="button" className="fr-step__btn" onClick={() => onGoto?.(s.step)}>
                {inner}
              </button>
            ) : (
              <span className="fr-step__btn">{inner}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
