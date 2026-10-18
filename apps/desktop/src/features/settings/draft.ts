import type { Settings, SettingsSection, SettingsUpdateArgs } from "../../core/bindings";

export type SectionKey = SettingsSection["section"] & keyof Settings;

/**
 * An open section draft holds only the user's edits. The section and `rev` are read from the
 * latest `settings:changed` when the value is shown or sent, so a Restore Defaults or a display
 * pick (which raise `rev`) cannot leave the draft on a stale `rev` and end in `conflict`.
 */
export interface SectionDraft<K extends SectionKey = SectionKey> {
  section: K;
  edits: Partial<Settings[K]>;
}

export const newDraft = <K extends SectionKey>(section: K): SectionDraft<K> => ({ section, edits: {} });

export const editDraft = <K extends SectionKey>(d: SectionDraft<K>, edits: Partial<Settings[K]>): SectionDraft<K> => ({
  ...d,
  edits: { ...d.edits, ...edits },
});

export const draftValue = <K extends SectionKey>(settings: Settings, d: SectionDraft<K>): Settings[K] => ({
  ...settings[d.section],
  ...d.edits,
});

/** The whole section as wanted state with the current `rev`. */
export const toUpdateArgs = (settings: Settings, d: SectionDraft): SettingsUpdateArgs => ({
  rev: settings.rev,
  section: { section: d.section, value: draftValue(settings, d) } as SettingsSection,
});
