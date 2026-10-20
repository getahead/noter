import { useEffect, useReducer, useRef, type KeyboardEvent } from "react";

import { t } from "../../i18n/format";
import { Icon } from "../../ui/icons";
import { IconButton } from "../../ui/primitives/icon-button";
import { KeyCap } from "../../ui/primitives/key-cap";
import type { HotkeyAnswer } from "./actions";
import type { ChordModifiers } from "./chord";
import { IDLE_RECORDER, recorderReduce, type RecorderState } from "./recorder";
import { holdMore, onRecordKey, releasedSet } from "./recorder-key";

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

  const held = useRef<ChordModifiers | null>(null); // a modifier set collects its keys until they are released
  const recording = state.type === "RECORDING";
  const message = state.type === "CONFLICT" || state.type === "INVALID" ? state.message : null;
  const settle = async (answer: Promise<HotkeyAnswer> | undefined) => {
    const r = await answer;
    // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-if-conflict
    // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-new-chord
    if (r) dispatch(r.ok ? { type: "registered" } : { type: "refused", message: r.message });
    // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-new-chord
    // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-if-conflict
  };

  // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-user-chord
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    // Esc on the red hint of the user's own attempt takes the hint away (a hint the core reports for the row stays)
    if (!recording && e.key === "Escape" && (state.type === "INVALID" || (state.type === "CONFLICT" && state.message !== conflict))) dispatch({ type: "dismiss" });
    // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-check
    const out = onRecordKey(recording, e, variant === "modifier-set" ? "modifier-set" : "single");
    // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-check
    if (!out) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch(out.event);
    held.current = out.send?.type === "hold" ? holdMore(held.current, out.send.modifiers) : null;
    // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-if-accepted
    if (out.send?.type === "record") void settle(onRecord?.({ code: out.send.code, modifiers: out.send.modifiers }));
    else if (out.send?.type === "clear") void settle(onClear?.());
    // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-if-accepted
  };
  // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-user-chord
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    const done = recording ? releasedSet(held.current, e) : null;
    if (!done) return;
    held.current = null;
    void settle(onRecord?.({ code: e.code, modifiers: done }));
  };

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
            onClick={(e) => ((held.current = null), e.currentTarget.focus(), dispatch({ type: "start" }))}
            // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-start-record
            onKeyDown={onKeyDown}
            onKeyUp={onKeyUp}
            // the field never traps the keyboard: leaving it ends recording
            onBlur={() => {
              held.current = null; // modifiers held when focus leaves belong to no combination
              if (recording) dispatch({ type: "chord", result: { type: "cancel" } });
            }}
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
