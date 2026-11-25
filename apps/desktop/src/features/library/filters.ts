import type { CallFilter } from "../../core/bindings";
import { shiftDay, t } from "../../i18n/format";

export { shiftDay };

export interface FilterState {
  words: string;
  filter: CallFilter;
}
export const BLANK: FilterState = { words: "", filter: {} };

export type Group = "people" | "call_types" | "tags" | "languages";
export type DatePreset = "any" | "7d" | "30d" | "custom";
export type FilterAction =
  | { type: "toggle" | "add"; group: Group; value: string }
  | { type: "open_items"; on: boolean }
  | { type: "date"; preset: Exclude<DatePreset, "custom">; today: string }
  | { type: "date"; preset: "custom"; from: string; to: string }
  | { type: "words"; words: string }
  | { type: "remove"; token: Token }
  | { type: "clear" };

export interface Token {
  kind: Group | "date" | "open_items";
  value: string;
  label: string;
}
export interface Lookups {
  person: (id: string) => string;
  type: (id: string) => string;
}

const DAY = 86_400_000;
/** The date menu's choice a filter stands for; a range that is not a preset is Custom. */
export function datePreset(f: CallFilter): DatePreset {
  if (!f.from && !f.to) return "any";
  if (f.from && f.to) {
    const span = Math.round((Date.parse(f.to) - Date.parse(f.from)) / DAY);
    if (span === 6) return "7d";
    if (span === 29) return "30d";
  }
  return "custom";
}

// languages are `Lang` (a code or { code }); the filter only ever holds the three plain codes from the language pop-up
const withGroup = (f: CallFilter, group: Group, values: string[]): CallFilter => ({ ...f, [group]: values }) as CallFilter;
const has = (f: CallFilter, group: Group): string[] => (f[group] ?? []) as string[];

// @cpt-begin:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-set-value
/** One filter action: a value is set or removed once; several values of a group are alternatives, the groups combine. */
export function apply(s: FilterState, a: FilterAction): FilterState {
  const f = s.filter;
  switch (a.type) {
    case "toggle":
      return { ...s, filter: withGroup(f, a.group, has(f, a.group).includes(a.value) ? has(f, a.group).filter((v) => v !== a.value) : [...has(f, a.group), a.value]) };
    case "add":
      return has(f, a.group).includes(a.value) ? s : { ...s, filter: withGroup(f, a.group, [...has(f, a.group), a.value]) };
    case "open_items":
      return { ...s, filter: { ...f, has_open_items: a.on ? true : null } };
    case "words":
      return { ...s, words: a.words };
    case "date":
      // a range typed backwards is the same range the other way round; the core refuses from > to
      if (a.preset === "custom") return { ...s, filter: { ...f, from: a.from <= a.to ? a.from : a.to, to: a.from <= a.to ? a.to : a.from } };
      return { ...s, filter: { ...f, from: a.preset === "any" ? null : shiftDay(a.today, a.preset === "7d" ? -6 : -29), to: a.preset === "any" ? null : a.today } };
    // @cpt-begin:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-remove
    case "remove":
      return a.token.kind === "date" ? apply(s, { type: "date", preset: "any", today: "" }) : a.token.kind === "open_items" ? apply(s, { type: "open_items", on: false }) : apply(s, { type: "toggle", group: a.token.kind, value: a.token.value });
    // @cpt-end:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-remove
    // @cpt-begin:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-clear
    case "clear":
      return { words: s.words, filter: {} };
    // @cpt-end:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-clear
  }
}
// @cpt-end:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-set-value

// @cpt-begin:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-tokens
/** The tokens of a filter, in the order people, types, tags, languages, date, open items. */
export function tokens(s: FilterState, look: Lookups): Token[] {
  const f = s.filter;
  const out: Token[] = [
    ...has(f, "people").map((v): Token => ({ kind: "people", value: v, label: look.person(v) })),
    ...has(f, "call_types").map((v): Token => ({ kind: "call_types", value: v, label: look.type(v) })),
    ...has(f, "tags").map((v): Token => ({ kind: "tags", value: v, label: t("filters.tag_token", { tag: v }) })),
    ...has(f, "languages").map((v): Token => ({ kind: "languages", value: v, label: v.toUpperCase() })),
  ];
  const preset = datePreset(f);
  if (preset !== "any") out.push({ kind: "date", value: preset, label: preset === "7d" ? t("filters.last_7") : preset === "30d" ? t("filters.last_30") : t("filters.range", { from: f.from ?? "", to: f.to ?? "" }) });
  if (f.has_open_items) out.push({ kind: "open_items", value: "open", label: t("filters.open_items") });
  return out;
}
// @cpt-end:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-tokens

// Back from a call's page remounts the page: the filter and words stay for this window (not an app restart).
let held: FilterState = BLANK;
export const heldFilter = (): FilterState => held;
const watchers = new Set<() => void>();
// @cpt-begin:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-return
export const holdFilter = (s: FilterState): void => {
  held = s;
  watchers.forEach((w) => w());
};
// @cpt-end:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-return
/** A change made outside the Calls page (a # tag choice in the toolbar field). */
export const watchFilter = (w: () => void): (() => void) => (watchers.add(w), () => void watchers.delete(w));


/** Reads the list again once per filter change: the page's own change and the watcher both land here, so the same filter never reads twice (words alone never read). */
// @cpt-begin:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-read
export function syncFilter(read: (f: CallFilter) => void, start: CallFilter): (s: FilterState) => void {
  let last = start;
  return (s) => {
    if (s.filter === last) return;
    last = s.filter;
    read(s.filter);
  };
}
// @cpt-end:cpt-noter-algo-ui-library-search-topics-filters:p1:inst-read

/** Whether any filter group narrows the list. */
export const isFiltered = (f: CallFilter): boolean => Object.values(f).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));

/** One action on the held state: the next state and whether the list must be read again (words alone never re-read it). */
export function reconcile(s: FilterState, a: FilterAction): { next: FilterState; reread: boolean } {
  const next = apply(s, a);
  return { next, reread: next.filter !== s.filter };
}
