import { describe, expect, it } from "vitest";

import type { CopilotSettings } from "../../core/bindings";
import { cardKeyRows } from "./card-keys";

const mods = { control: true, option: true, command: true };
const copilot = (over: Partial<CopilotSettings> & { enabled?: boolean } = {}): CopilotSettings =>
  ({ card_keys: { enabled: over.enabled ?? true, modifiers: mods }, dismiss_with_keys: over.dismiss_with_keys ?? false }) as CopilotSettings;

describe("cardKeyRows", () => {
  it("renders the card keys from settings.copilot.card_keys, in the pane's order", () => {
    const rows = cardKeyRows(copilot({ dismiss_with_keys: true }));
    expect(rows.map((r) => r.id)).toEqual(["pin", "dismiss", "undo"]);
    expect(rows[0]).toMatchObject({ variant: "modifier-set", modifiers: mods, disabled: false });
    expect(rows[1]).toMatchObject({ variant: "derived", modifiers: { ...mods, shift: true }, disabled: false });
    expect(rows[2]).toMatchObject({ variant: "single", modifiers: null, disabled: false });
  });

  it("disables Dismiss a card while Dismiss with keys is off", () => {
    expect(cardKeyRows(copilot()).map((r) => r.disabled)).toEqual([false, true, false]);
  });

  it("disables every card row while Use card keys during calls is off", () => {
    expect(cardKeyRows(copilot({ enabled: false, dismiss_with_keys: true })).map((r) => r.disabled)).toEqual([true, true, true]);
  });

  it("follows modifiers changed by a Restore Defaults", () => {
    const next = { card_keys: { enabled: true, modifiers: { control: false, option: false, command: true } }, dismiss_with_keys: false } as CopilotSettings;
    expect(cardKeyRows(next)[0]!.modifiers).toEqual({ control: false, option: false, command: true });
  });
});
