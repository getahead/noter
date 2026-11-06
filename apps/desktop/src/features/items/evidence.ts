// Evidence of an item: a TimeSpan is resolved to the call's current segments at read time (`transcript_span`), never
// by a cached row index, and opened in the Transcript with the first resolved line focused.
import type { Bridge } from "../../app/bridge/bridge";
import type { SpanPreview, TimeSpan } from "../../core/bindings";
import { clock } from "../transcript/model";

export type Resolved = { status: "ok"; preview: SpanPreview } | { status: "gone" } | { status: "error" };

/** The span's segments now; a source that no longer exists is `gone` (no dead link), any other failure is retryable. */
export async function resolveSpan(bridge: Bridge, span: TimeSpan): Promise<Resolved> {
  // @cpt-begin:cpt-noter-flow-ui-items-evidence:p1:inst-resolve
  const res = await bridge.act(`span:${span.call_id}:${span.t0_ms}`, "transcript_span", () => bridge.core.transcriptSpan({ span }));
  // @cpt-end:cpt-noter-flow-ui-items-evidence:p1:inst-resolve
  if (res.status === "ok") return { status: "ok", preview: res.data };
  // @cpt-begin:cpt-noter-flow-ui-items-evidence:p1:inst-source
  return res.error.code === "not_found" ? { status: "gone" } : { status: "error" };
  // @cpt-end:cpt-noter-flow-ui-items-evidence:p1:inst-source
}

/** Resolve the span, then open the Transcript on it (the page focuses the first resolved line and highlights it). */
export async function openEvidence(bridge: Bridge, span: TimeSpan): Promise<Resolved> {
  const r = await resolveSpan(bridge, span);
  if (r.status === "ok") await bridge.act("window_navigate", "window_navigate", () => bridge.core.windowNavigate({ target: { type: "call_page", call_id: span.call_id, tab: "transcript", span } }));
  return r;
}

/** What an evidence row says about its source: the audio line when the audio is gone, the archive notice when the words changed. */
export const evidenceNotes = (p: SpanPreview): Array<"audio_gone" | "archive"> => [
  // @cpt-begin:cpt-noter-flow-ui-items-evidence:p1:inst-audio
  ...(p.audio_available ? [] : (["audio_gone"] as const)),
  // @cpt-end:cpt-noter-flow-ui-items-evidence:p1:inst-audio
  // @cpt-begin:cpt-noter-flow-ui-items-evidence:p1:inst-archive
  ...(p.upgraded_by_archive ? (["archive"] as const) : []),
  // @cpt-end:cpt-noter-flow-ui-items-evidence:p1:inst-archive
];

export const spanTime = (s: TimeSpan) => clock(s.t0_ms);
