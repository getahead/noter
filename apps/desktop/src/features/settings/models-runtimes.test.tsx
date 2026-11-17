// Models & Runtimes (M2 part of docs/features/ui/accounts.md): the rows and groups render from the accounts
// slice, Verify stores a key once through `api_key_set`, a refusal leaves the stored key, and the
// Runtime per task pop-ups save the runtimes section.
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createBridge, type Bridge } from "../../app/bridge/bridge";
import { FakeCore } from "../../core/fake/fake-core";
import { find, rendered } from "../../ui/testing";
import { sentCommands } from "../../../tests/support/fake-core";
import { installCli, loadAccounts, removeKey, setKey, signOutAccount, testAccount } from "./accounts";
import { loadSettings } from "./actions";
import { AccountRow, KeyRow } from "./CredentialRow";
import { SignOutSheet } from "./SignOutSheet";
import { refocus } from "./KeyField";
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
type Tree = ReturnType<typeof rendered>;
const on = (tree: Tree, label: string, prop = "onAction") => find(tree, (p) => (p.label === label || p.ariaLabel === label) && typeof p[prop] === "function").props[prop] as (v?: unknown) => unknown;
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
    const seen = sentCommands(fake);
    on(rendered(ModelsRuntimesPane, props), "Post-call analysis")("local");
    await vi.waitFor(() => expect(seen.map(([cmd]) => cmd)).toContain("settings_update"));
    expect(bridge.store.getState().whole.settings!.runtimes.post_call).toBe("local");
  });

  it("Install Ollama… runs cli_install", async () => {
    const props = await ready((w) => {
      w.app.accounts.local.cli.installed = false;
      w.app.accounts.local.running = false;
    });
    const seen = sentCommands(fake);
    on(rendered(ModelsRuntimesPane, props), "Install Ollama…")();
    await vi.waitFor(() => expect(seen.map(([cmd]) => cmd)).toContain("cli_install"));
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
    const seen = sentCommands(fake);
    const d = draftOf(rendered(KeySheet, { bridge, provider: "codex" as const, mode: "add" as const, onClose: () => {} }));
    expect(await d.verify()).toBe(false); // blank
    d.edit("sk-codex-123456");
    const first = d.verify();
    expect(await d.verify()).toBe(false); // already verifying
    expect(await first).toBe(true);
    expect(keyOf("codex").status.type).toBe("configured");
    expect(seen.filter(([cmd]) => cmd === "api_key_set")).toHaveLength(1);
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

  it("does not retain an API key in the bridge retry handler", async () => {
    await ready();
    fake.failNext("api_key_set", "offline");
    const seen = sentCommands(fake);

    await setKey(bridge, "anthropic", "sk-ant-secret");
    await bridge.retry("key:set:anthropic");

    expect(seen.filter(([cmd]) => cmd === "api_key_set")).toHaveLength(1);
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

  it("a refused key puts focus back in the field (step 5.1); without a document nothing happens", () => {
    let focused = 0;
    vi.stubGlobal("document", { getElementById: (id: string) => (id === "key-anthropic" ? { focus: () => void focused++ } : null) });
    refocus("key-anthropic");
    refocus("key-codex");
    vi.unstubAllGlobals();
    expect(focused).toBe(1);
    expect(() => refocus("key-anthropic")).not.toThrow();
  });

  it("the key row offers Add… when not set and Replace…/Remove… otherwise, and shows Saved", () => {
    const notSet = rendered(KeyRow, { view: { provider: "codex" as const, status: { type: "not_set" as const } }, onAdd: () => {}, onReplace: () => {}, onRemove: () => {} });
    expect(() => on(notSet, "Add…")).not.toThrow();
    const html = renderToString(<KeyRow view={{ provider: "anthropic", status: { type: "configured", verified_at: 1 } }} saved onAdd={() => {}} onReplace={() => {}} onRemove={() => {}} />);
    expect(html).toContain(">Saved<");
    expect(html).toContain(">Replace…<");
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("account rows (cpt-noter-flow-ui-accounts-manage)", () => {
  const signedIn = (w: FakeCore["world"]) => {
    const claude = w.app.accounts.accounts.find((a) => a.provider === "claude")!;
    claude.status = { type: "signed_in", identity: { email: "you@example.com", plan: "Max" }, since: 1 };
    claude.agents = [{ id: "agt_pm", name: "Product manager", badge: "agent" }];
  };

  it("shows the identity, the agents that use it, Test and Sign Out…, and enables the account runtime", async () => {
    const props = await ready(signedIn);
    await loadAccounts(bridge);
    const html = renderToString(<ModelsRuntimesPane {...props} />);
    expect(html).toContain("Signed in");
    expect(html).toContain("you@example.com · Max · through Claude Code");
    expect(html).toContain("Used by 1 agent: Product manager");
    expect(html).toContain(">Test<");
    expect(html).toContain(">Sign Out…<");
  });

  it("shows the expired row with its note and Sign In Again…", async () => {
    const props = await ready((w) => {
      w.app.accounts.accounts.find((a) => a.provider === "chatgpt")!.status = { type: "signed_out_by_provider", at: 1 };
    });
    await loadAccounts(bridge);
    const html = renderToString(<ModelsRuntimesPane {...props} />);
    expect(html).toContain("Signed out by ChatGPT");
    expect(html).toContain("Agents on it are paused until you sign in again.");
    expect(html).toContain(">Sign In Again…<");
  });

  it("Test asks the core and Sign Out sends also_in_cli, replacing the slice only on success", async () => {
    await ready(signedIn);
    const seen = sentCommands(fake);
    expect((await testAccount(bridge, "claude")).status).toBe("ok");
    expect((await signOutAccount(bridge, "claude", true)).status).toBe("ok");
    expect(accounts().accounts.find((a) => a.provider === "claude")!.status.type).toBe("not_signed_in");
    expect(seen).toContainEqual(["account_sign_out", { provider: "claude", also_in_cli: true }]);
  });

  it("Test shows the answer line and the sign-out sheet confirms with the checkbox or cancels", async () => {
    await ready(signedIn);
    const view = accounts().accounts.find((a) => a.provider === "claude")!;
    const row = rendered(AccountRow, { bridge, view, keyConfigured: true });
    on(row, "Test")();
    await vi.waitFor(() => expect(bridge.store.getState().commands["account:test:claude"]?.state).toBe("DONE"));
    const confirm = vi.fn();
    const cancel = vi.fn();
    const sheet = rendered(SignOutSheet, { provider: "claude", agents: view.agents, keyConfigured: false, onConfirm: confirm, onCancel: cancel });
    on(sheet, "Also sign out of Claude Code on this Mac", "onAction")(true);
    on(find(sheet, (p) => p.defaultButton !== undefined).props.defaultButton as Tree, "Sign Out")();
    expect(confirm).toHaveBeenCalledWith(false);
    on(sheet, "Cancel")();
    expect(cancel).toHaveBeenCalled();
    expect(renderToString(<SignOutSheet provider="chatgpt" agents={[]} keyConfigured onConfirm={confirm} onCancel={cancel} />)).toContain("Codex stays signed in");
  });

  it("a refused sign-out leaves the row signed in and shows a safe error", async () => {
    await ready(signedIn);
    fake.failNext("account_sign_out", "offline");
    expect((await signOutAccount(bridge, "claude", false)).status).toBe("error");
    const view = accounts().accounts.find((a) => a.provider === "claude")!;
    expect(view.status.type).toBe("signed_in");
    const html = renderToString(<AccountRow bridge={bridge} view={view} keyConfigured />);
    expect(html).toContain("Couldn’t sign out. The account is unchanged.");
    expect(html).toContain("Signed in");
  });

});
