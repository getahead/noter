// The commands of the API-key part of accounts (docs/features/ui/accounts.md, M2): read the accounts view,
// store a key, remove one, install the local runtime. The key is sent once and held nowhere else.
import type { Bridge } from "../../app/bridge/bridge";
import type { CliTool, KeyProvider } from "../../core/bindings";

// @cpt-flow:cpt-noter-flow-ui-accounts-key:p1
/** `accounts_get`: keys, own accounts and the local runtime, into the `accounts` slice (highest version wins). */
export function loadAccounts(bridge: Bridge) {
  // @cpt-begin:cpt-noter-flow-ui-accounts-key:p1:inst-read
  return bridge.act("accounts:get", "accounts_get", () => bridge.core.accountsGet({}), { slice: "accounts" });
  // @cpt-end:cpt-noter-flow-ui-accounts-key:p1:inst-read
}

export const keySetKey = (provider: KeyProvider) => `key:set:${provider}`;

/** `api_key_set`: verifies and stores in one step (D-3); the answer is the whole accounts view. */
export function setKey(bridge: Bridge, provider: KeyProvider, key: string) {
  // @cpt-begin:cpt-noter-flow-ui-accounts-key:p1:inst-set
  return bridge.act(keySetKey(provider), "api_key_set", () => bridge.core.apiKeySet({ provider, key }), { slice: "accounts" });
  // @cpt-end:cpt-noter-flow-ui-accounts-key:p1:inst-set
}

/** `api_key_remove` (an M3 command; the fake core serves it in M2): the slice is replaced only by the core's answer. */
export function removeKey(bridge: Bridge, provider: KeyProvider) {
  // @cpt-begin:cpt-noter-flow-ui-accounts-key:p1:inst-remove
  return bridge.act(`key:remove:${provider}`, "api_key_remove", () => bridge.core.apiKeyRemove({ provider }), { slice: "accounts" });
  // @cpt-end:cpt-noter-flow-ui-accounts-key:p1:inst-remove
}

export const installKey = (tool: CliTool) => `cli:install:${tool}`;

/** `cli_install` (M3; fake in M2): the job's progress and `accounts:changed` say when the tool is there. */
export function installCli(bridge: Bridge, tool: CliTool) {
  // @cpt-begin:cpt-noter-flow-ui-accounts-key:p1:inst-install-local
  return bridge.act(installKey(tool), "cli_install", () => bridge.core.cliInstall({ tool }));
  // @cpt-end:cpt-noter-flow-ui-accounts-key:p1:inst-install-local
}
