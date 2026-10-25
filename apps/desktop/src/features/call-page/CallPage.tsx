// The call page's body (PC-R5 and the page states): reads the call and the call types once, tells the core which
// call this window shows, and draws the PC-R5 header with the live-transcript feature's stored transcript under it.
// The toolbar, banner and Call info read the same call from the window store.
import { useEffect, useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { TimeSpan } from "../../core/bindings";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { audioLine, StoredTranscript } from "../transcript/hosts";
import { LanguageTag } from "../transcript/labels";
import { openCallPage, readCall, readKey, reportView } from "./actions";
import { useExtras } from "./cache";
import { afterTimer, pageState } from "./logic";
import "./call-page.css";

// @cpt-component:cpt-noter-component-screen-call-page:p1
export function CallPage({ bridge, callId, span }: { bridge: Bridge; callId: string; span?: TimeSpan | null }) {
  const call = useWindow(bridge, (s) => s.entities.call[callId]);
  const read = useWindow(bridge, (s) => s.commands[readKey(callId)]);
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const extras = useExtras(callId);
  const asked = useRef<string | null>(null);

  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-open-route
  // once per call and instance: a development remount must not ask the core twice
  useEffect(() => {
    if (asked.current === callId) return;
    asked.current = callId;
    void openCallPage(bridge, callId);
  }, [bridge, callId]);
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-open-route
  // the core sends no notification for the call this window shows; null once the page closes
  useEffect(() => {
    void reportView(bridge, callId);
    return () => void reportView(bridge, null);
  }, [bridge, callId]);

  const state = pageState(read, call !== undefined);
  const skeleton = useAfter(300, state === "LOADING");
  const tryAgain = () => void readCall(bridge, callId);

  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-if-gone
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-return-gone
  if (state === "NOT_FOUND") return <EmptyState variant="large" heading icon="inbox" title={t("callpage.gone_title")} body={t("callpage.gone_body")} />;
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-return-gone
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-if-gone
  if (state === "ERROR") return <InlineBanner banner={{ id: "call-error", severity: "error", text: t("callpage.error"), actions: [{ label: t("action.try_again"), onAction: tryAgain }] }} />;
  // @cpt-begin:cpt-noter-state-ui-call-page-frame-page:p1:inst-loading-ready
  if (state === "LOADING") return skeleton ? <Skeleton /> : null;
  // @cpt-end:cpt-noter-state-ui-call-page-frame-page:p1:inst-loading-ready

  // the page already read the call: the transcript asks the core for nothing more
  const detail = call ? { call, audio_not_stored: extras?.audio_not_stored ?? false } : null;
  const meta = audioLine(detail, prefs);
  return (
    <div className="pc pc--transcript" data-state="ready">
      <section className="pc-tr" data-region="PC-R5" aria-label={t("callpage.transcript")}>
        <div className="pc-tr__head">
          <span className="t-headline">{t("callpage.transcript")}</span>
          {call?.languages.map((l) => <LanguageTag key={typeof l === "string" ? l : l.code} lang={l} variant="call" />)}
          {meta && <span className="np-dim">{meta}</span>}
        </div>
        {/* @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-transcript */}
        {/* the header above carries the audio line, so the view draws none */}
        <StoredTranscript bridge={bridge} callId={callId} detail={detail} span={span} header={null} />
        {/* @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-transcript */}
      </section>
    </div>
  );
}

/** True once `active` has held for `ms` (skeleton rows after 300 ms, never a flash for a quick read). */
function useAfter(ms: number, active: boolean): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => afterTimer(ms, active, setLate), [ms, active]);
  return active && late;
}

/** Skeleton rows while the call is read. */
function Skeleton() {
  return (
    <div className="pc-skel" role="status" aria-label={t("callpage.loading")}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="pc-skel__line" style={{ width: "94%" }} />
      ))}
    </div>
  );
}
