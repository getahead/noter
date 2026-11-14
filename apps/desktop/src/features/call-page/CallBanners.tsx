// PC-R2: the call page's banner slot. After the first recorded call it offers the macOS notifications prompt;
// the app's banners (MW-R5) come first, one banner at a time, and a call being recorded shows none.
import { useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { BannerSlot, type Banner } from "../../ui/feedback/inline-banner";
import { useReviewBanner } from "../items/review-banner";
import { permissionState } from "../notifications/notifications";
import type { Route } from "../shell/history";
import { requestNotifications } from "./actions";
import { dismissed as closed, useExtras } from "./cache";
import { parseCallKey } from "./logic";
import { useOutputs } from "./outputs-cache";
import { useRegenerate } from "./RegenerateSheet";
import { audioDeleteKey } from "./share-actions";

// The × is view state for this window's lifetime: `banner_dismiss` has no notification-consent `BannerKind`, so
// nothing is sent and nothing persists (contract gap for the owner, call-page-frame.md).

// @cpt-flow:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1
export function CallBanners({ route, bridge, appBanners }: { route: Route; bridge: Bridge; appBanners: number }) {
  const callId = parseCallKey(route.key)!.callId;
  const extras = useExtras(callId);
  const call = useWindow(bridge, (s) => s.entities.call[callId]);
  const live = useWindow(bridge, (s) => s.whole.capture?.call_id === callId && (s.whole.capture.phase === "recording" || s.whole.capture.phase === "paused"));
  // only while macOS has never been asked: once answered (Allow, Don't Allow, or set in System Settings) the offer is moot
  const notAsked = useWindow(bridge, (s) => permissionState(s.whole.environment?.notifications) === "NOT_ASKED");
  const deleteKey = audioDeleteKey(callId);
  const audioDeleteError = useWindow(bridge, (s) => {
    const command = s.commands[deleteKey];
    return command?.state === "ERROR" ? command.error : null;
  });
  const [asked, setAsked] = useState(false);
  const [, redraw] = useState(0);
  const review = useReviewBanner(bridge, callId);
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-core-not-asked
  const offer = !!extras?.first_recorded_call && !!call && notAsked && !live && !asked && !closed.has("notify") && appBanners === 0;
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-core-not-asked
  const outputs = useOutputs(callId);
  const openRegenerate = useRegenerate(bridge, callId);
  const tab = parseCallKey(route.key)!.tab;
  const list: Banner[] = [];
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-delete-error
  if (audioDeleteError)
    list.push({ id: "audio-delete-error", severity: "error", text: t("audio.failed"), actions: audioDeleteError.tryAgain ? [{ label: t("action.try_again"), onAction: () => void bridge.retry(deleteKey) }] : [] });
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-delete-error
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-writing
  if (tab === "summary" && outputs?.status === "writing")
    list.push({
      id: "writing",
      severity: "info",
      text: t(outputs.written_locally ? "outputs.banner.writing_local" : "outputs.banner.writing"),
      actions: [{ label: t("outputs.banner.read_transcript"), onAction: () => void bridge.core.windowNavigate({ target: { type: "call_page", call_id: callId, tab: "transcript" } }) }],
    });
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-read-edit:p1:inst-writing
  else if (tab === "summary" && outputs?.written_locally && outputs.status !== "not_started")
    list.push({ id: "local", severity: "info", text: t("outputs.banner.written_locally"), actions: [{ label: t("outputs.banner.regenerate_claude"), onAction: () => openRegenerate(["summary"]) }] });
  if (review) list.push(review);
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-return-banner
  if (!offer && list.length === 0) return null;
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-return-banner
  // @cpt-begin:cpt-noter-flow-ui-notifications-allow:p1:inst-banner-flow
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-banner
  const banner: Banner = {
    id: "notify",
    severity: "info",
    text: t("callpage.banner.notify"),
    actions: [
      {
        label: t("callpage.banner.notify_action"),
        // @cpt-begin:cpt-noter-flow-ui-notifications-allow:p1:inst-nothing-else
        // @cpt-begin:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-user-notify
        // the banner goes away whatever macOS answers: Allow, or Don't Allow (Settings › General then says so)
        // @cpt-begin:cpt-noter-flow-ui-notifications-allow:p1:inst-return-allow
        onAction: () => void requestNotifications(bridge).then(() => setAsked(true)),
        // @cpt-end:cpt-noter-flow-ui-notifications-allow:p1:inst-return-allow
        // @cpt-end:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-user-notify
        // @cpt-end:cpt-noter-flow-ui-notifications-allow:p1:inst-nothing-else
      },
    ],
  };
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-banner
  // @cpt-end:cpt-noter-flow-ui-notifications-allow:p1:inst-banner-flow
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-if-close
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-local-dismiss
  return <BannerSlot banners={offer ? [...list, banner] : list} region="PC-R2" onDismiss={(id) => { if (id === "notify") { closed.add("notify"); redraw((n) => n + 1); } }} />;
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-local-dismiss
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-if-close
}
