// PL-R1 / PE toolbar: People's own search field and count; on a person's page their name, the view control and no search.
import { t } from "../../i18n/format";
import { SearchField } from "../../ui/primitives/search-field";
import { SegmentedControl } from "../../ui/primitives/segmented-control";
import type { PageToolbarProps } from "../shell/pages";
import { MainToolbar } from "../shell/toolbar";
import { useState } from "react";

import { IconButton } from "../../ui/primitives/icon-button";
import { Menu } from "../../ui/primitives/menu";
import { Popover } from "../../ui/primitives/popover";
import { PullDownButton } from "../../ui/primitives/pull-down-button";
import { usePeopleHeld } from "./count";
import { AddPersonPopover, setAddPerson } from "./add-person";
import { setPeopleQuery, usePeopleQuery } from "./model";
import { setPersonNotice, setPersonTab, usePersonHeld, usePersonTab, type PersonTab } from "./person-store";
import { confirmDelete, confirmDeleteProfile, usePeopleSheets } from "./sheets";

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

function PersonToolbar({ base, bridge, id }: PageToolbarProps & { id: string }) {
  const tab = usePersonTab(id);
  const sheets = usePeopleSheets();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const held = usePersonHeld();
  const person = held?.person.id === id ? held.person : null;
  const control = <SegmentedControl items={TABS.map((x) => ({ value: x.value, label: t(x.label) }))} value={tab} label={t("person.view")} onAction={(v) => setPersonTab(id, v as PersonTab)} />;
  // @cpt-begin:cpt-noter-state-ui-people-view:p1:inst-edit
  // @cpt-begin:cpt-noter-state-ui-people-view:p1:inst-merge
  // @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-edit-sheet
  // @cpt-begin:cpt-noter-flow-ui-people-edit-merge:p1:inst-merge-open
  const more = person && (
    <>
      <PullDownButton id="pe-more" iconOnly icon="ellipsis" label={t("person.more")} ariaLabel={t("person.more")} variant="item-menu" size="toolbar" open={menu !== null} onAction={() => setMenu(menu ? null : globalThis.document?.getElementById("pe-more") ?? null)} />
      {menu && (
        <Popover variant="item-menu" anchor={menu} align="end" label={t("person.more")} onClose={() => setMenu(null)}>
          <Menu
            onClose={() => setMenu(null)}
            items={[
              { label: t("person.edit"), onSelect: () => (setMenu(null), sheets.open("person-edit", { bridge, person })) },
              ...(person.voice_profile ? [{ label: t("person.voice_delete"), onSelect: () => (setMenu(null), setPersonNotice(null), void confirmDeleteProfile(bridge, person, setPersonNotice)) }] : []),
              ...(person.is_you ? [] : [
                { label: t("person.merge_with"), onSelect: () => (setMenu(null), sheets.open("person-merge", { bridge, source: person })) },
                { divider: true as const },
                { label: t("person.delete"), destructive: true, onSelect: () => (setMenu(null), setPersonNotice(null), void confirmDelete(bridge, person, setPersonNotice)) },
              ]),
            ]}
          />
        </Popover>
      )}
    </>
  );
  // @cpt-end:cpt-noter-flow-ui-people-edit-merge:p1:inst-merge-open
  // @cpt-end:cpt-noter-flow-ui-people-edit-merge:p1:inst-edit-sheet
  // @cpt-end:cpt-noter-state-ui-people-view:p1:inst-merge
  // @cpt-end:cpt-noter-state-ui-people-view:p1:inst-edit
  return <MainToolbar {...base} region="PE-R1" title={person?.short_name ?? t("people.title")} subtitle={person?.role ?? undefined} hasSearch={false} center={control} trailing={more} />;
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
