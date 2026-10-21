import type { HotkeyAnswer } from "./actions";
import { checkChord, type ChordModifiers, type ChordResult } from "./chord";
import type { RecorderEvent, RecorderState } from "./recorder";

export interface RecorderKey {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

export interface KeyOutcome {
  event: RecorderEvent;
  /** What the owner does: send the accepted chord or the clear, or (modifier set) hold the modifiers until they are released. */
  send: { type: "record"; code: string; modifiers: ChordModifiers } | { type: "hold"; modifiers: ChordModifiers } | { type: "clear" } | null;
}

/** What a keydown on a recording field does; null while the field is not recording or the key is a repeat. */
export function onRecordKey(recording: boolean, e: RecorderKey, variant: "single" | "modifier-set"): KeyOutcome | null {
  if (!recording || e.repeat) return null;
  const modifiers = { control: e.ctrlKey, option: e.altKey, command: e.metaKey, shift: e.shiftKey };
  // the core owns the VoiceOver state: it refuses the chord with `hotkey_reserved`, so it is not read here
  const result: ChordResult = checkChord({ code: e.code, modifiers, variant, voiceOver: false });
  const event: RecorderEvent = { type: "chord", result };
  // a modifier set is complete only when the user lets go of the keys: Control alone must not be saved on the way to ⌃⌥⌘
  if (result.type === "accept") return { event, send: variant === "modifier-set" ? { type: "hold", modifiers: result.modifiers } : { type: "record", code: result.code, modifiers: result.modifiers } };
  return { event, send: result.type === "clear" ? { type: "clear" } : null };
}

/** The modifiers held so far, with the ones this keydown adds. */
export const holdMore = (held: ChordModifiers | null, m: ChordModifiers): ChordModifiers => ({
  control: !!held?.control || m.control,
  option: !!held?.option || m.option,
  command: !!held?.command || m.command,
  shift: !!held?.shift || m.shift,
});

/** A keyup ends a modifier set once no modifier is still down: the combination held so far is what to save. */
export const releasedSet = (held: ChordModifiers | null, e: Pick<RecorderKey, "ctrlKey" | "altKey" | "metaKey" | "shiftKey">): ChordModifiers | null =>
  held && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey ? held : null;

/** What a chord field's key handlers need from the component that owns its state. */
export interface RecorderCtx {
  state: RecorderState;
  variant: "single" | "modifier-set" | "derived";
  /** The line the core reports for the row. */
  conflict?: string | null;
  /** A modifier set collects its keys here until they are released. */
  held: { current: ChordModifiers | null };
  dispatch: (e: RecorderEvent) => void;
  /** Wait for the core's answer and move the recorder on. */
  settle: (answer: Promise<HotkeyAnswer> | undefined) => void;
  onRecord?: (chord: { code: string; modifiers: ChordModifiers }) => Promise<HotkeyAnswer>;
  onClear?: () => Promise<HotkeyAnswer>;
}

export type KeyEvent = RecorderKey & { key: string; preventDefault(): void; stopPropagation(): void };

// @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-user-chord
export function handleKeyDown(ctx: RecorderCtx, e: KeyEvent): void {
  const { state, conflict, dispatch, held } = ctx;
  const recording = state.type === "RECORDING";
  // Esc on the red hint of the user's own attempt takes the hint away (a hint the core reports for the row stays)
  if (!recording && e.key === "Escape" && (state.type === "INVALID" || (state.type === "CONFLICT" && state.message !== conflict))) dispatch({ type: "dismiss" });
  // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-check
  const out = onRecordKey(recording, e, ctx.variant === "modifier-set" ? "modifier-set" : "single");
  // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-check
  if (!out) return;
  e.preventDefault();
  e.stopPropagation();
  dispatch(out.event);
  held.current = out.send?.type === "hold" ? holdMore(held.current, out.send.modifiers) : null;
  // @cpt-begin:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-if-accepted
  if (out.send?.type === "record") ctx.settle(ctx.onRecord?.({ code: out.send.code, modifiers: out.send.modifiers }));
  else if (out.send?.type === "clear") ctx.settle(ctx.onClear?.());
  // @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-if-accepted
}
// @cpt-end:cpt-noter-flow-ui-settings-set-hotkeys:p1:inst-user-chord

/** A keyup ends a modifier set once no modifier is down: the combination held so far is sent. */
export function handleKeyUp(ctx: RecorderCtx, e: Pick<RecorderKey, "code" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">): void {
  const done = ctx.state.type === "RECORDING" ? releasedSet(ctx.held.current, e) : null;
  if (!done) return;
  ctx.held.current = null;
  ctx.settle(ctx.onRecord?.({ code: e.code, modifiers: done }));
}
