import type { CaptureState } from "../../core/bindings";

/** Recording or paused: the live-call row shows (the frame state CAPTURING). */
export const isLive = (c: Pick<CaptureState, "phase"> | undefined): boolean => c?.phase === "recording" || c?.phase === "paused";

/**
 * Seconds recorded: what the core last reported, plus the time since it reported it while recording.
 * `receivedAt` is when the `capture:state` payload of this `version` reached the window.
 */
export function elapsedSeconds(c: Pick<CaptureState, "phase" | "recorded_ms">, receivedAt: number, now: number): number {
  return (c.recorded_ms + (c.phase === "recording" ? Math.max(0, now - receivedAt) : 0)) / 1000;
}

let stamp = { version: NaN as number | undefined, at: 0 };
/** When this window first saw capture `version`: shared by every clock, so one mounted later (Today) keeps the arrival time. */
export function receivedAtOf(c: Pick<CaptureState, "version"> | undefined): number {
  if (!c) return Date.now(); // a clock with no state yet (Today before its card is live) leaves the shared stamp alone
  if (c.version !== stamp.version) stamp = { version: c.version, at: Date.now() };
  return stamp.at;
}

/** The call's name in the live row and the footer: the part of the title before its first ": " — colon and space, so **1:1 with Anna** stays whole (**Planning: VHI 8.0** → **Planning**). */
export const shortTitle = (title: string | null): string => (title ?? "").split(": ")[0]!.trim();
