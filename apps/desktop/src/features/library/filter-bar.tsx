import { useEffect, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { CallTypeInfo, PersonRow, TagCount } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Checkbox } from "../../ui/primitives/checkbox";
import { Popover } from "../../ui/primitives/popover";
import { PushButton } from "../../ui/primitives/push-button";
import { Icon } from "../../ui/icons";
import { SearchField } from "../../ui/primitives/search-field";
import { datePreset, tokens, type FilterAction, type FilterState, type Group, type Lookups } from "./filters";

export interface Lists {
  people: PersonRow[];
  types: CallTypeInfo[];
  tags: TagCount[];
}
const EMPTY: Lists = { people: [], types: [], tags: [] };

/** The three reads behind the pop-ups; a read that fails leaves its list empty. */
export async function readLists(bridge: Bridge): Promise<Lists> {
  const o = { screen: "library-calls" } as const;
  const [p, ty, tg] = await Promise.all([
    bridge.act("people_list", "people_list", () => bridge.core.peopleList({}), o),
    bridge.act("call_types_list", "call_types_list", () => bridge.core.callTypesList({}), o),
    bridge.act("tags_list", "tags_list", () => bridge.core.tagsList({}), o),
  ]);
  return { people: p.status === "ok" ? p.data.people : [], types: ty.status === "ok" ? ty.data.call_types : [], tags: tg.status === "ok" ? tg.data.tags : [] };
}

/** The choices of the pop-ups: people, call types and the tags in use, read again when `refresh` changes. */
export function useLists(bridge: Bridge, refresh: unknown = 0): Lists {
  const [lists, setLists] = useState<Lists>(EMPTY);
  useEffect(() => {
    let live = true;
    void readLists(bridge).then((l) => live && setLists(l));
    return () => void (live = false);
  }, [bridge, refresh]);
  return lists;
}

export const lookups = (l: Lists): Lookups => ({
  person: (id) => l.people.find((p) => p.id === id)?.short_name ?? id,
  type: (id) => l.types.find((c) => c.id === id)?.label ?? id,
});

const MENU_LABEL = { people: "filters.people", type: "filters.type", tags: "filters.tags", language: "filters.language", date: "filters.date" } as const;
const LANG_NAME: Record<string, string> = { en: t("settings.general.lang_en"), ru: t("settings.general.lang_ru"), de: t("settings.general.lang_de") };
type Menu = "people" | "type" | "tags" | "language" | "date" | null;
const LANGS = ["en", "ru", "de"];

// @cpt-component:cpt-noter-component-ui-filter-bar:p1
/** The filter bar: pop-ups and tokens over one filter state; Clear keeps the typed words. */
export function FilterBar({ state, lists, onAction }: { state: FilterState; lists: Lists; onAction: (a: FilterAction) => void }) {
  const [open, setOpen] = useState<Menu>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const toks = tokens(state, lookups(lists));
  const f = state.filter;
  const GROUP = { people: "people", type: "call_types", tags: "tags", language: "languages" } as const;
  const pick = (m: Exclude<Menu, null>) => {
    const held = m === "date" ? [] : ((f[GROUP[m]] ?? []) as string[]);
    const first = m === "people" ? lookups(lists).person(held[0] ?? "") : m === "type" ? lookups(lists).type(held[0] ?? "") : m === "language" ? LANG_NAME[held[0] ?? ""] ?? "" : held[0] ?? "";
    const value = m === "date" ? (preset === "any" ? "" : toks.find((k) => k.kind === "date")?.label ?? "") : held.length ? (held.length > 1 ? `${first} +${held.length - 1}` : first) : "";
    return (
      <button key={m} type="button" className="lb-fbtn" aria-expanded={open === m} onClick={(e) => (setAnchor(e.currentTarget), setOpen(open === m ? null : m))}>
        {t(MENU_LABEL[m])}{value && <span className="np-dim"> {value}</span>}
        <Icon name="updown" size={11} cls="lb-fchev" />
      </button>
    );
  };
  const group = (g: Group, items: { value: string; label: string }[]) =>
    items.map((i) => <Checkbox key={i.value} label={i.label} checked={((f[g] ?? []) as string[]).includes(i.value)} onAction={() => onAction({ type: "toggle", group: g, value: i.value })} />);
  const people = <PeopleList lists={lists} held={(f.people ?? []) as string[]} onAction={onAction} />;
  const today = new Date().toISOString().slice(0, 10);
  const preset = datePreset(f);
  return (
    <div data-region="LC-R2" className="lb-filterbar" role="search" aria-label={t("filters.label")}>
      {toks.map((k, i) => k.kind === "open_items" ? null : (
        <span key={`${k.kind}:${k.value}`} className="np-token" data-token-kind={k.kind}>
          {k.label}
          <button type="button" className="np-token__x" aria-label={t("search.remove_token", { label: k.label })} onClick={() => onAction({ type: "remove", token: toks[i]! })}>
            <Icon name="x" size={9} />
          </button>
        </span>
      ))}
      {(["people", "type", "tags", "language", "date"] as const).map(pick)}
      <button type="button" className="lb-fbtn" aria-pressed={!!f.has_open_items} onClick={() => onAction({ type: "open_items", on: !f.has_open_items })}>{t("filters.open_items_toggle")}</button>
      {toks.length > 0 && <PushButton label={t("filters.clear")} variant="quiet" size="small" onAction={() => onAction({ type: "clear" })} />}
      {open && (
        <Popover variant={open} anchor={anchor} width={280} label={t(MENU_LABEL[open])} onClose={() => setOpen(null)}>
          <div className="lb-pop">
            {open === "people" && people}
            {open === "type" && group("call_types", lists.types.map((c) => ({ value: c.id, label: c.label })))}
            {open === "tags" && (lists.tags.length ? group("tags", lists.tags.map((g) => ({ value: g.tag, label: g.tag }))) : <p>{t("filters.no_tags")}</p>)}
            {open === "language" && group("languages", LANGS.map((l) => ({ value: l, label: LANG_NAME[l]! })))}
            {open === "date" && (
              <>
                {(["any", "7d", "30d"] as const).map((p) => (
                  <Checkbox key={p} label={p === "any" ? t("filters.any_time") : p === "7d" ? t("filters.last_7") : t("filters.last_30")} checked={preset === p} onAction={() => onAction({ type: "date", preset: p, today })} />
                ))}
                <label>{t("filters.from")}<input type="date" value={f.from ?? ""} onChange={(e) => onAction({ type: "date", preset: "custom", from: e.target.value, to: f.to ?? e.target.value })} /></label>
                <label>{t("filters.to")}<input type="date" value={f.to ?? ""} onChange={(e) => onAction({ type: "date", preset: "custom", from: f.from ?? e.target.value, to: e.target.value })} /></label>
              </>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}

/** The People filter (DESIGN: a menu headed People, a search field, one checkbox per person sorted by locale; you are not listed). */
export function PeopleList({ lists, held, onAction }: { lists: Lists; held: string[]; onAction: (a: FilterAction) => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const people = lists.people.filter((p) => !p.is_you && (!q || [p.display_name, ...p.aliases].some((n) => n.toLowerCase().includes(q)))).sort((a, b) => a.display_name.localeCompare(b.display_name));
  return (
    <>
      <strong>{t("filters.people")}</strong>
      <SearchField placeholder={t("filters.people_search")} value={query} onChange={setQuery} />
      {people.map((p) => (
        <Checkbox key={p.id} label={p.display_name} checked={held.includes(p.id)} onAction={() => onAction({ type: "toggle", group: "people", value: p.id })} />
      ))}
    </>
  );
}
