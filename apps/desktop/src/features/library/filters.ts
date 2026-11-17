import type { CallFilter } from "../../core/bindings";
import { t } from "../../i18n/format";

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
/** `day` (YYYY-MM-DD) moved by `by` days; whole UTC days, so a DST change never shifts it. */
export const shiftDay = (day: string, by: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY).toISOString().slice(0, 10);

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
      if (a.preset === "custom") return { ...s, filter: { ...f, from: a.from, to: a.to } };
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
export const holdFilter = (s: FilterState): void => void (held = s);

/** How many filter groups narrow the list. */
export const activeCount = (s: FilterState): number => tokens(s, { person: (i) => i, type: (i) => i }).length;
