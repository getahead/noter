// PL-R1: People's toolbar: the shell's toolbar with the count and a search field of its own in place of the global one.
import { t } from "../../i18n/format";
import { SearchField } from "../../ui/primitives/search-field";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";
import { setPeopleQuery, usePeopleQuery } from "./model";
import { useCount } from "./count";

// @cpt-component:cpt-noter-component-screen-people:p1
export function PeopleToolbar({ base }: PageToolbarProps) {
  const query = usePeopleQuery();
  const count = useCount();
  // @cpt-begin:cpt-noter-flow-ui-people-prepare:p1:inst-search
  const field = <SearchField id="pl-search" cls="pe-search" placeholder={t("people.search")} ariaLabel={t("people.search")} value={query} onChange={setPeopleQuery} />;
  // @cpt-end:cpt-noter-flow-ui-people-prepare:p1:inst-search
  const subtitle = count === null ? undefined : count ? t("people.subtitle", { count }) : t("people.subtitle_empty");
  return <MainToolbar {...base} region="PL-R1" title={t("people.title")} subtitle={subtitle} hasSearch={false} trailing={field} />;
}
