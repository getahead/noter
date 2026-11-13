// The commands behind the Summary view. Each goes through `bridge.act`, so the control that sent it shows its own
// busy and error state; results are held in `outputs-cache.ts`.
import type { Bridge } from "../../app/bridge/bridge";
import type { RegenerateArgs } from "../../core/bindings";
import { t } from "../../i18n/format";
import { summaryReadyNow } from "./outputs-logic";
import { bodyOf, holdBody, holdOutputs, holdVersions } from "./outputs-cache";

export const outputsKey = (callId: string) => `outputs:get:${callId}`;

// @cpt-flow:cpt-noter-flow-ui-call-page-outputs-read-edit:p1
/** `outputs_get`: the sections of the call, held for the view. */
export async function loadOutputs(bridge: Bridge, callId: string) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-get
  const r = await bridge.act(outputsKey(callId), "outputs_get", () => bridge.core.outputsGet({ call_id: callId }));
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-get
  if (r.status === "ok") holdOutputs(r.data);
  return r;
}

/** `output_edit` with the revision the draft started from; the core answers the whole section and sends it as `entity:changed` too. */
export function saveEdit(bridge: Bridge, callId: string, summaryId: string, rev: number, bodyMd: string) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-save
  return bridge.act(`output:edit:${summaryId}`, "output_edit", () => bridge.core.outputEdit({ call_id: callId, summary_id: summaryId, rev, body_md: bodyMd }));
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-save
}

// @cpt-flow:cpt-noter-flow-ui-call-page-outputs-regenerate:p1
/** `outputs_regenerate`: the answer is the scheduled job, not the result; `outputs:progress` brings the text. */
export function regenerate(bridge: Bridge, args: RegenerateArgs) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-call
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-job
  return bridge.act(`outputs:regen:${args.call_id}`, "outputs_regenerate", () => bridge.core.outputsRegenerate(args));
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-job
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-call
}

/** `output_versions`, read when the menu opens and again after an edit changed the list. */
export async function loadVersions(bridge: Bridge, summaryId: string) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-versions
  const r = await bridge.act(`versions:${summaryId}`, "output_versions", () => bridge.core.outputVersions({ summary_id: summaryId }));
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-versions
  if (r.status === "ok") holdVersions(summaryId, r.data);
  return r;
}

/** `output_version_get`: a body to read or compare; it never writes. */
export async function loadVersion(bridge: Bridge, summaryId: string, versionId: string) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-version
  const r = await bridge.act(`version:${summaryId}:${versionId}`, "output_version_get", () => bridge.core.outputVersionGet({ summary_id: summaryId, version_id: versionId }));
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-version
  if (r.status === "ok") holdBody(summaryId, r.data);
  return r;
}

/** Save a draft; after a refusal the core's current text is read again, and the draft is the caller's to keep. */
export async function commitDraft(bridge: Bridge, callId: string, draft: { summaryId: string; baseRev: number; text: string }): Promise<"ok" | "conflict" | "error"> {
  const r = await saveEdit(bridge, callId, draft.summaryId, draft.baseRev, draft.text);
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-error
  // @cpt-begin:cpt-noter-state-ui-call-page-outputs-section:p1:inst-save-error
  if (r.status === "error") {
    if (r.error.code !== "conflict") return "error";
    void loadOutputs(bridge, callId);
    return "conflict";
  }
  // @cpt-end:cpt-noter-state-ui-call-page-outputs-section:p1:inst-save-error
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-error
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-saved
  void loadOutputs(bridge, callId);
  void loadVersions(bridge, draft.summaryId);
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-saved
  return "ok";
}

/** A version's body is held (read once); false when the core could not give it. */
export async function readVersion(bridge: Bridge, summaryId: string, versionId: string): Promise<boolean> {
  return !!bodyOf(summaryId, versionId) || (await loadVersion(bridge, summaryId, versionId)).status === "ok";
}

/** Announce **Summary ready** (polite) when `settled` says the Summary finished; the shared service deduplicates this call. */
export function announceSummaryOnce(announce: (event: { kind: "outputs_ready"; text: string; key: string }) => Promise<void>, callId: string, settled: string) {
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-notification:p1:inst-visible
  if (!summaryReadyNow(settled)) return false;
  void announce({ kind: "outputs_ready", text: t("outputs.summary_ready"), key: callId });
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-notification:p1:inst-visible
  return true;
}
