// Registers People with the shell: the fourth section (⌘4), with its own toolbar (PL-R1).
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { registerPage } from "../shell/pages";
import { PeoplePage } from "./PeoplePage";
import { PeopleToolbar } from "./PeopleToolbar";

registerPage("people", {
  title: () => t("people.title"),
  // a person's own page is the next slice: its route shows a line until then
  render: (route) => (route.key === "root" ? <PeoplePage /> : <EmptyState variant="large" heading icon="person" title={t("people.person_soon")} />),
  toolbar: PeopleToolbar,
});
