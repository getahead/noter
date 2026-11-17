// The commands of the API-key part of accounts (docs/features/ui/accounts.md, M2): read the accounts view,
// store a key, remove one, install the local runtime. The key is sent once and held nowhere else.
import type { Bridge } from "../../app/bridge/bridge";
import type { AccountProvider, CliTool, KeyProvider } from "../../core/bindings";

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
  return bridge.act(keySetKey(provider), "api_key_set", () => bridge.core.apiKeySet({ provider, key }), { slice: "accounts", retainForRetry: false });
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

export const testKey = (provider: AccountProvider) => `account:test:${provider}`;

// @cpt-flow:cpt-noter-flow-ui-accounts-manage:p1
/** `account_test`: a real request through the CLI; the answer carries the latency only when it worked. */
export function testAccount(bridge: Bridge, provider: AccountProvider) {
  // @cpt-begin:cpt-noter-flow-ui-accounts-manage:p1:inst-test
  return bridge.act(testKey(provider), "account_test", () => bridge.core.accountTest({ provider }));
  // @cpt-end:cpt-noter-flow-ui-accounts-manage:p1:inst-test
}

export const signOutKey = (provider: AccountProvider) => `account:sign_out:${provider}`;

/** `account_sign_out`: the slice is replaced only by the core's answer; the row never changes on a failure. */
export function signOutAccount(bridge: Bridge, provider: AccountProvider, alsoInCli: boolean) {
  // @cpt-begin:cpt-noter-flow-ui-accounts-manage:p1:inst-signout
  return bridge.act(signOutKey(provider), "account_sign_out", () => bridge.core.accountSignOut({ provider, also_in_cli: alsoInCli }), { slice: "accounts" });
  // @cpt-end:cpt-noter-flow-ui-accounts-manage:p1:inst-signout
}

export const signInKey = (provider: AccountProvider) => `signin:${provider}`;

// @cpt-flow:cpt-noter-flow-ui-accounts-sign-in:p1
/** `account_signin_prepare`: step 1 of the sheet; a missing CLI comes back as the error `cli_missing`. */
export function prepareSignIn(bridge: Bridge, provider: AccountProvider) {
  // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-prepare
  return bridge.act(`${signInKey(provider)}:prepare`, "account_signin_prepare", () => bridge.core.accountSigninPrepare({ provider }));
  // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-prepare
}

/** `account_signin_start`: the CLI opens the browser; the answer carries the session, link and one-time code. */
export function startSignIn(bridge: Bridge, provider: AccountProvider, personalUseConfirmed: boolean) {
  // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-start
  return bridge.act(`${signInKey(provider)}:start`, "account_signin_start", () => bridge.core.accountSigninStart({ provider, personal_use_confirmed: personalUseConfirmed }), { retainForRetry: false });
  // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-start
}

/** `account_signin_cancel`: only the explicit Cancel; an unknown session is already gone. */
export function cancelSignIn(bridge: Bridge, sessionId: string) {
  // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-cancel
  return bridge.act("signin:cancel", "account_signin_cancel", () => bridge.core.accountSigninCancel({ session_id: sessionId }), { slice: "accounts" });
  // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-cancel
}

/** `account_use_existing`: reuse the CLI's own sign-in; the answer is the whole accounts view. */
export function useExistingAccount(bridge: Bridge, provider: AccountProvider) {
  // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-use-existing
  return bridge.act(`${signInKey(provider)}:existing`, "account_use_existing", () => bridge.core.accountUseExisting({ provider }), { slice: "accounts" });
  // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-use-existing
}

/** `account_bind_agents`: the explicit choice of Use; the answer carries the `change_id` for Undo. */
export function bindAgents(bridge: Bridge, provider: AccountProvider, agentIds: string[], defaultForNew: boolean) {
  // @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-bind
  return bridge.act(`${signInKey(provider)}:bind`, "account_bind_agents", () => bridge.core.accountBindAgents({ provider, agent_ids: agentIds, default_for_new_agents: defaultForNew }));
  // @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-bind
}
