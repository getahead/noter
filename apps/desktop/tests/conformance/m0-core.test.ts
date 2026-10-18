// ADR-0002 behaviour rules checked with M0 commands only (harness/milestones.toml [M0]), so a
// core that answers just the M0 milestone passes every assertion here with nothing pending.
// The M0 steps of m0-m1-rules.test.ts sit next to M1 steps; these cover the M0 commands that
// otherwise only run beside an M1 command: stream_ack, stream_unsubscribe, settings_update,
// settings_unignore_app, hotkeys_reset and banner_dismiss (.plans/core-harness.md §5).
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_RETRYABLE, ERROR_CODES, type CommandName, type CoreError, type SelfTestMsg, type WindowLabel } from "../../src/core/bindings";
import { exercised } from "../support/core";
import { ok, refused, until } from "../support/results";
import { openScenario, type Scenario } from "../support/scenario";
import * as W from "../support/world-presets";

let s: Scenario;
beforeEach(() => {
  s = openScenario({ alsoRecord: exercised });
});
afterEach(async () => {
  await s.dispose();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function typed(e: CoreError, code: string): void {
  expect(e.code).toBe(code);
  expect(ERROR_CODES as readonly string[]).toContain(e.code);
  expect(typeof e.message).toBe("string");
  expect(e.retryable).toBe(DEFAULT_RETRYABLE.includes(e.code));
}

describe("window scope of M0 commands with valid arguments: refused, and nothing changes", () => {
  const cases: Array<[CommandName, WindowLabel, unknown]> = [
    ["hotkey_set", "main", { action: "pause", shortcut: "Ctrl+Alt+Super+Y" }],
    ["hotkeys_reset", "call-screen", {}],
    ["settings_update", "main", { rev: 1, section: { section: "menu_bar", value: {} } }],
    ["settings_unignore_app", "main", { bundle_id: "com.spotify.client" }],
    ["setup_set_audio_storage", "settings", { never_store_audio: true, retention: "never_store" }],
    ["setup_set_step", "settings", { step: "assistants", state: "done" }],
    ["banner_dismiss", "call-screen", { banner: "update_ready" }],
    ["models_download", "main", { action: "pause" }],
    ["glossary_remove", "main", { id: "gls_missing" }],
  ];
  it.each(cases)("%s from %s", async (cmd, window, args) => {
    const before = ok(await s.core("main").appSnapshot({}));
    const settings = ok(await s.core("settings").settingsGet({}));
    const keys = ok(await s.core("settings").hotkeysList({}));
    const client = s.core(window) as unknown as Record<string, (a: unknown) => Promise<{ status: string; error?: CoreError }>>;
    const method = Object.keys(client).find((k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`) === cmd);
    if (!method) throw new Error(`no client method for ${cmd}`);
    const res = await client[method](args);
    expect(res.status).toBe("error");
    expect(res.error?.code).toBe("window_not_allowed");
    const after = ok(await s.core("main").appSnapshot({}));
    expect(after.setup.version).toBe(before.setup.version);
    expect(after.banners).toEqual(before.banners);
    expect(ok(await s.core("settings").settingsGet({})).rev).toBe(settings.rev);
    expect(ok(await s.core("settings").hotkeysList({}))).toEqual(keys);
  });
});

describe("self-test stream (R23/R24)", () => {
  it("starts at seq 1, takes stream_ack, and sends nothing after stream_unsubscribe", async () => {
    await s.change(W.idle);
    const settings = s.core("settings");
    const got: SelfTestMsg[] = [];
    // D6 ordering (Channel messages only after the subscribing command's result) is proven on the
    // wire, where it can be observed: crates/noter-core-harness/tests/wire.rs
    // `channel_messages_follow_result_in_seq_order` (PR #26). Here StdioCore hands lines over in order, but
    // readline emits a chunk's lines before the result's promise continuation runs, so the client
    // cannot tell the two apart.
    const sub = ok(await settings.selfTestRun({ play_clip: false }, (m) => got.push(m)));
    await until(() => got.length >= 1, "the first self-test message");
    expect(got[0].seq).toBe(1);
    ok(await settings.streamAck({ subscription_id: sub.subscription_id, seq: got.at(-1)!.seq }));
    ok(await settings.streamUnsubscribe({ subscription_id: sub.subscription_id }));
    const n = got.length;
    await sleep(2000); // longer than the whole self-test of the fake and of the scripted engine
    expect(got.length).toBe(n);
    expect(got.some((m) => m.event.type === "ended")).toBe(false);
  });
});

describe("settings with revisions and whole-state events (R25)", () => {
  it("settings_update replaces one section with rev; a stale rev is conflict with current_rev; settings:changed grows", async () => {
    const settings = s.core("settings");
    const changes = await s.events("settings:changed");
    const current = ok(await settings.settingsGet({}));
    const section = { section: "menu_bar", value: current.menu_bar } as const;
    const updated = ok(await settings.settingsUpdate({ rev: current.rev, section }));
    expect(updated.rev).toBe(current.rev + 1);
    expect(updated.menu_bar).toEqual(current.menu_bar);
    const stale = refused(await settings.settingsUpdate({ rev: current.rev, section }));
    typed(stale, "conflict");
    expect(stale.detail).toEqual({ type: "conflict", current_rev: current.rev + 1 });
    await until(() => changes.latest(), "settings:changed");
    expect(changes.latest()!.version).toBeGreaterThan(current.version);
    expect(changes.latest()!.rev).toBe(updated.rev);
  });

  it("settings_unignore_app removes Spotify from the ignored apps once; a second time is not_found", async () => {
    const settings = s.core("settings");
    const before = ok(await settings.settingsGet({}));
    expect(before.general.ignored_apps.some((a) => a.bundle_id === "com.spotify.client")).toBe(true);
    const after = ok(await settings.settingsUnignoreApp({ bundle_id: "com.spotify.client" }));
    expect(after.general.ignored_apps.some((a) => a.bundle_id === "com.spotify.client")).toBe(false);
    expect(after.rev).toBe(before.rev + 1);
    typed(refused(await settings.settingsUnignoreApp({ bundle_id: "com.spotify.client" })), "not_found");
  });

  it("hotkeys_reset restores every default chord; hotkeys:changed grows", async () => {
    const settings = s.core("settings");
    const changes = await s.events("hotkeys:changed");
    const list = ok(await settings.hotkeysList({}));
    const changed = ok(await settings.hotkeySet({ action: "catch_me_up", shortcut: "Ctrl+Alt+Super+U" }));
    expect(changed.bindings.find((b) => b.action === "catch_me_up")?.shortcut).toBe("Ctrl+Alt+Super+U");
    const reset = ok(await settings.hotkeysReset({}));
    reset.bindings.forEach((b) => expect(b.shortcut, b.action).toBe(b.default_shortcut));
    await until(() => changes.all.length >= 2, "hotkeys:changed for the set and the reset");
    changes.all.forEach((p, i) => expect(p.version).toBeGreaterThan(i === 0 ? list.version : changes.all[i - 1].version));
    expect(ok(await settings.hotkeysList({}))).toEqual(reset);
  });

  // The fixture has every step done (D10 lets the real core hold Assistants done too), so the
  // test moves one to skipped: a change on every core, never a no-op that leaves versions alone.
  it("setup_set_step changes a step's state; setup:changed grows", async () => {
    const changes = await s.events("setup:changed");
    const before = ok(await s.core("first-run").setupStatus({}));
    const after = ok(await s.core("first-run").setupSetStep({ step: "assistants", state: "skipped" }));
    expect(after.steps.find((r) => r.step === "assistants")?.state).toBe("skipped");
    expect(after.version).toBeGreaterThan(before.version);
    await until(() => changes.latest(), "setup:changed");
    expect(changes.latest()!.version).toBe(after.version);
  });
});

describe("banners", () => {
  it("banner_dismiss removes the update-ready banner and leaves the update installable; banners:changed grows", async () => {
    await s.change((w) => {
      w.app.environment.update = { version: "1.0.1", notes_md: "Fixes.", ready: true };
      w.app.banners.banners = [{ type: "update_ready", version: "1.0.1" }];
    });
    const changes = await s.events("banners:changed");
    const before = ok(await s.core("main").appSnapshot({})).banners;
    const after = ok(await s.core("main").bannerDismiss({ banner: "update_ready" }));
    expect(after.banners).toEqual([]);
    expect(after.version).toBeGreaterThan(before.version);
    await until(() => changes.latest(), "banners:changed");
    expect(changes.latest()!.version).toBe(after.version);
    ok(await s.core("settings").updateInstall({}));
  });
});
