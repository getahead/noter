// The Summary view (PC-R3): the call's output sections in PRD order, read with `outputs_get` and kept current by
// `outputs:progress` and the whole sections the core sends.
import { useEffect, useRef } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useAnnounce } from "../../app/a11y/announce";
import { useWindow } from "../../app/use-window";
import type { OutputSection as Section, SectionKind } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { SummaryNamingPanel } from "../transcript/hosts";
import { extrasOf } from "./cache";
import { OutputSection } from "./OutputSection";
import { announceSummaryOnce, loadOutputs, outputsKey, outputsRegenerateKey, regenerate } from "./outputs-actions";
import { useOutputs } from "./outputs-cache";
import { isWriting, mergeSection, needsRegenerationSettings, orderSections, settledSince } from "./outputs-logic";
import { RegenerationError, useRegenerate } from "./RegenerateSheet";

// @cpt-flow:cpt-noter-flow-ui-call-page-outputs-read-edit:p1
// @cpt-dod:cpt-noter-dod-ui-call-page-outputs-content:p1
export function OutputsView({ bridge, callId }: { bridge: Bridge; callId: string }) {
  const call = useWindow(bridge, (s) => s.entities.call[callId]);
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const outputs = useOutputs(callId);
  const sent = useWindow(bridge, (s) => s.sections);
  const progress = useWindow(bridge, (s) => s.outputs);
  const openRegenerate = useRegenerate(bridge, callId);
  const read = useWindow(bridge, (s) => s.commands[outputsKey(callId)]);
  const heldRun = outputs?.waiting_for_power;
  const regen = useWindow(bridge, (s) => s.commands[outputsRegenerateKey(callId)]);
  const announce = useAnnounce(bridge);
  // A fast outputs_get may already show the new state when React renders the completion event.
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-notification:p1:inst-visible
  const previousProgress = useRef(progress);
  useEffect(() => {
    if (!outputs || progress === previousProgress.current) return;
    const settled = settledSince(outputs, previousProgress.current, progress);
    previousProgress.current = progress;
    if (!settled) return;
    void loadOutputs(bridge, callId);
    announceSummaryOnce(announce, callId, settled);
  }, [announce, bridge, callId, outputs, progress]);
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-notification:p1:inst-visible

  if (!call || !prefs) return null;
  // naming does not wait for the outputs: a call whose outputs cannot be read still names its speakers
  const naming = <SummaryNamingPanel bridge={bridge} callId={callId} detail={{ call, audio_not_stored: extrasOf(callId)?.audio_not_stored ?? false }} />;
  if (!outputs) return <>{naming}{read?.state === "ERROR" ? <InlineBanner banner={{ id: "outputs-error", severity: "error", text: t("callpage.error"), actions: [{ label: t("action.try_again"), onAction: () => void loadOutputs(bridge, callId) }] }} /> : null}</>;

  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-sections
  const sections = orderSections(outputs.sections.flatMap((r) => mergeSection(r, sent[`${callId}/${r.kind}`], progress[`${callId}/${r.kind}`]) ?? []));
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-sections
  const again = (kind: SectionKind, local: boolean) => void regenerate(bridge, { call_id: callId, sections: [kind], local });
  const settingsLost = needsRegenerationSettings(outputs);
  const writing = isWriting(outputs);
  return (
    // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-return
    <div className="pc-sum" data-region="PC-R3" data-state={outputs.status}>
      {/* @cpt-begin:cpt-noter-flow-ui-speakers-post-call:p1:inst-panel */}
      {naming}
      {/* @cpt-end:cpt-noter-flow-ui-speakers-post-call:p1:inst-panel */}
      {/* @cpt-begin:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-recover-settings */}
      {settingsLost && <InlineBanner banner={{
        id: "regen-settings", severity: "error", title: t("outputs.regen.missing_settings"), text: t("outputs.regen.choose_again"),
        actions: [{ label: t("outputs.regen.again"), onAction: () => openRegenerate() }],
      }} />}
      {/* @cpt-end:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-recover-settings */}
      {/* @cpt-begin:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-power-hold */}
      {heldRun && <>
        <InlineBanner banner={{
          id: "regen-power", severity: "info", dismissible: false, title: t("outputs.regen.power_title"), text: t("outputs.regen.power_help"),
          actions: [{ label: t("outputs.regen.run_now"), loading: regen?.state === "WAITING",
            onAction: () => void regenerate(bridge, { call_id: callId, sections: [], local: false, run_now_on_battery: heldRun }) }],
        }} />
        {regen?.error?.code && <RegenerationError bridge={bridge} code={regen.error.code} />}
      </>}
      {sections.filter((s) => (!heldRun && !settingsLost) || s.state.type !== "pending").map((s: Section) => (
        <OutputSection key={s.kind} bridge={bridge} call={call} section={s} prefs={prefs} writing={writing} onRegenerate={(local) => (s.state.type === "failed" ? again(s.kind, local) : openRegenerate([s.kind]))} />
      ))}
      {/* @cpt-end:cpt-noter-flow-ui-call-page-outputs-regenerate:p1:inst-power-hold */}
    </div>
    // @cpt-end:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-return
  );
}
