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

/** The call's name in the live row and the footer: the part of the title before its colon (**Planning: VHI 8.0** → **Planning**). */
export const shortTitle = (title: string | null): string => (title ?? "").split(":")[0]!.trim();
