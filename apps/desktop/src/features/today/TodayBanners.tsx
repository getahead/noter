// TD-R2: Today's own banner after the app's: Calendar access is off. One banner at a time, the app's first.
import type { Bridge } from "../../app/bridge/bridge";
import { t } from "../../i18n/format";
import { BannerSlot } from "../../ui/feedback/inline-banner";
import type { Route } from "../shell/history";
import { openCalendarSettings } from "./actions";
import { useToday } from "./cache";

// @cpt-flow:cpt-noter-flow-ui-today-review:p1
export function TodayBanners({ bridge, appBanners }: { route: Route; bridge: Bridge; appBanners: number }) {
  const view = useToday();
  // @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-denied
  if (view?.calendar !== "denied" || appBanners > 0) return null;
  // @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-denied
  return <BannerSlot banners={[{ id: "today-denied", severity: "warning", text: t("today.denied"), actions: [{ label: t("today.open_settings"), onAction: () => void openCalendarSettings(bridge) }] }]} />;
}
