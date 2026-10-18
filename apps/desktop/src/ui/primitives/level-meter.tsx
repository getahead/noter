import { base, cx } from "./attrs";

export interface LevelMeterProps {
  /** 0 to 10 lit segments. */
  level?: number;
  /** The last segment in the Warning colour; the owner adds the text. */
  clipping?: boolean;
  /** "Microphone level"; the value is not announced continuously. */
  label?: string;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** level-meter: 10 horizontal segments; silent, signal or clipping. */
export function LevelMeter({ level = 0, clipping, label }: LevelMeterProps) {
  return (
    <span className="np-meter" {...base("level-meter", { variant: "horizontal", state: clipping ? "clipping" : level > 0 ? "signal" : "silent" })} role="meter" aria-label={label || "Level"} aria-valuenow={level * 10} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={cx("np-meter__seg", i < level && "is-on", clipping && i === 9 && "is-clip")} />
      ))}
    </span>
  );
}
