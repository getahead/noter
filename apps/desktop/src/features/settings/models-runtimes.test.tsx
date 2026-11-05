// Models & Runtimes (M2 part of docs/features/ui/accounts.md): the rows and groups render from the accounts
// slice, Verify stores a key once through `api_key_set`, a refusal leaves the stored key, and the
// Runtime per task pop-ups save the runtimes section.
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { installCli, loadAccounts, removeKey, setKey } from "./accounts";
import { loadSettings } from "./actions";
import { KeyRow } from "./CredentialRow";
import { KeySheet } from "./KeySheet";
import { ModelsRuntimesPane } from "./ModelsRuntimesPane";
import { PANES, SettingsWindow } from "./SettingsWindow";

let bridge: Bridge;
let fake: FakeCore;
afterEach(() => bridge.close());

async function ready(seed?: (w: FakeCore["world"]) => void) {
  fake = new FakeCore({ window: "settings" });
  seed?.(fake.world);
  bridge = createBridge("settings", fake);
  await bridge.open();
  await loadSettings(bridge);
  return { bridge, settings: bridge.store.getState().whole.settings! };
}
const accounts = () => bridge.store.getState().whole.accounts!;
const keyOf = (provider: "anthropic" | "codex") => accounts().keys.find((k) => k.provider === provider)!;
const settle = () => new Promise((r) => setTimeout(r, 5));
type Tree = ReturnType<typeof rendered>;
const on = (tree: Tree, label: string, prop = "onAction") => find(tree, (p) => (p.label === label || p.ariaLabel === label) && typeof p[prop] === "function").props[prop] as (v?: unknown) => unknown;
const sentCommands = () => {
  const seen: string[] = [];
  const invoke = fake.invoke.bind(fake);
  fake.invoke = ((cmd: string, ...rest: unknown[]) => (seen.push(cmd), (invoke as (...a: unknown[]) => unknown)(cmd, ...rest))) as typeof fake.invoke;
  return seen;
};

describe("ModelsRuntimesPane (cpt-noter-dod-ui-accounts-keys)", () => {
  it("opens from the pane list in place of the later-version note", async () => {
    await ready();
    const html = renderToString(<SettingsWindow bridge={bridge} />);
    expect(html).toContain("Models &amp; Runtimes");
    expect(html).not.toContain("Models & Runtimes arrives in a later version");
    expect(renderToString(<>{PANES.models_and_runtimes!({ bridge, settings: bridge.store.getState().whole.settings! })}</>)).toContain("API keys");
  });

  it("shows the key rows with their state, the Keychain line, both account frames, the local runtime and Runtime per task", async () => {
    const props = await ready();
    const html = renderToString(<ModelsRuntimesPane {...props} />);
    expect(html).toContain('data-component="cpt-noter-component-ui-credential-row"');
    expect(html).toContain("Anthropic API key");
    expect(html).toContain("Configured");
    expect(html).toContain("Stored in the Keychain");
    expect(html).toContain(">Replace…<");
    expect(html).toContain(">Remove…<");
    expect(html).toContain("Codex API key");
    expect(html).toContain("Not set");
    expect(html).toContain(">Add…<");
    expect(html).toContain("Your Claude account");
    expect(html).toContain("Your ChatGPT account");
    expect(html).toContain("Not signed in");
    expect(html).toContain("Ollama detected · qwen3:8b ready");
    expect(html).toContain("Runtime per task");
    expect(html).toContain("Post-call analysis");
    expect(html).toContain("Codex · Codex API key — not connected");
  });

  it("shows a rejected key with the provider's reason and Replace… first, and Install Ollama… without the local runtime", async () => {
    const props = await ready((w) => {
      w.app.accounts.keys[0]!.status = { type: "rejected", reason: "key_rejected" };
      w.app.accounts.local.cli.installed = false;
      w.app.accounts.local.running = false;
    });
    const html = renderToString(<ModelsRuntimesPane {...props} />);
    expect(html).toContain("Rejected");
    expect(html).toContain("Anthropic rejected this key (invalid key)");
    expect(html.indexOf(">Replace…<")).toBeLessThan(html.indexOf(">Remove…<"));
    expect(html).toContain("Not configured");
    expect(html).toContain(">Install Ollama…<");
    expect(html).not.toContain("Keychain is locked");
  });

  it("shows the Keychain banner with Try Again while a key is locked", async () => {
    const props = await ready((w) => (w.app.accounts.keys[0]!.status = { type: "keychain_locked" }));
    const html = renderToString(<ModelsRuntimesPane {...props} />);
    expect(html).toContain("Keychain is locked");
    expect(html).toContain(">Try Again<");
  });

  it("saves a Runtime per task choice as the runtimes section", async () => {
    const props = await ready();
    const seen = sentCommands();
    on(rendered(ModelsRuntimesPane, props), "Post-call analysis")("local");
    await settle();
    expect(seen).toContain("settings_update");
    expect(bridge.store.getState().whole.settings!.runtimes.post_call).toBe("local");
  });

  it("Install Ollama… runs cli_install", async () => {
    const props = await ready((w) => {
      w.app.accounts.local.cli.installed = false;
      w.app.accounts.local.running = false;
    });
    const seen = sentCommands();
    on(rendered(ModelsRuntimesPane, props), "Install Ollama…")();
    await settle();
    expect(seen).toContain("cli_install");
  });
});

describe("KeySheet and the key commands (cpt-noter-flow-ui-accounts-key)", () => {
  it("renders the sheet with the secure field, Verify, Cancel and a disabled Save", async () => {
    await ready();
    const html = renderToString(<KeySheet bridge={bridge} provider="anthropic" mode="replace" onClose={() => {}} />);
    expect(html).toContain("Replace Anthropic API Key");
    expect(html).toContain("the key goes to the Keychain only");
    expect(html).toContain('type="password"');
    expect(html).toContain(">Verify<");
    expect(html).toContain(">Save<");
    expect(html).toContain(">Cancel<");
    expect(renderToString(<KeySheet bridge={bridge} provider="codex" mode="add" onClose={() => {}} />)).toContain("Add Codex API Key");
  });

  /** The sheet's field machine, as the sheet hands it to its field. */
  const draftOf = (tree: Tree) => find(tree, (p) => typeof (p.draft as { verify?: unknown } | undefined)?.verify === "function").props.draft as import("./KeyField").KeyDraft;

  it("Verify stores the key once and the row reads Configured; a blank or repeated submit sends nothing", async () => {
    await ready((w) => (w.app.accounts.keys[1]!.status = { type: "not_set" }));
    const seen = sentCommands();
    const d = draftOf(rendered(KeySheet, { bridge, provider: "codex" as const, mode: "add" as const, onClose: () => {} }));
    expect(await d.verify()).toBe(false); // blank
    d.edit("sk-codex-123456");
    const first = d.verify();
    expect(await d.verify()).toBe(false); // already verifying
    expect(await first).toBe(true);
    expect(keyOf("codex").status.type).toBe("configured");
    expect(seen.filter((c) => c === "api_key_set")).toHaveLength(1);
  });

  it("a rejected key keeps the draft for correction, and a locked Keychain tells the pane", async () => {
    await ready();
    const d = draftOf(rendered(KeySheet, { bridge, provider: "anthropic" as const, mode: "replace" as const, onClose: () => {} }));
    d.edit("sk-bad");
    expect(await d.verify()).toBe(false);
    expect(keyOf("anthropic").status).toEqual({ type: "rejected", reason: "key_rejected" });
    let locked = false;
    const l = draftOf(rendered(KeySheet, { bridge, provider: "anthropic" as const, mode: "replace" as const, onClose: () => {}, onLocked: () => (locked = true) }));
    fake.failNext("api_key_set", "keychain_locked");
    l.edit("sk-ant-good-key-123");
    expect(await l.verify()).toBe(false);
    expect(locked).toBe(true);
    fake.failNext("api_key_set", "offline");
    l.edit("sk-ant-good-key-123");
    expect(await l.verify()).toBe(false); // another refusal: the generic line, the draft stays
  });

  it("a rejected key leaves the row Rejected with the reason, and the command state is the error", async () => {
    await ready();
    const res = await setKey(bridge, "anthropic", "sk-bad");
    expect(res.status).toBe("error");
    expect(keyOf("anthropic").status).toEqual({ type: "rejected", reason: "key_rejected" });
    expect(bridge.store.getState().commands["key:set:anthropic"]?.state).toBe("ERROR");
  });

  it("a locked Keychain is the command's error and the stored key stays", async () => {
    await ready();
    fake.failNext("api_key_set", "keychain_locked");
    const res = await setKey(bridge, "anthropic", "sk-ant-good-key");
    expect(res.status === "error" && res.error.code).toBe("keychain_locked");
    expect(keyOf("anthropic").status.type).toBe("configured");
  });

  it("Remove… takes the key out; accounts_get and cli_install answer", async () => {
    await ready();
    await removeKey(bridge, "anthropic");
    expect(keyOf("anthropic").status.type).toBe("not_set");
    const before = accounts().version;
    await loadAccounts(bridge);
    expect(accounts().version).toBeGreaterThanOrEqual(before);
    expect((await installCli(bridge, "ollama")).status).toBe("ok");
  });

  it("the key row offers Add… when not set and Replace…/Remove… otherwise, and shows Saved", () => {
    const notSet = rendered(KeyRow, { view: { provider: "codex" as const, status: { type: "not_set" as const } }, onAdd: () => {}, onReplace: () => {}, onRemove: () => {} });
    expect(() => on(notSet, "Add…")).not.toThrow();
    const html = renderToString(<KeyRow view={{ provider: "anthropic", status: { type: "configured", verified_at: 1 } }} saved onAdd={() => {}} onReplace={() => {}} onRemove={() => {}} />);
    expect(html).toContain(">Saved<");
    expect(html).toContain(">Replace…<");
  });
});
