// Registers Ask with the shell: the second section (⌘2).
import { t } from "../../i18n/format";
import { registerPage } from "../shell/pages";
import { AskPage } from "./AskPage";

registerPage("ask", {
  title: () => t("ask.title"),
  render: (route, bridge) => <AskPage bridge={bridge!} routeKey={route.key} />,
});
