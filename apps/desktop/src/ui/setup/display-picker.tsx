import type { DisplayInfo } from "../../core/bindings";
import { AUTO_DISPLAY, type DisplayPicker as Picker } from "../../features/first-run/default-display";
import { t } from "../../i18n/format";
import { Msg } from "../../i18n/Msg";
import { Icon } from "../icons";
import { RadioGroup } from "../primitives/radio-group";
import "./setup.css";

export interface DisplayPickerProps {
  /** The options and selection from `defaultDisplay`. */
  picker: Picker;
  displays: readonly DisplayInfo[];
  /** The group's radio name; one per screen. */
  name?: string;
  onSelect?: (value: string) => void;
}

const BOX = { width: 384, height: 132, gap: 10 };

/** The displays side by side, scaled into the picker's box and centred; the arrangement itself is not in the contract. */
export function layoutDisplays(displays: readonly DisplayInfo[]): { id: string; left: number; top: number; width: number; height: number }[] {
  const total = displays.reduce((n, d) => n + d.width_pt, 0);
  const tallest = Math.max(1, ...displays.map((d) => d.height_pt));
  const gaps = BOX.gap * Math.max(0, displays.length - 1);
  const scale = Math.min((BOX.width - gaps) / Math.max(1, total), BOX.height / tallest);
  const used = total * scale + gaps;
  let x = (BOX.width - used) / 2;
  return displays.map((d) => {
    const width = Math.round(d.width_pt * scale);
    const height = Math.round(d.height_pt * scale);
    const box = { id: d.id, left: Math.round(x), top: Math.round((BOX.height - height) / 2), width, height };
    x += d.width_pt * scale + BOX.gap;
    return box;
  });
}

const resolution = (d: DisplayInfo) => t("display.resolution", { width: String(d.width_pt), height: String(d.height_pt) });

// @cpt-dod:cpt-noter-dod-ui-first-run-components:p1
// @cpt-component:cpt-noter-component-ui-display-picker:p1
/** display-picker: the connected displays drawn to scale and the options as a radio group; the one-display variant explains the floating panel. */
export function DisplayPicker({ picker, displays, name = "call-display", onSelect }: DisplayPickerProps) {
  const variant = picker.variant === "absent" ? "remembered-absent" : picker.variant === "one-display" ? "one-display" : "several-displays";
  const radios = <RadioGroup name={name} options={picker.options.map((o) => ({ value: o.value, label: o.label, note: o.note }))} value={picker.selected} label={t("display.title")} onAction={onSelect} />;
  if (picker.variant === "one-display") {
    const d = displays[0];
    return (
      <div className="fr-dp" data-component="cpt-noter-component-ui-display-picker" data-variant={variant} data-state="selected">
        <div className="fr-dp__one">
          <div className="fr-dp__screen is-sel">
            <span className="fr-dp__callapp">
              <Msg id="display.call_app" />
            </span>
            <span className="fr-dp__float" aria-hidden="true" />
            {d && <span className="fr-dp__name">{d.name}</span>}
            {d && <span className="fr-dp__res np-tnum">{resolution(d)}</span>}
          </div>
          <p className="fr-dp__note">
            <Msg id="display.one_note" />
          </p>
        </div>
        {radios}
      </div>
    );
  }
  // "The display without the call app" marks the first display that does not hold it
  const chosen = picker.selected === AUTO_DISPLAY ? displays.find((d) => !d.holds_call_app)?.id : picker.selected;
  const boxes = layoutDisplays(displays);
  return (
    <div className="fr-dp" data-component="cpt-noter-component-ui-display-picker" data-variant={variant} data-state="selected">
      <div className="fr-dp__draw" role="presentation">
        {displays.map((d, i) => {
          const b = boxes[i]!;
          return (
            <button key={d.id} type="button" className={`fr-dp__screen${chosen === d.id ? " is-sel" : ""}`} style={{ left: b.left, top: b.top, width: b.width, height: b.height }} aria-label={d.name} onClick={() => onSelect?.(d.id)}>
              {chosen === d.id && (
                <span className="fr-dp__check">
                  <Icon name="check" size={11} />
                </span>
              )}
              <span className="fr-dp__name">{d.name}</span>
              <span className="fr-dp__res np-tnum">{resolution(d)}</span>
              {d.holds_call_app && (
                <span className="fr-dp__callapp">
                  <Msg id="display.call_app" />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {radios}
    </div>
  );
}
