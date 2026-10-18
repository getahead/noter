// M0 — Settings window › Hotkeys (DESIGN.md 3.6, stories-b). One test per story path.
// Contract-level today; the Hotkeys pane steps (field focus, "Type a shortcut…", the search
// field) are added when the Settings window lands (docs/TEST-PLAN.md › M0).
import type { HotkeyAction, HotkeyList } from "../../src/core/bindings";
import { ok, refused, until } from "../support/results";
import { changeAhead, expect, test, versionsGrow } from "./support/fixtures";

const chord = (list: HotkeyList, action: HotkeyAction) => list.bindings.find((b) => b.action === action);

test.describe("cpt-noter-seq-settings-set-hotkeys", () => {
  test("happy path: Catch me up ⌃⌥⌘C changed to ⌃⌥⌘U, shown everywhere the chord appears", async ({ scenario }) => {
    const settings = scenario.core("settings");
    const changes = await scenario.events("hotkeys:changed");

    const list = ok(await settings.hotkeysList({}));
    expect(new Set(list.bindings.map((b) => b.action)).size).toBe(list.bindings.length); // one row per global action
    expect(chord(list, "catch_me_up")?.shortcut).toBe("Ctrl+Alt+Super+C");

    const updated = ok(await settings.hotkeySet({ action: "catch_me_up", shortcut: "Ctrl+Alt+Super+U" }));
    expect(chord(updated, "catch_me_up")).toMatchObject({ shortcut: "Ctrl+Alt+Super+U", status: { type: "registered" } });
    await until(() => changes.latest() && chord(changes.latest()!, "catch_me_up")?.shortcut === "Ctrl+Alt+Super+U", "hotkeys:changed with the new chord");
    expect(changes.latest()!.version).toBeGreaterThan(list.version);
    expect(versionsGrow(changes.all)).toBe(true);
    // The menu bar menu and the call screen's button read the same list.
    expect(chord(ok(await settings.hotkeysList({})), "catch_me_up")?.shortcut).toBe("Ctrl+Alt+Super+U");
  });

  test("error path — Shortcut used by VoiceOver: Used by VoiceOver, another chord is accepted", async ({ scenario }) => {
    const settings = scenario.core("settings");
    await scenario.failNext("settings", "hotkey_set", "hotkey_reserved", { type: "hotkey_owner", owner: "VoiceOver" }); // VoiceOver is running

    const clash = refused(await settings.hotkeySet({ action: "mark_moment", shortcut: "Ctrl+Alt+Super+H" }));
    expect(clash.code).toBe("hotkey_reserved");
    expect(clash.detail).toEqual({ type: "hotkey_owner", owner: "VoiceOver" });
    expect(chord(ok(await settings.hotkeysList({})), "mark_moment")?.shortcut).toBe("Ctrl+Alt+Super+M"); // nothing changed

    const accepted = ok(await settings.hotkeySet({ action: "mark_moment", shortcut: "Ctrl+Alt+Super+J" }));
    expect(chord(accepted, "mark_moment")).toMatchObject({ shortcut: "Ctrl+Alt+Super+J", status: { type: "registered" } });
  });

  test("error path — Card key used by another app: the warning, fixed in Raycast, gone on return", async ({ scenario }) => {
    if (!(await changeAhead(scenario, "M4", (w) => (w.copilot.card_keys.conflicts = ["Ctrl+Alt+Super+3"])))) return; // card keys are the copilot's (M4)
    const settings = scenario.core("settings");
    const status = await scenario.events("copilot:status");

    const shown = ok(await settings.appSnapshot({}));
    expect(shown.copilot?.card_keys.conflicts).toEqual(["Ctrl+Alt+Super+3"]); // ⌃⌥⌘3 is used by another app

    await scenario.change((w) => (w.copilot.card_keys.conflicts = [])); // a different shortcut chosen in Raycast
    await until(() => status.latest()?.card_keys.conflicts.length === 0, "copilot:status without the conflict");
    expect(ok(await settings.appSnapshot({})).copilot?.card_keys.conflicts).toEqual([]); // no warning on return
  });

  test("error path — Shortcut without a modifier: Add Command, Option or Control, then ⌃⌥⌘O", async ({ scenario }) => {
    const settings = scenario.core("settings");

    const bare = refused(await settings.hotkeySet({ action: "open_call_screen", shortcut: "N" }));
    expect(bare.code).toBe("invalid_input");
    expect(bare.detail).toEqual({ type: "validation", field: "shortcut", rule: "no_modifier" });
    expect(bare.retryable).toBe(false);
    expect(chord(ok(await settings.hotkeysList({})), "open_call_screen")?.shortcut).toBe("Ctrl+Alt+Super+N");

    const fixed = ok(await settings.hotkeySet({ action: "open_call_screen", shortcut: "Ctrl+Alt+Super+O" }));
    expect(chord(fixed, "open_call_screen")?.shortcut).toBe("Ctrl+Alt+Super+O"); // beside Open Call Screen in the menu
  });

  test("empty path — No setting matches the search: the Hotkeys pane holds the same shortcuts for every call app", async ({ scenario }) => {
    const settings = scenario.core("settings");
    // The search itself is UI-only; what the pane shows after × comes from these reads.
    const all = ok(await settings.settingsGet({}));
    expect(all.rev).toBeGreaterThan(0);
    const list = ok(await settings.hotkeysList({}));
    expect(list.bindings.every((b) => b.shortcut === null || /^(Ctrl|Alt|Super|Shift)\+/.test(b.shortcut))).toBe(true);
    // Restore Defaults after experimenting gives every chord back.
    ok(await settings.hotkeySet({ action: "pause", shortcut: "Ctrl+Alt+Super+Y" }));
    const reset = ok(await settings.hotkeysReset({}));
    expect(reset.bindings.every((b) => b.shortcut === b.default_shortcut)).toBe(true);
  });
});
