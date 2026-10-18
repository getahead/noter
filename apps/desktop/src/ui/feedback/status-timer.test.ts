import { describe, expect, it } from "vitest";
import { STATUS_MS, statusTimer, type Clock } from "./status-timer";

/** A clock the test moves by hand. */
function fakeClock() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => (timers.set(++next, { at: now + ms, fn }), next),
    clearTimeout: (h) => void timers.delete(h as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [h, t] of [...timers].sort(([, a], [, b]) => a.at - b.at)) if (t.at <= now) (timers.delete(h), t.fn());
  };
  return { clock, advance, pending: () => timers.size };
}

describe("STATUS_MS (cpt-noter-flow-ui-primitives-inline-status)", () => {
  it("keeps the prototype's timings: 2 s label and notice, 3 s blind feedback, 10 s row outcome", () => {
    expect(STATUS_MS).toEqual({ "on-label": 2000, trailing: 2000, notice: 2000, blind: 3000, "row-outcome": 10000 });
  });
});

describe("statusTimer (cpt-noter-state-ui-primitives-inline-status)", () => {
  it("removes the status when its time ends", () => {
    const { clock, advance } = fakeClock();
    let gone = 0;
    statusTimer(2000, () => gone++, clock);
    advance(1999);
    expect(gone).toBe(0);
    advance(1);
    expect(gone).toBe(1);
  });

  it("pauses while hovered or focused and runs the rest of its time after", () => {
    const { clock, advance } = fakeClock();
    let gone = 0;
    const t = statusTimer(10000, () => gone++, clock);
    advance(4000);
    t.pause();
    t.pause(); // hover and focus both pause; the second is a no-op
    advance(60000);
    expect(gone).toBe(0);
    t.resume();
    t.resume();
    advance(5999);
    expect(gone).toBe(0);
    advance(1);
    expect(gone).toBe(1);
  });

  it("never fires after cancel (Undo ran or the owner removed it)", () => {
    const { clock, advance, pending } = fakeClock();
    let gone = 0;
    const t = statusTimer(3000, () => gone++, clock);
    t.cancel();
    advance(5000);
    expect(gone).toBe(0);
    expect(pending()).toBe(0);
  });

  it("uses the real timers by default", async () => {
    let gone = 0;
    statusTimer(1, () => gone++);
    await new Promise((r) => setTimeout(r, 10));
    expect(gone).toBe(1);
  });
});
