// Registers Today with the shell: the first section (⌘1), with its own toolbar (TD-R1).
import { t } from "../../i18n/format";
import { registerPage } from "../shell/pages";
import { TodayPage } from "./TodayPage";
import { TodayToolbar } from "./TodayToolbar";

registerPage("today", {
  title: () => t("today.title"),
  render: (_route, bridge) => <TodayPage bridge={bridge!} />,
  toolbar: TodayToolbar,
});
