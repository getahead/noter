// Options and selection of the call-display picker (docs/features/ui/first-run.md § 3).
import type { DisplayId, DisplayInfo } from "../../core/bindings";

export const AUTO_DISPLAY = "auto";
export type DisplayOption = { value: DisplayId | typeof AUTO_DISPLAY; label: string; note?: string; connected: boolean };
export type DisplayPicker = { variant: "one-display" | "several" | "absent"; options: DisplayOption[]; selected: DisplayOption["value"] };

/**
 * `remembered` is the stored display id (null = the display without the call app); the contract keeps only its id,
 * so a name for an absent display comes from the caller.
 */
// @cpt-algo:cpt-noter-algo-ui-first-run-default-display:p1
export function defaultDisplay(displays: DisplayInfo[], remembered: DisplayId | null, rememberedName = "Unknown display"): DisplayPicker {
  const auto: DisplayOption = { value: AUTO_DISPLAY, label: "The display without the call app", connected: true };
  // @cpt-begin:cpt-noter-algo-ui-first-run-default-display:p1:inst-if-one
  // @cpt-begin:cpt-noter-algo-ui-first-run-default-display:p1:inst-return-one
  if (displays.length === 1) return { variant: "one-display", options: [auto], selected: AUTO_DISPLAY };
  // @cpt-end:cpt-noter-algo-ui-first-run-default-display:p1:inst-return-one
  // @cpt-end:cpt-noter-algo-ui-first-run-default-display:p1:inst-if-one
  // @cpt-begin:cpt-noter-algo-ui-first-run-default-display:p1:inst-options
  const options: DisplayOption[] = [
    { ...auto, note: "Recommended" },
    ...displays.map((d) => ({ value: d.id, label: d.holds_call_app ? `${d.name} · Call app is here` : d.name, connected: true })),
  ];
  // @cpt-end:cpt-noter-algo-ui-first-run-default-display:p1:inst-options
  // @cpt-begin:cpt-noter-algo-ui-first-run-default-display:p1:inst-absent
  const absent = remembered !== null && !displays.some((d) => d.id === remembered);
  if (absent) options.push({ value: remembered, label: `${rememberedName} (not connected)`, connected: false });
  // @cpt-end:cpt-noter-algo-ui-first-run-default-display:p1:inst-absent
  // @cpt-begin:cpt-noter-algo-ui-first-run-default-display:p1:inst-select
  // @cpt-begin:cpt-noter-algo-ui-first-run-default-display:p1:inst-return-display
  return { variant: absent ? "absent" : "several", options, selected: remembered ?? AUTO_DISPLAY };
  // @cpt-end:cpt-noter-algo-ui-first-run-default-display:p1:inst-return-display
  // @cpt-end:cpt-noter-algo-ui-first-run-default-display:p1:inst-select
}
