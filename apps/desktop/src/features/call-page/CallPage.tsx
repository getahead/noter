// The call page's body (PC-R5 and the page states): reads the call and the call types once, tells the core which
// call this window shows, and draws the stored transcript the live-transcript feature registers (a placeholder
// until it lands). The toolbar, banner and Call info read the same call from the window store.
import { useEffect, useRef } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { loadCall, loadTypes, readKey, reportView } from "./actions";
import { holdExtras, holdTypes, useExtras } from "./cache";
import { pageState } from "./logic";
import { slots } from "./slots";

// @cpt-component:cpt-noter-component-screen-call-page:p1
// @cpt-dod:cpt-noter-dod-ui-call-page-frame-frame:p1
export function CallPage({ bridge, callId, span }: { bridge: Bridge; callId: string; span?: string }) {
  const call = useWindow(bridge, (s) => s.entities.call[callId]);
  const read = useWindow(bridge, (s) => s.commands[readKey(callId)]);
  const slow = useWindow(bridge, (s) => s.slow);
  const extras = useExtras(callId);
  const asked = useRef<string | null>(null);

  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-open-route
  useEffect(() => {
    if (asked.current === callId) return;
    asked.current = callId;
    void loadCall(bridge, callId).then((r) => r.status === "ok" && holdExtras(callId, r.data));
    void loadTypes(bridge).then((r) => r.status === "ok" && holdTypes(r.data.call_types));
    // @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-open-route
    // the core sends no notification for the call this window shows; null once the page closes
    void reportView(bridge, callId);
    return () => {
      asked.current = null;
      void reportView(bridge, null);
    };
  }, [bridge, callId]);

  const state = pageState(read, call !== undefined);
  const tryAgain = () => void loadCall(bridge, callId).then((r) => r.status === "ok" && holdExtras(callId, r.data));

  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-if-gone
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-return-gone
  if (state === "NOT_FOUND") return <EmptyState variant="large" heading icon="inbox" title={t("callpage.gone_title")} body={t("callpage.gone_body")} />;
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-return-gone
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-if-gone
  if (state === "ERROR") return <InlineBanner banner={{ id: "call-error", severity: "error", text: t("callpage.error"), actions: [{ label: t("action.try_again"), onAction: tryAgain }] }} />;
  if (state === "LOADING") return slow || read?.state === "WAITING" ? <Skeleton /> : null;

  const audioKept = !!call && !call.audio_deleted && !(extras?.audio_not_stored ?? false);
  const Transcript = slots.transcript;
  return (
    <div className="pc pc--transcript" data-state="ready">
      {/* @cpt-begin:cpt-noter-flow-ui-call-page-frame-open:p1:inst-transcript */}
      <section className="pc-tr" data-region="PC-R5" aria-label={t("callpage.transcript")}>
        <div className="pc-tr__head">
          <span className="t-headline">{t("callpage.transcript")}</span>
        </div>
        {Transcript ? <Transcript bridge={bridge} callId={callId} audioKept={audioKept} span={span} /> : <p className="np-dim">{t("callpage.transcript_pending")}</p>}
      </section>
      {/* @cpt-end:cpt-noter-flow-ui-call-page-frame-open:p1:inst-transcript */}
    </div>
  );
}

/** Skeleton rows after 300 ms of loading (the bridge's `slow`). */
function Skeleton() {
  return (
    <div className="pc-skel" role="status" aria-label={t("callpage.loading")}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="pc-skel__line" style={{ width: "94%" }} />
      ))}
    </div>
  );
}
