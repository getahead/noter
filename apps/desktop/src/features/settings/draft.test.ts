import { describe, expect, it } from "vitest";

import type { Settings } from "../../core/bindings";
import { draftValue, editDraft, newDraft, toUpdateArgs } from "./draft";

const base = {
  version: 3,
  rev: 5,
  copilot: { card_keys: { enabled: true, modifiers: { control: true, option: true, command: true } }, dismiss_with_keys: false },
  general: { launch_at_login: true },
} as unknown as Settings;

// What the core sends after Restore Defaults or a display pick: the whole slice, rev raised
const changed = (patch: object): Settings => ({ ...base, version: 4, rev: 6, ...patch }) as Settings;

describe("section draft", () => {
  it("is empty when opened and reads the stored section", () => {
    const d = newDraft("copilot");
    expect(draftValue(base, d)).toEqual(base.copilot);
  });

  it("overlays the user's edits on the stored section without touching it", () => {
    const d = editDraft(newDraft("copilot"), { dismiss_with_keys: true });
    expect(draftValue(base, d)).toEqual({ ...base.copilot, dismiss_with_keys: true });
    expect(base.copilot.dismiss_with_keys).toBe(false);
  });

  it("sends the whole section with the rev of the latest settings:changed", () => {
    const d = editDraft(newDraft("copilot"), { dismiss_with_keys: true });
    expect(toUpdateArgs(base, d).rev).toBe(5);
    // a Restore Defaults raised rev while the draft was open: no `conflict`
    expect(toUpdateArgs(changed({}), d)).toEqual({
      rev: 6,
      section: { section: "copilot", value: { ...base.copilot, dismiss_with_keys: true } },
    });
  });

  it("takes untouched fields from the latest settings, keeps the edited ones", () => {
    const d = editDraft(newDraft("copilot"), { dismiss_with_keys: true });
    const next = changed({ copilot: { ...base.copilot, card_keys: { enabled: false, modifiers: base.copilot.card_keys.modifiers } } });
    expect(draftValue(next, d)).toMatchObject({ card_keys: { enabled: false }, dismiss_with_keys: true });
  });

  it("accumulates edits", () => {
    const d = editDraft(editDraft(newDraft("general"), { a: 1 } as never), { b: 2 } as never);
    expect(d.edits).toEqual({ a: 1, b: 2 });
  });

  it("records nested edits as leaves, so a newer sibling leaf survives the rebase", () => {
    // the user flips only enablement; Restore Defaults changes the modifiers meanwhile
    const d = editDraft(newDraft("copilot"), { card_keys: { enabled: false } });
    expect(d.edits).toEqual({ card_keys: { enabled: false } });
    const mods = { control: false, option: false, command: true };
    const next = changed({ copilot: { ...base.copilot, card_keys: { enabled: true, modifiers: mods } } });
    expect(toUpdateArgs(next, d)).toEqual({
      rev: 6,
      section: { section: "copilot", value: { ...base.copilot, card_keys: { enabled: false, modifiers: mods } } },
    });
  });

  it("merges nested edits and lets a later edit of the same leaf win", () => {
    let d = editDraft(newDraft("copilot"), { card_keys: { enabled: false } });
    d = editDraft(d, { card_keys: { modifiers: { command: false } } });
    d = editDraft(d, { card_keys: { enabled: true } });
    expect(d.edits).toEqual({ card_keys: { enabled: true, modifiers: { command: false } } });
  });

  it("replaces arrays whole instead of merging them", () => {
    const d = editDraft(editDraft(newDraft("copilot"), { muted_call_types: ["a", "b"] } as never), { muted_call_types: ["c"] } as never);
    expect(d.edits).toEqual({ muted_call_types: ["c"] });
  });

  it("ignores an explicit undefined leaf instead of overwriting the stored value", () => {
    const d = editDraft(newDraft("copilot"), { card_keys: { enabled: undefined, modifiers: { command: false } } });
    expect(d.edits).toEqual({ card_keys: { modifiers: { command: false } } });
    expect(draftValue(base, d).card_keys.enabled).toBe(base.copilot.card_keys.enabled);
  });
});
