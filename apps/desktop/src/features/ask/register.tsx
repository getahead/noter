// Registers Ask with the shell: the second section (⌘2).
import { t } from "../../i18n/format";
import { registerPage } from "../shell/pages";
import { AskPage } from "./AskPage";
import { AskToolbar } from "./AskToolbar";

registerPage("ask", {
  title: () => t("ask.title"),
  toolbar: AskToolbar,
  render: (route, bridge) => <AskPage bridge={bridge!} routeKey={route.key} />,
});
