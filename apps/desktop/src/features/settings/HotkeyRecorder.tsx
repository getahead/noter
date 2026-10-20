import { useEffect, useReducer, type KeyboardEvent } from "react";

import { t } from "../../i18n/format";
import { Icon } from "../../ui/icons";
import { IconButton } from "../../ui/primitives/icon-button";
import { KeyCap } from "../../ui/primitives/key-cap";
import type { HotkeyAnswer } from "./actions";
import { checkChord, type ChordModifiers } from "./chord";
import { IDLE_RECORDER, recorderReduce, type RecorderState } from "./recorder";

export interface HotkeyRecorderProps {
  id: string;
  label: string;
  /** `single`: one chord; `modifier-set`: card keys (**+ 1, 2 or 3**); `derived`: read-only. */
  variant?: "single" | "modifier-set" | "derived";
  /** The chord as key caps; empty when the row has none. */
  caps: string;
  disabled?: boolean;
  /** The line the pane's test registration reports for this row; the state is then CONFLICT. */
  conflict?: string | null;
  /** An accepted chord: resolve once the core answered. */
  onRecord?: (chord: { code: string; modifiers: ChordModifiers }) => Promise<HotkeyAnswer>;
  /** ⌫ or **Clear shortcut**. */
  onClear?: () => Promise<HotkeyAnswer>;
}

const stateName = (s: RecorderState, caps: string) => (s.type === "IDLE" && !caps ? "CLEARED" : s.type).toLowerCase();

// @cpt-component:cpt-noter-component-ui-hotkey-recorder:p1
// @cpt-dod:cpt-noter-dod-ui-settings-hotkeys:p1
export function HotkeyRecorder({ id, label, variant = "single", caps, disabled, conflict, onRecord, onClear }: HotkeyRecorderProps) {
  const [state, dispatch] = useReducer(recorderReduce, IDLE_RECORDER);
  useEffect(() => dispatch({ type: disabled ? "disable" : "enable" }), [disabled]);
  useEffect(() => void (conflict && dispatch({ type: "refused", message: conflict })), [conflict]);

  const recording = state.type === "RECORDING";
  const message = state.type === "CONFLICT" || state.type === "INVALID" ? state.message : null;
  const settle = async (answer: Promise<HotkeyAnswer> | undefined) => {
    const r = await answer;
    if (r) dispatch(r.ok ? { type: "registered" } : { type: "refused", message: r.message });
  };

  // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-user-chord
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    const modifiers = { control: e.ctrlKey, option: e.altKey, command: e.metaKey, shift: e.shiftKey };
    // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-check
    // the core owns the VoiceOver state: it refuses the chord with `hotkey_reserved`, so it is not read here
    const result = checkChord({ code: e.code, modifiers, variant: variant === "modifier-set" ? "modifier-set" : "single", voiceOver: false });
    // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-check
    dispatch({ type: "chord", result });
    if (result.type === "accept") void settle(onRecord?.({ code: result.code, modifiers: result.modifiers }));
    else if (result.type === "clear") void settle(onClear?.());
  };
  // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-user-chord

  return (
    <div
      data-component="cpt-noter-component-ui-hotkey-recorder"
      data-variant={variant}
      data-state={stateName(state, caps)}
      className={disabled ? "hk-row is-disabled" : "hk-row"}
    >
      <span className="hk-label">{label}</span>
      <span className="hk-ctl">
        {variant === "derived" ? (
          <span className="hk-field is-ro">{caps && <KeyCap keys={caps} />}</span>
        ) : (
          <button
            type="button"
            id={id}
            className={recording ? "hk-field is-rec" : "hk-field"}
            disabled={disabled}
            aria-label={t("settings.hotkeys.field", { label, chord: caps || t("settings.hotkeys.none") })}
            // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-start-record
            // Safari does not focus a button on click, and the chord is read from the focused field
            onClick={(e) => (e.currentTarget.focus(), dispatch({ type: "start" }))}
            // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-start-record
            onKeyDown={onKeyDown}
            // the field never traps the keyboard: leaving it ends recording
            onBlur={() => recording && dispatch({ type: "chord", result: { type: "cancel" } })}
          >
            {/* @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-recording */}
            {recording ? <span className="np-dim">{t("settings.hotkeys.type_shortcut")}</span> : caps ? <KeyCap keys={caps} /> : <span className="np-dim">{t("settings.hotkeys.none")}</span>}
            {/* @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-recording */}
          </button>
        )}
        {variant === "modifier-set" && <span className="np-dim">{t("settings.hotkeys.pin_suffix")}</span>}
        {variant === "single" && caps && !disabled && <IconButton icon="x" label={t("settings.hotkeys.clear")} size="inline" onAction={() => void settle(onClear?.())} />}
      </span>
      <div className="hk-live" aria-live="polite">
        {message && !recording && (
          <span className="hk-err">
            <Icon name="warning" size={12} />
            {message}
          </span>
        )}
      </div>
    </div>
  );
}
