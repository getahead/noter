// TD-R2 shares MW-R5: Calendar warnings participate in severity ordering and +N More.
import { t } from "../../i18n/format";
import { BannerSlot } from "../../ui/feedback/inline-banner";
import type { PageBannerProps } from "../shell/pages";
import { openCalendarSettings } from "./actions";
import { useToday } from "./cache";

// @cpt-flow:cpt-noter-flow-ui-today-review:p1
// @cpt-algo:cpt-noter-algo-ui-today-project:p1
export function TodayBanners({ bridge, appBannerList = [], onDismiss }: PageBannerProps) {
  const view = useToday();
  // @cpt-begin:cpt-noter-flow-ui-today-review:p1:inst-denied
  const calendar = view?.calendar === "denied" ? [{ id: "today-denied", severity: "warning" as const, text: t("today.denied"), actions: [{ label: t("today.open_settings"), onAction: () => void openCalendarSettings(bridge) }] }] : [];
  // @cpt-end:cpt-noter-flow-ui-today-review:p1:inst-denied
  // @cpt-begin:cpt-noter-algo-ui-today-project:p1:inst-banner
  return <BannerSlot banners={[...appBannerList, ...calendar]} region="MW-R5" onDismiss={onDismiss} />;
  // @cpt-end:cpt-noter-algo-ui-today-project:p1:inst-banner
}

TodayBanners.includesAppBanners = true;
