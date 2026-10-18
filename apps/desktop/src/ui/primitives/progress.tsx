import { t } from "../../i18n/format";
import { base, cx } from "./attrs";

export interface ProgressProps {
  /** bar (default) or spinner (rows). */
  variant?: "bar" | "spinner";
  /** 0 to 100; unset for an indeterminate bar. */
  value?: number | null;
  /** running (default), paused, finished or failed. */
  state?: string;
  label?: string;
  cls?: string;
}

// @cpt-dod:cpt-noter-dod-ui-primitives-controls:p1
/** progress: a 5-pt capsule bar with value text ("64 percent"), or the small row spinner. */
export function Progress({ variant, value = null, state = "running", label, cls }: ProgressProps) {
  if (variant === "spinner") return <span className={cx("np-spin", cls)} role="progressbar" aria-label={label || "Working"} {...base("progress", { variant: "spinner", state })} />;
  const ind = value == null;
  return (
    <span
      className={cx("np-progress", ind && "is-ind", cls)}
      role="progressbar"
      {...base("progress", { variant: ind ? "indeterminate" : "determinate", state })}
      aria-valuenow={ind ? undefined : value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      aria-valuetext={ind ? undefined : t("progress.percent", { value })}
    >
      <span className="np-progress__fill" style={{ width: `${ind ? 40 : Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}
