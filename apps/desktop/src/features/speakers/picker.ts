// Person picker matching and validation (DESIGN › Person picker; prototype src/js/20-b-components.js C.personPicker).
// Pure: the component owns the focus, the popover and the commands.
import type { PersonChip, PersonRef, PersonRow, SpeakerView } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";

export const CAP_INLINE = 5;
export const CAP_POPOVER = 8;
export const NAME_MAX = 80;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Entry {
  id: string;
  display_name: string;
  short_name: string;
  initials: string;
  /** Role or source line under the name. */
  caption: string;
  aliases?: string[];
}
export interface Group {
  key: "call" | "recent";
  entries: Entry[];
}

// @cpt-algo:cpt-noter-algo-ui-speakers-picker:p1
/** Case, ё/е and ß/ss equivalence. */
export function fold(s: string): string {
  // @cpt-begin:cpt-noter-algo-ui-speakers-picker:p1:inst-match
  return s.normalize("NFC").trim().toLowerCase().replaceAll("ё", "е").replaceAll("ß", "ss");
  // @cpt-end:cpt-noter-algo-ui-speakers-picker:p1:inst-match
}

/** The groups' entries that match `query` by name or alias, in the core's order, `cap` per group; empty groups drop out. */
export function matchPeople(query: string, groups: readonly Group[], cap: number): Group[] {
  // @cpt-begin:cpt-noter-algo-ui-speakers-picker:p1:inst-match
  // @cpt-begin:cpt-noter-algo-ui-speakers-picker:p1:inst-groups
  const q = fold(query);
  const hit = (e: Entry) => !q || [e.display_name, ...(e.aliases ?? [])].some((n) => fold(n).includes(q));
  return groups.map((g) => ({ key: g.key, entries: g.entries.filter(hit).slice(0, cap) })).filter((g) => g.entries.length > 0);
  // @cpt-end:cpt-noter-algo-ui-speakers-picker:p1:inst-groups
  // @cpt-end:cpt-noter-algo-ui-speakers-picker:p1:inst-match
}

export interface NewPerson {
  name: string;
  email: string;
}

/** The New form's inline errors (message keys) by field; none when the draft can go. */
export function validateNew({ name, email }: NewPerson): { name?: MsgKey; email?: MsgKey } {
  // @cpt-begin:cpt-noter-algo-ui-speakers-picker:p1:inst-validate
  const n = name.trim();
  const out: { name?: MsgKey; email?: MsgKey } = {};
  if (n.length < 1 || n.length > NAME_MAX) out.name = "speakers.new.name_required";
  if (email.trim() && !EMAIL.test(email.trim())) out.email = "speakers.new.email_invalid";
  return out;
  // @cpt-end:cpt-noter-algo-ui-speakers-picker:p1:inst-validate
}

const fromChip = (c: PersonChip, caption = ""): Entry => ({ id: c.id, display_name: c.display_name, short_name: c.short_name, initials: c.initials, caption });

/**
 * **In this call**: the call's participants, the people already naming its speakers and each speaker's suggestion;
 * **Recent people**: the core's `people_list` rows not in the first group (`null`: not implemented, no group).
 */
export function candidates(participants: readonly PersonChip[], speakers: readonly Pick<SpeakerView, "label" | "suggestion">[], people: readonly PersonRow[] | null): Group[] {
  const seen = new Map<string, Entry>();
  const add = (c: PersonChip, caption: string) => void (!c.is_you && !seen.has(c.id) && seen.set(c.id, fromChip(c, caption)));
  participants.forEach((c) => add(c, ""));
  speakers.forEach((s) => s.label.type === "person" && add(s.label.person, ""));
  speakers.forEach((s) => s.suggestion && add(s.suggestion, ""));
  const call = [...seen.values()];
  const recent = (people ?? []).filter((p) => !p.is_you && !seen.has(p.id)).map((p) => ({ ...fromChip(p), caption: p.role ?? "", aliases: p.aliases }));
  return [{ key: "call" as const, entries: call }, ...(people ? [{ key: "recent" as const, entries: recent }] : [])].filter((g) => g.entries.length);
}

/** The PersonRef the host command takes. */
export const existing = (e: Pick<Entry, "id">): PersonRef => ({ type: "existing", person_id: e.id });
export const created = ({ name, email }: NewPerson): PersonRef => ({ type: "new", display_name: name.trim(), email: email.trim() || null });

/** The command key of a speaker's rename (bridge.act). */
export const renameKey = (speakerId: string) => `speaker:rename:${speakerId}`;
