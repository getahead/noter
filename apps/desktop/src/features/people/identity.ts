// The identity rules of People (docs/features/ui/people.md): matching, ordering and which rows a query leaves.
import type { PeopleList, PersonRow, UnnamedSpeaker } from "../../core/bindings";
import { locale, t } from "../../i18n/format";
import { fold } from "../speakers/picker";

// @cpt-algo:cpt-noter-algo-ui-people-identity:p1
// @cpt-begin:cpt-noter-algo-ui-people-identity:p1:inst-match
export { fold };

export const matches = (p: Pick<PersonRow, "display_name" | "short_name" | "aliases">, query: string): boolean => {
  const q = fold(query.trim());
  return !q || [p.display_name, p.short_name, ...p.aliases].some((n) => fold(n).includes(q));
};
// @cpt-end:cpt-noter-algo-ui-people-identity:p1:inst-match

// @cpt-begin:cpt-noter-algo-ui-people-identity:p1:inst-sort
export const sortPeople = (rows: readonly PersonRow[]): PersonRow[] => {
  const collator = new Intl.Collator(locale());
  return [...rows].sort((a, b) => collator.compare(a.short_name, b.short_name));
};
// @cpt-end:cpt-noter-algo-ui-people-identity:p1:inst-sort

export interface PeopleView {
  status: "EMPTY" | "NO_MATCH" | "LISTED";
  rows: PersonRow[];
  unnamed: UnnamedSpeaker[];
}

// @cpt-begin:cpt-noter-state-ui-people-view:p1:inst-list-result
// @cpt-begin:cpt-noter-algo-ui-people-identity:p1:inst-empty
// @cpt-begin:cpt-noter-algo-ui-people-identity:p1:inst-unnamed
/** The rows a read leaves under a query: You never lists, unnamed rows stay keyed by call and speaker id (never by their number). */
export function view(read: PeopleList, query: string): PeopleView {
  const everyone = read.people.filter((p) => !p.is_you);
  const rows = sortPeople(everyone.filter((p) => matches(p, query)));
  const unnamed = read.unnamed.filter((u) => matches({ display_name: t("people.unnamed_label", { n: u.n }), short_name: "", aliases: [] }, query));
  return { status: !everyone.length ? "EMPTY" : rows.length ? "LISTED" : "NO_MATCH", rows, unnamed };
}
// @cpt-end:cpt-noter-algo-ui-people-identity:p1:inst-unnamed
// @cpt-end:cpt-noter-algo-ui-people-identity:p1:inst-empty
// @cpt-end:cpt-noter-state-ui-people-view:p1:inst-list-result

// @cpt-begin:cpt-noter-flow-ui-people-name:p1:inst-duplicate
/** A person the typed name may already be: the same full or short name, or a lone first name ("Lena" for Lena K.). The core keeps the final say. */
export function possibleDuplicate(people: readonly PersonRow[] | null, name: string): PersonRow | undefined {
  const q = fold(name.trim());
  if (!q) return undefined;
  const lone = !q.includes(" ");
  return people?.find((p) => [p.display_name, p.short_name].some((n) => fold(n) === q) || (lone && fold(p.display_name).split(" ")[0] === q));
}
// @cpt-end:cpt-noter-flow-ui-people-name:p1:inst-duplicate
