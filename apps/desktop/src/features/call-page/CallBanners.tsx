// PC-R2: the call page's banner slot. After the first recorded call it offers the macOS notifications prompt;
// the app's banners (MW-R5) come first, one banner at a time, and a call being recorded shows none.
import { useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { BannerSlot, type Banner } from "../../ui/feedback/inline-banner";
import type { Route } from "../shell/history";
import { requestNotifications } from "./actions";
import { dismissed as closed, useExtras } from "./cache";
import { parseCallKey } from "./logic";

// The × is view state for this window's lifetime: `banner_dismiss` has no notification-consent `BannerKind`, so
// nothing is sent and nothing persists (contract gap for the owner, call-page-frame.md).

// @cpt-flow:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1
export function CallBanners({ route, bridge, appBanners }: { route: Route; bridge: Bridge; appBanners: number }) {
  const callId = parseCallKey(route.key)!.callId;
  const extras = useExtras(callId);
  const call = useWindow(bridge, (s) => s.entities.call[callId]);
  const live = useWindow(bridge, (s) => s.whole.capture?.call_id === callId && (s.whole.capture.phase === "recording" || s.whole.capture.phase === "paused"));
  const [asked, setAsked] = useState(false);
  const [, redraw] = useState(0);
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-core-not-asked
  const offer = !!extras?.first_recorded_call && !!call && !live && !asked && !closed.has("notify") && appBanners === 0;
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-core-not-asked
  if (!offer) return null;
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-banner
  const banner: Banner = {
    id: "notify",
    severity: "info",
    text: t("callpage.banner.notify"),
    actions: [
      {
        label: t("callpage.banner.notify_action"),
        // @cpt-begin:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-user-notify
        // the banner goes away whatever macOS answers: Allow, or Don't Allow (Settings › General then says so)
        onAction: () => void requestNotifications(bridge).then(() => setAsked(true)),
        // @cpt-end:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-user-notify
      },
    ],
  };
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-banner
  // @cpt-begin:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-local-dismiss
  return <BannerSlot banners={[banner]} region="PC-R2" onDismiss={() => (closed.add("notify"), redraw((n) => n + 1))} />;
  // @cpt-end:cpt-noter-flow-ui-call-page-frame-notifications-banner:p1:inst-local-dismiss
}
