// Registers People with the shell: the fourth section (⌘4), with its own toolbar (PL-R1).
import { t } from "../../i18n/format";
import { registerPage } from "../shell/pages";
import { PeoplePage } from "./PeoplePage";
import { PeopleToolbar, personIdOf } from "./PeopleToolbar";
import { PersonPage } from "./PersonPage";

registerPage("people", {
  title: () => t("people.title"),
  render: (route) => {
    const id = personIdOf(route.key);
    return id ? <PersonPage key={id} id={id} /> : <PeoplePage />;
  },
  toolbar: PeopleToolbar,
});
