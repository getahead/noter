import type { Settings, SettingsSection, SettingsUpdateArgs } from "../../core/bindings";

export type SectionKey = SettingsSection["section"] & keyof Settings;

/**
 * An open section draft holds only the user's edits. The section and `rev` are read from the
 * latest `settings:changed` when the value is shown or sent, so a Restore Defaults or a display
 * pick (which raise `rev`) cannot leave the draft on a stale `rev` and end in `conflict`.
 */
export interface SectionDraft<K extends SectionKey = SectionKey> {
  section: K;
  edits: DeepPartial<Settings[K]>;
}

/** Edits go down to the leaf the user touched, so a newer value of a sibling leaf is never overwritten. */
export type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// shortcut: arrays are replaced whole, not merged; fine while no section edits a list element by element
function merge<T>(base: T, edits: unknown): T {
  if (!isPlain(base) || !isPlain(edits)) return edits as T;
  const out: Record<string, unknown> = { ...base };
  // an explicit `undefined` is an untouched leaf: it never overwrites a stored value
  for (const [k, v] of Object.entries(edits)) if (v !== undefined) out[k] = k in base ? merge(base[k], v) : v;
  return out as T;
}

export const newDraft = <K extends SectionKey>(section: K): SectionDraft<K> => ({ section, edits: {} as DeepPartial<Settings[K]> });

export const editDraft = <K extends SectionKey>(d: SectionDraft<K>, edits: DeepPartial<Settings[K]>): SectionDraft<K> => ({
  ...d,
  edits: merge(d.edits, edits),
});

export const draftValue = <K extends SectionKey>(settings: Settings, d: SectionDraft<K>): Settings[K] => merge(settings[d.section], d.edits);

/** The whole section as wanted state with the current `rev`. */
export const toUpdateArgs = (settings: Settings, d: SectionDraft): SettingsUpdateArgs => ({
  rev: settings.rev,
  section: { section: d.section, value: draftValue(settings, d) } as SettingsSection,
});
