// Pure rules of the API-key rows, the key sheet and Runtime per task (docs/features/ui/accounts.md, M2 part):
// nothing here holds a key or talks to the core.
import type { AccountsView, KeyProvider, KeyView, RuntimeChoice, RuntimeSettings, RuntimeUnavailableReason } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import type { AlertSpec } from "../../ui/dialogs/alerts";

export type KeyRowState = KeyView["status"]["type"];
export const keyRowState = (k: KeyView): KeyRowState => k.status.type;

export const KEY_NAME: Record<KeyProvider, MsgKey> = { anthropic: "settings.keys.anthropic", codex: "settings.keys.codex" };
export const KEY_USE: Record<KeyProvider, MsgKey> = { anthropic: "settings.keys.use_anthropic", codex: "settings.keys.use_codex" };
/** The sheet's title case (**Replace Anthropic API Key**). */
export const KEY_TITLE: Record<KeyProvider, MsgKey> = { anthropic: "settings.keys.title_anthropic", codex: "settings.keys.title_codex" };
const PROVIDER: Record<KeyProvider, MsgKey> = { anthropic: "settings.keys.provider_anthropic", codex: "settings.keys.provider_codex" };
const REASON: Partial<Record<RuntimeUnavailableReason, MsgKey>> = {
  key_rejected: "settings.keys.reason.key_rejected",
  rate_limited: "settings.keys.reason.rate_limited",
  quota_exhausted: "settings.keys.reason.quota_exhausted",
  offline: "settings.keys.reason.offline",
};

/** The provider's reason in plain words (**Anthropic rejected this key (invalid key)**); never the key. */
export const reasonText = (provider: KeyProvider, reason: RuntimeUnavailableReason): string => t(REASON[reason] ?? "settings.keys.reason.other", { provider: t(PROVIDER[provider]) });

/** **Remove the Anthropic API key?**: Cancel is the safe button. */
export const removeAlert = (provider: KeyProvider): AlertSpec => ({
  title: t("settings.keys.remove_title", { name: t(KEY_NAME[provider]) }),
  message: t("settings.keys.remove_body"),
  cancel: t("dialogs.cancel"),
  confirm: t("settings.keys.remove_confirm"),
  destructive: true,
});

/** The key sheet and the first-run field: KEY_DRAFT, KEY_VERIFYING, KEY_INVALID, KEY_CONFIGURED and KEYCHAIN_LOCKED of the spec. */
export type SheetState = "DRAFT" | "VERIFYING" | "INVALID" | "VERIFIED" | "LOCKED";
export type SheetEvent = "submit" | "ok" | "rejected" | "locked" | "edit";

// @cpt-state:cpt-noter-state-ui-accounts-credentials:p1
export function sheetNext(state: SheetState, event: SheetEvent): SheetState {
  switch (event) {
    case "submit":
      // @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-key-verify
      return state === "VERIFYING" ? state : "VERIFYING";
    // @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-key-verify
    case "ok":
      // @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-key-configured
      return "VERIFIED";
    // @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-key-configured
    case "rejected":
      // @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-key-invalid
      return "INVALID";
    // @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-key-invalid
    case "locked":
      // @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-locked
      return "LOCKED";
    // @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-locked
    case "edit":
      return state === "VERIFYING" || state === "VERIFIED" ? state : "DRAFT";
  }
}

/** A non-blank key, submitted once: the second Return while verifying does nothing. */
export const canVerify = (state: SheetState, draft: string): boolean => state !== "VERIFYING" && draft.trim().length > 0;
/** **Save** closes a stored result; it never sends the key again. */
export const canSave = (state: SheetState): boolean => state === "VERIFIED";

export type TaskField = keyof Pick<RuntimeSettings, "live_copilot" | "post_call" | "search_answers">;
export const TASKS: ReadonlyArray<{ field: TaskField; label: MsgKey }> = [
  { field: "live_copilot", label: "settings.runtimes.live_copilot" },
  { field: "post_call", label: "settings.runtimes.post_call" },
  { field: "search_answers", label: "settings.runtimes.search_answers" },
];

/** The agent editor's order: your accounts, API keys, on this Mac. */
const RUNTIME_ORDER: readonly RuntimeChoice[] = ["claude_account", "chatgpt_account", "claude_api_key", "codex_api_key", "local"];
const RUNTIME_LABEL: Record<RuntimeChoice, MsgKey> = {
  claude_account: "settings.runtimes.claude_account",
  chatgpt_account: "settings.runtimes.chatgpt_account",
  claude_api_key: "settings.runtimes.claude_api_key",
  codex_api_key: "settings.runtimes.codex_api_key",
  local: "settings.runtimes.local",
};

/** A runtime the core can run on now; the own accounts count only from M3 (sign-in is not delivered), so they read not connected. */
export function runtimeConnected(choice: RuntimeChoice, a: AccountsView | undefined): boolean {
  if (!a) return false;
  switch (choice) {
    case "claude_api_key":
      return a.keys.some((k) => k.provider === "anthropic" && k.status.type === "configured");
    case "codex_api_key":
      return a.keys.some((k) => k.provider === "codex" && k.status.type === "configured");
    case "local":
      return a.local.running;
    case "claude_account":
    case "chatgpt_account":
      return false;
  }
}

// @cpt-begin:cpt-noter-flow-ui-accounts-manage:p1:inst-task
/** The pop-up's choices: every runtime, a disconnected one disabled with **— not connected** unless it is the stored choice. */
export const runtimeChoices = (a: AccountsView | undefined, current: RuntimeChoice) =>
  RUNTIME_ORDER.map((value) => {
    const connected = runtimeConnected(value, a);
    return { value, label: connected ? t(RUNTIME_LABEL[value]) : t("settings.runtimes.not_connected", { name: t(RUNTIME_LABEL[value]) }), disabled: !connected && value !== current };
  });
// @cpt-end:cpt-noter-flow-ui-accounts-manage:p1:inst-task
