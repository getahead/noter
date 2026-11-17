// PL-R1 / PE toolbar: People's own search field and count; on a person's page their name, the view control and no search.
import { t } from "../../i18n/format";
import { SearchField } from "../../ui/primitives/search-field";
import { SegmentedControl } from "../../ui/primitives/segmented-control";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";
import { useState } from "react";

import { IconButton } from "../../ui/primitives/icon-button";
import { usePeopleHeld } from "./count";
import { AddPersonPopover, setAddPerson } from "./add-person";
import { setPeopleQuery, usePeopleQuery } from "./model";
import { setPersonTab, usePersonHeld, usePersonTab, type PersonTab } from "./person-store";

/** The person id of a `person:<id>` route key. */
export const personIdOf = (key: string): string | null => (key.startsWith("person:") ? key.slice("person:".length) : null);

const TABS: { value: PersonTab; label: "person.tab.overview" | "person.tab.calls" | "person.tab.history" }[] = [
  { value: "overview", label: "person.tab.overview" },
  { value: "calls", label: "person.tab.calls" },
  { value: "history", label: "person.tab.history" },
];

// @cpt-component:cpt-noter-component-screen-people:p1
export function PeopleToolbar(props: PageToolbarProps) {
  const id = personIdOf(props.route.key);
  return id ? <PersonToolbar {...props} id={id} /> : <ListToolbar {...props} />;
}

function PersonToolbar({ base, id }: PageToolbarProps & { id: string }) {
  const tab = usePersonTab(id);
  const held = usePersonHeld();
  const person = held?.person.id === id ? held.person : null;
  const control = <SegmentedControl items={TABS.map((x) => ({ value: x.value, label: t(x.label) }))} value={tab} label={t("person.view")} onAction={(v) => setPersonTab(id, v as PersonTab)} />;
  return <MainToolbar {...base} region="PE-R1" title={person?.short_name ?? t("people.title")} subtitle={person?.role ?? undefined} hasSearch={false} center={control} />;
}

function ListToolbar({ base, bridge }: PageToolbarProps) {
  const query = usePeopleQuery();
  const count = usePeopleHeld()?.length ?? null;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  // @cpt-begin:cpt-noter-flow-ui-people-prepare:p1:inst-search
  const field = <SearchField id="pl-search" cls="pe-search" placeholder={t("people.search")} ariaLabel={t("people.search")} value={query} onChange={setPeopleQuery} />;
  // @cpt-end:cpt-noter-flow-ui-people-prepare:p1:inst-search
  const trailing = (
    <>
      <span ref={setAnchor}>
        <IconButton id="pl-add" icon="plus" label={t("people.add")} onAction={() => setAddPerson(true)} />
      </span>
      <AddPersonPopover bridge={bridge} anchor={anchor} />
      {field}
    </>
  );
  const subtitle = count === null ? undefined : count ? t("people.subtitle", { count }) : t("people.subtitle_empty");
  return <MainToolbar {...base} region="PL-R1" title={t("people.title")} subtitle={subtitle} hasSearch={false} trailing={trailing} />;
}
