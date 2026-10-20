import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { Msg } from "../../i18n/Msg";
import type { PermissionRowState } from "../../features/first-run/permission-row";
import { Icon } from "../icons";
import { LevelMeter } from "../primitives/level-meter";
import { Progress } from "../primitives/progress";
import { PushButton } from "../primitives/push-button";
import "./setup.css";

export interface PermissionCheckRowProps {
  /** Which row: it decides the Allow… button (the microphone has a macOS prompt, system audio has not). */
  id: "mic" | "sys" | "cal";
  label: string;
  /** The Allow… button's label when it differs (Settings › Privacy: **Allow Calendar Access**). */
  allowLabel?: string;
  state: PermissionRowState;
  /** setup (first run, with the reason), status (Settings: nothing once granted) or test-only (the self-test sheet). */
  variant?: "setup" | "status" | "test-only";
  /** The device, shown once granted. */
  detail?: string;
  why?: string;
  howto?: string;
  /** The microphone reaches Noter: the meter and "Hearing you" under a granted microphone row. */
  hearing?: { level: number };
  onAllow?: () => void;
  onOpenSettings?: () => void;
}

const WORD: Record<PermissionRowState, MsgKey> = {
  GRANTED: "permission.granted",
  MISSING: "permission.missing",
  NOT_ASKED: "permission.not_asked",
  DENIED: "permission.denied",
  CHECKING: "permission.checking",
};

// @cpt-dod:cpt-noter-dod-ui-first-run-components:p1
// @cpt-component:cpt-noter-component-ui-permission-check-row:p1
/** permission-check-row: one macOS permission with its state word, the reason, the how-to and the one button that moves it on. */
export function PermissionCheckRow({ id, label, allowLabel, state, variant = "setup", detail, why, howto, hearing, onAllow, onOpenSettings }: PermissionCheckRowProps) {
  const icon =
    state === "GRANTED" ? <Icon name="checkCircle" size={15} /> : state === "CHECKING" ? <Progress variant="spinner" label={t("permission.checking_label")} /> : state === "NOT_ASKED" ? <Icon name="info" size={15} /> : <Icon name="warning" size={15} />;
  let action: React.ReactNode = null;
  // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-allow-mic
  if (state === "NOT_ASKED" && id !== "sys") action = <PushButton label={allowLabel ?? t("permission.allow")} onAction={onAllow} />;
  // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-allow-mic
  else if (variant === "test-only" && state === "NOT_ASKED") action = <PushButton label={t("permission.continue")} variant="primary" onAction={onAllow} />;
  // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-else-mic-denied
  // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-mic-denied
  // @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-open-settings
  else if (state !== "GRANTED" && state !== "CHECKING") action = <PushButton label={t("permission.open_settings")} onAction={onOpenSettings} />;
  // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-open-settings
  // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-mic-denied
  // @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-else-mic-denied
  const mark = state.toLowerCase().replace("_", "-");
  return (
    <div className={`fr-perm is-${mark}`} data-component="cpt-noter-component-ui-permission-check-row" data-variant={variant} data-state={mark}>
      <span className="fr-perm__icon">{icon}</span>
      <div className="fr-perm__main">
        <div className="fr-perm__head">
          <span className="fr-perm__name">{label}</span>
          {detail && state === "GRANTED" && <span className="np-dim"> · {detail}</span>}
          <span className="fr-perm__word"> · <Msg id={WORD[state]} /></span>
        </div>
        {variant !== "status" && why && <div className="fr-perm__why">{why}</div>}
        {variant !== "status" && howto && state !== "GRANTED" && <div className="fr-perm__how">{howto}</div>}
        {variant !== "status" && hearing && (
          <span className="fr-perm__meter">
            <LevelMeter level={hearing.level} label={t("permission.mic_level")} />
            <span className="fr-perm__hear">
              <Msg id="permission.hearing" />
            </span>
          </span>
        )}
      </div>
      {action && <span className="fr-perm__act">{action}</span>}
    </div>
  );
}
