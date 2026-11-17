import { useEffect, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { CallTypeInfo, PersonRow, TagCount } from "../../core/bindings";
import { t } from "../../i18n/format";
import { Checkbox } from "../../ui/primitives/checkbox";
import { Popover } from "../../ui/primitives/popover";
import { PushButton } from "../../ui/primitives/push-button";
import { SearchField } from "../../ui/primitives/search-field";
import { datePreset, tokens, type FilterAction, type FilterState, type Group, type Lookups } from "./filters";

export interface Lists {
  people: PersonRow[];
  types: CallTypeInfo[];
  tags: TagCount[];
}
const EMPTY: Lists = { people: [], types: [], tags: [] };

/** The choices of the pop-ups: people, call types and the tags in use, each read once from the core. */
export function useLists(bridge: Bridge, refresh: unknown = 0): Lists {
  const [lists, setLists] = useState<Lists>(EMPTY);
  useEffect(() => {
    let live = true;
    const o = { screen: "library-calls" } as const;
    void Promise.all([
      bridge.act("people_list", "people_list", () => bridge.core.peopleList({}), o),
      bridge.act("call_types_list", "call_types_list", () => bridge.core.callTypesList({}), o),
      bridge.act("tags_list", "tags_list", () => bridge.core.tagsList({}), o),
    ]).then(([p, ty, tg]) => {
      if (live) setLists({ people: p.status === "ok" ? p.data.people : [], types: ty.status === "ok" ? ty.data.call_types : [], tags: tg.status === "ok" ? tg.data.tags : [] });
    });
    return () => void (live = false);
  }, [bridge, refresh]);
  return lists;
}

export const lookups = (l: Lists): Lookups => ({
  person: (id) => l.people.find((p) => p.id === id)?.short_name ?? id,
  type: (id) => l.types.find((c) => c.id === id)?.label ?? id,
});

const MENU_LABEL = { people: "filters.people", type: "filters.type", tags: "filters.tags", language: "filters.language", date: "filters.date" } as const;
type Menu = "people" | "type" | "tags" | "language" | "date" | null;
const LANGS = ["en", "ru", "de"];

// @cpt-component:cpt-noter-component-ui-filter-bar:p1
/** The filter bar: pop-ups and tokens over one filter state; Clear keeps the typed words. */
export function FilterBar({ state, lists, onAction, onRun }: { state: FilterState; lists: Lists; onAction: (a: FilterAction) => void; onRun: (words: string) => void }) {
  const [open, setOpen] = useState<Menu>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const toks = tokens(state, lookups(lists));
  const f = state.filter;
  const pick = (m: Exclude<Menu, null>) => (
    <button key={m} type="button" className="lb-fbtn" aria-expanded={open === m} onClick={(e) => (setAnchor(e.currentTarget), setOpen(open === m ? null : m))}>
      {t(MENU_LABEL[m])}
    </button>
  );
  const group = (g: Group, items: { value: string; label: string }[]) =>
    items.map((i) => <Checkbox key={i.value} label={i.label} checked={((f[g] ?? []) as string[]).includes(i.value)} onAction={() => onAction({ type: "toggle", group: g, value: i.value })} />);
  const today = new Date().toISOString().slice(0, 10);
  const preset = datePreset(f);
  return (
    <div data-region="LC-R2" className="lb-filterbar" role="search" aria-label={t("filters.label")}>
      <SearchField
        variant="tokens"
        placeholder={t("filters.search")}
        value={state.words}
        tokens={toks.map((k) => ({ label: k.label, kind: k.kind }))}
        onChange={(words) => onAction({ type: "words", words })}
        onEnter={onRun}
        onRemoveToken={(i) => toks[i] && onAction({ type: "remove", token: toks[i]! })}
      />
      {(["people", "type", "tags", "language", "date"] as const).map(pick)}
      <Checkbox label={t("filters.open_items")} checked={!!f.has_open_items} onAction={(on) => onAction({ type: "open_items", on })} />
      {toks.length > 0 && <PushButton label={t("filters.clear")} variant="quiet" size="small" onAction={() => onAction({ type: "clear" })} />}
      {open && (
        <Popover variant={open} anchor={anchor} width={280} label={t(MENU_LABEL[open])} onClose={() => setOpen(null)}>
          <div className="lb-pop">
            {open === "people" && group("people", lists.people.map((p) => ({ value: p.id, label: p.display_name })))}
            {open === "type" && group("call_types", lists.types.map((c) => ({ value: c.id, label: c.label })))}
            {open === "tags" && (lists.tags.length ? group("tags", lists.tags.map((g) => ({ value: g.tag, label: g.tag }))) : <p>{t("filters.no_tags")}</p>)}
            {open === "language" && group("languages", LANGS.map((l) => ({ value: l, label: l.toUpperCase() })))}
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
