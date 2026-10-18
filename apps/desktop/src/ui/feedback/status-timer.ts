// Timers of the inline status (docs/features/ui/primitives.md › Inline status): how long each variant shows,
// paused while a status with an action is hovered or focused. The clock is injected so tests move time by hand.

export type StatusVariant = "on-label" | "trailing" | "blind" | "row-outcome" | "notice";

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** The prototype's timings (NP.flash 2 s, call-status 3 s, row outcome 10 s). */
export const STATUS_MS: Record<StatusVariant, number> = { "on-label": 2000, trailing: 2000, notice: 2000, blind: 3000, "row-outcome": 10000 };

export interface StatusTimer {
  pause(): void;
  resume(): void;
  cancel(): void;
}

// @cpt-state:cpt-noter-state-ui-primitives-inline-status:p1
export function statusTimer(ms: number, onExpire: () => void, clock: Clock = realClock): StatusTimer {
  let remaining = ms;
  let started = clock.now();
  let paused = false;
  // @cpt-begin:cpt-noter-flow-ui-primitives-inline-status:p1:inst-remove-status
  // @cpt-begin:cpt-noter-state-ui-primitives-inline-status:p1:inst-shown-hidden
  let handle = clock.setTimeout(onExpire, ms);
  // @cpt-end:cpt-noter-state-ui-primitives-inline-status:p1:inst-shown-hidden
  // @cpt-end:cpt-noter-flow-ui-primitives-inline-status:p1:inst-remove-status
  return {
    pause() {
      if (paused) return;
      // @cpt-begin:cpt-noter-flow-ui-primitives-inline-status:p1:inst-pause-timer
      // @cpt-begin:cpt-noter-state-ui-primitives-inline-status:p1:inst-shown-paused
      paused = true;
      clock.clearTimeout(handle);
      remaining -= clock.now() - started;
      // @cpt-end:cpt-noter-state-ui-primitives-inline-status:p1:inst-shown-paused
      // @cpt-end:cpt-noter-flow-ui-primitives-inline-status:p1:inst-pause-timer
    },
    resume() {
      if (!paused) return;
      // @cpt-begin:cpt-noter-state-ui-primitives-inline-status:p1:inst-paused-shown
      paused = false;
      started = clock.now();
      handle = clock.setTimeout(onExpire, remaining);
      // @cpt-end:cpt-noter-state-ui-primitives-inline-status:p1:inst-paused-shown
    },
    cancel: () => clock.clearTimeout(handle),
  };
}
