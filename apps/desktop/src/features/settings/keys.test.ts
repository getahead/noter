import { describe, expect, it } from "vitest";

import type { AccountsView, KeyView } from "../../core/bindings";
import { canSave, canVerify, keyRowState, reasonText, removeAlert, runtimeChoices, runtimeConnected, sheetNext } from "./keys";

const key = (status: KeyView["status"]): KeyView => ({ provider: "anthropic", status });
const accounts = (over: Partial<AccountsView> = {}): AccountsView => ({
  version: 1,
  keys: [key({ type: "configured", verified_at: 1 }), { provider: "codex", status: { type: "not_set" } }],
  accounts: [
    { provider: "claude", status: { type: "not_signed_in" }, cli: { tool: "claude_code", installed: true, path: null, version: null, supported: true }, agents: [] },
    { provider: "chatgpt", status: { type: "not_signed_in" }, cli: { tool: "codex", installed: true, path: null, version: null, supported: true }, agents: [] },
  ],
  local: { cli: { tool: "ollama", installed: true, path: null, version: null, supported: true }, running: false, models: [], default_model: null },
  ...over,
});

describe("keyRowState (cpt-noter-component-ui-credential-row)", () => {
  it("is the core's status type", () => {
    expect(keyRowState(key({ type: "not_set" }))).toBe("not_set");
    expect(keyRowState(key({ type: "rejected", reason: "key_rejected" }))).toBe("rejected");
    expect(keyRowState(key({ type: "keychain_locked" }))).toBe("keychain_locked");
  });

  it("words the provider's reason without the key", () => {
    expect(reasonText("anthropic", "key_rejected")).toBe("Anthropic rejected this key (invalid key)");
    expect(reasonText("codex", "rate_limited")).toContain("OpenAI");
    expect(reasonText("anthropic", "local_model_not_ready")).toBe("Anthropic couldn’t use this key");
  });

  it("builds the remove alert with Cancel as the safe button", () => {
    const a = removeAlert("anthropic");
    expect(a.title).toBe("Remove the Anthropic API key?");
    expect(a.destructive).toBe(true);
    expect(a.cancel).toBe("Cancel");
  });
});

describe("sheetNext (cpt-noter-state-ui-accounts-credentials, key transitions)", () => {
  it("DRAFT → VERIFYING → VERIFIED on success", () => {
    expect(sheetNext("DRAFT", "submit")).toBe("VERIFYING");
    expect(sheetNext("VERIFYING", "ok")).toBe("VERIFIED");
  });
  it("VERIFYING → INVALID on a rejection, back to DRAFT once the input changes", () => {
    expect(sheetNext("VERIFYING", "rejected")).toBe("INVALID");
    expect(sheetNext("INVALID", "edit")).toBe("DRAFT");
  });
  it("VERIFYING → LOCKED on keychain_locked; editing returns to DRAFT", () => {
    expect(sheetNext("VERIFYING", "locked")).toBe("LOCKED");
    expect(sheetNext("LOCKED", "edit")).toBe("DRAFT");
  });
  it("a second submit while verifying, or a blank key, changes nothing", () => {
    expect(sheetNext("VERIFYING", "submit")).toBe("VERIFYING");
    expect(sheetNext("VERIFIED", "edit")).toBe("VERIFIED");
    expect(canVerify("VERIFYING", "sk-1")).toBe(false);
    expect(canVerify("DRAFT", "   ")).toBe(false);
    expect(canVerify("DRAFT", "sk-1")).toBe(true);
    expect(canVerify("INVALID", "sk-2")).toBe(true);
  });
  it("Save is enabled only once verified", () => {
    expect(canSave("VERIFIED")).toBe(true);
    expect(canSave("DRAFT")).toBe(false);
    expect(canSave("INVALID")).toBe(false);
  });
});

describe("runtime per task (cpt-noter-flow-ui-accounts-manage, steps 2 and 3)", () => {
  it("knows which runtimes are connected from the accounts view", () => {
    const a = accounts();
    expect(runtimeConnected("claude_api_key", a)).toBe(true);
    expect(runtimeConnected("codex_api_key", a)).toBe(false);
    expect(runtimeConnected("claude_account", a)).toBe(false);
    expect(runtimeConnected("chatgpt_account", a)).toBe(false); // own accounts arrive in M3
    expect(runtimeConnected("local", a)).toBe(false);
    expect(runtimeConnected("local", accounts({ local: { ...a.local, running: true } }))).toBe(true);
    expect(runtimeConnected("local", undefined)).toBe(false);
  });

  it("lists every runtime in DESIGN's order, disabled with “not connected” when it is not, except the current one", () => {
    const choices = runtimeChoices(accounts(), "codex_api_key");
    expect(choices.map((c) => c.value)).toEqual(["claude_account", "chatgpt_account", "claude_api_key", "codex_api_key", "local"]);
    expect(choices.find((c) => c.value === "claude_api_key")).toMatchObject({ label: "Claude Code · Anthropic API key", disabled: false });
    expect(choices.find((c) => c.value === "local")).toMatchObject({ label: "Local model · Ollama — not connected", disabled: true });
    // the stored choice stays selectable even while its runtime is not connected, so the pop-up shows the truth
    expect(choices.find((c) => c.value === "codex_api_key")).toMatchObject({ disabled: false });
  });
});
