// The Summary view (PC-R3): the call's output sections in PRD order, read with `outputs_get` and kept current by
// `outputs:progress` and the whole sections the core sends.
import { useEffect, useRef } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { OutputSection as Section, SectionKind } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { SummaryNamingPanel } from "../transcript/hosts";
import { extrasOf } from "./cache";
import { OutputSection } from "./OutputSection";
import { announceSummaryOnce, loadOutputs, outputsKey, regenerate } from "./outputs-actions";
import { useOutputs } from "./outputs-cache";
import { isWriting, mergeSection, orderSections } from "./outputs-logic";
import { useRegenerate } from "./RegenerateSheet";

// @cpt-flow:cpt-noter-flow-ui-call-page-outputs-read-edit:p1
export function OutputsView({ bridge, callId }: { bridge: Bridge; callId: string }) {
  const call = useWindow(bridge, (s) => s.entities.call[callId]);
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const outputs = useOutputs(callId);
  const sent = useWindow(bridge, (s) => s.sections);
  const progress = useWindow(bridge, (s) => s.outputs);
  const openRegenerate = useRegenerate(bridge, callId);
  const read = useWindow(bridge, (s) => s.commands[outputsKey(callId)]);

  // once per call and instance: a development remount must not ask the core twice
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (asked.current === callId) return;
    asked.current = callId;
    void loadOutputs(bridge, callId);
  }, [bridge, callId]);
  // a section that finished (or failed) since the last read: its text comes from the core, not from the event
  const settled = (outputs?.sections ?? []).flatMap((s) => {
    const p = progress[`${callId}/${s.kind}`]?.state.type;
    return p && p !== s.state.type && p !== "pending" && p !== "writing" ? [`${s.kind}:${p}`] : [];
  }).join();
  const lastSettled = useRef("");
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!settled) return void (lastSettled.current = "");
    if (lastSettled.current === settled) return;
    lastSettled.current = settled;
    void loadOutputs(bridge, callId);
    announceSummaryOnce(bridge, callId, settled, announced);
  }, [bridge, callId, settled]);

  if (!call || !prefs) return null;
  if (!outputs) return read?.state === "ERROR" ? <InlineBanner banner={{ id: "outputs-error", severity: "error", text: t("callpage.error"), actions: [{ label: t("action.try_again"), onAction: () => void loadOutputs(bridge, callId) }] }} /> : null;

  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-sections
  const sections = orderSections(outputs.sections.flatMap((r) => mergeSection(r, sent[`${callId}/${r.kind}`], progress[`${callId}/${r.kind}`]) ?? []));
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-sections
  const again = (kind: SectionKind, local: boolean) => void regenerate(bridge, { call_id: callId, sections: [kind], local });
  const writing = isWriting(outputs);
  return (
    // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-return
    <div className="pc-sum" data-region="PC-R3" data-state={outputs.status}>
      {/* @cpt-begin:cpt-noter-flow-ui-speakers-post-call:p1:inst-panel */}
      <SummaryNamingPanel bridge={bridge} callId={callId} detail={{ call, audio_not_stored: extrasOf(callId)?.audio_not_stored ?? false }} />
      {/* @cpt-end:cpt-noter-flow-ui-speakers-post-call:p1:inst-panel */}
      {sections.map((s: Section) => (
        <OutputSection key={s.kind} bridge={bridge} call={call} section={s} prefs={prefs} writing={writing} onRegenerate={(local) => (s.state.type === "failed" ? again(s.kind, local) : openRegenerate([s.kind]))} />
      ))}
    </div>
    // @cpt-end:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-return
  );
}
