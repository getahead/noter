import type { OwnSounds, SelfTestPanel as Panel } from "../../features/first-run/self-test";
import { dbToLevel, OWN_SOUNDS_MESSAGE, SYSTEM_AUDIO_MISSING } from "../../features/first-run/self-test";
import { t } from "../../i18n/format";
import { Msg } from "../../i18n/Msg";
import type { IconName } from "../icons";
import { Icon } from "../icons";
import { LevelMeter } from "../primitives/level-meter";
import { Progress } from "../primitives/progress";
import { PushButton } from "../primitives/push-button";
import "./setup.css";

export interface SelfTestPanelProps {
  panel: Panel;
  /** step (first-run), sheet (the self-test sheet) or settings. */
  variant?: "step" | "sheet" | "settings";
  /** The speech model's progress, while the panel waits for it. */
  waitingPercent?: number;
  /** The user pressed Play Test Clip for this run. */
  playClip?: boolean;
  onPlayClip?: () => void;
  onRun?: () => void;
  onOpenSettings?: () => void;
}

/** The sentences of the live transcript line, each in its own language where the script tells it (Cyrillic is Russian). */
export function lineParts(text: string): { text: string; lang?: string }[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean)
    .map((s) => (/\p{Script=Cyrillic}/u.test(s) ? { text: s, lang: "ru" } : { text: s }));
}

function ResultLine({ kind, icon, text }: { kind: "ok" | "pending" | "info" | "warn"; icon: IconName; text: string }) {
  return (
    <li className={`fr-st__res is-${kind}`}>
      <Icon name={icon} size={13} />
      <span>{text}</span>
    </li>
  );
}

const OWN_KIND: Record<OwnSounds, "ok" | "pending" | "info" | "warn"> = { pending: "pending", excluded: "ok", off: "info", leaked: "warn" };
const OWN_ICON: Record<OwnSounds, IconName> = { pending: "ring", excluded: "checkCircle", off: "info", leaked: "warning" };

// @cpt-dod:cpt-noter-dod-ui-first-run-components:p1
// @cpt-component:cpt-noter-component-ui-self-test-panel:p1
/** self-test-panel: the You and Others meters, the live transcript line, what is wrong or still to wait for, the result lines and the two ways to run it. */
export function SelfTestPanel({ panel, variant = "step", waitingPercent = 0, playClip, onPlayClip, onRun, onOpenSettings }: SelfTestPanelProps) {
  const { state } = panel;
  const running = state === "RUNNING";
  const passed = state === "PASSED";
  const own = OWN_SOUNDS_MESSAGE[panel.ownSounds];
  return (
    <div className="fr-st" data-component="cpt-noter-component-ui-self-test-panel" data-variant={variant} data-state={state.toLowerCase().replaceAll("_", "-")}>
      <div className="fr-st__head">
        <span className="fr-st__title">
          <Msg id="self_test.title" />
        </span>
        {passed && (
          <span className="fr-st__passed" role="status" aria-live="off">
            <Icon name="checkCircle" size={14} />
            <Msg id="self_test.passed" />
          </span>
        )}
      </div>
      <div className="fr-st__meters">
        <span className="fr-st__meter">
          <span className="fr-st__ml">
            <Msg id="self_test.you" />
          </span>
          <LevelMeter level={dbToLevel(panel.micDb)} label={t("self_test.mic_level")} />
        </span>
        <span className="fr-st__meter">
          <span className="fr-st__ml">
            <Msg id="self_test.others" />
          </span>
          <LevelMeter level={dbToLevel(panel.sysDb)} label={t("self_test.sys_level")} />
        </span>
      </div>
      <div className="fr-st__live" aria-live="off">
        {panel.line ? (
          lineParts(panel.line.text).map((p, i) => (
            <span key={i} lang={p.lang}>
              {p.text}
            </span>
          ))
        ) : (
          <span className="np-dim">
            <Msg id="self_test.line_empty" />
          </span>
        )}
      </div>
      {/* @cpt-begin:cpt-noter-flow-ui-first-run-self-test:p1:inst-if-model */}
      {/* @cpt-begin:cpt-noter-flow-ui-first-run-self-test:p1:inst-wait-model */}
      {state === "WAITING_FOR_MODEL" && (
        <div className="fr-st__prog">
          <Progress value={waitingPercent} label={t("self_test.speech_model")} />
          <span>
            <Msg id="self_test.waiting" args={{ value: waitingPercent }} />
          </span>
        </div>
      )}
      {/* @cpt-end:cpt-noter-flow-ui-first-run-self-test:p1:inst-wait-model */}
      {/* @cpt-end:cpt-noter-flow-ui-first-run-self-test:p1:inst-if-model */}
      {running && (
        <div className="fr-st__prog" title={playClip ? t("self_test.clip_title") : undefined}>
          <Progress variant="spinner" />
          <span>{playClip && !(panel.arrived.mic && panel.arrived.sys) ? <Msg id="self_test.listening" /> : <Msg id="self_test.checking_own" />}</span>
        </div>
      )}
      {state === "FAILED" && panel.failure && (
        <div className="fr-st__fail">
          <Icon name="warning" size={14} />
          <span>
            <Msg id={panel.failure} />
          </span>
        </div>
      )}
      {state === "PERMISSION_MISSING" && (
        <div className="fr-st__fail">
          <Icon name="warning" size={14} />
          <span>
            <Msg id={SYSTEM_AUDIO_MISSING} />
          </span>
          <PushButton label={t("permission.open_settings")} size="small" onAction={onOpenSettings} />
        </div>
      )}
      {(running || passed) && (
        <ul className="fr-st__results">
          <ResultLine kind={panel.arrived.sys ? "ok" : "pending"} icon={panel.arrived.sys ? "checkCircle" : "ring"} text={t("self_test.sys_arrives")} />
          <ResultLine kind={panel.arrived.mic ? "ok" : "pending"} icon={panel.arrived.mic ? "checkCircle" : "ring"} text={t("self_test.mic_arrives")} />
          <ResultLine kind={panel.aligned ? "ok" : "pending"} icon={panel.aligned ? "checkCircle" : "ring"} text={t("self_test.aligned")} />
          <ResultLine kind={OWN_KIND[panel.ownSounds]} icon={OWN_ICON[panel.ownSounds]} text={own ? t(own) : t("self_test.own_excluded")} />
        </ul>
      )}
      <div className="fr-st__actions">
        <div className="fr-st__clip">
          <PushButton label={t("self_test.play_clip")} icon="play" disabled={!panel.runEnabled} onAction={onPlayClip} />
          <span className="fr-st__hint">
            <Msg id="self_test.hint" />
            <br />
            <Msg id="self_test.hint_say" />
          </span>
        </div>
        {/* @cpt-begin:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-run-test */}
        <PushButton label={t("self_test.run")} variant={variant === "step" ? "secondary" : "primary"} loading={running} disabled={!panel.runEnabled && !running} onAction={onRun} />
        {/* @cpt-end:cpt-noter-flow-ui-first-run-complete-setup:p1:inst-run-test */}
      </div>
    </div>
  );
}
