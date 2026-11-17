// Pure rules of the account-login row, Test and Sign Out (docs/features/ui/accounts.md, manage flow): nothing
// here talks to the core or holds a credential.
import type { AccountProvider, AccountTestResult, AccountView, AgentRef } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";

export type AccountRowState = "not_signed_in" | "signing_in" | "signed_in" | "expired";
const STATE: Record<AccountView["status"]["type"], AccountRowState> = {
  not_signed_in: "not_signed_in",
  signing_in: "signing_in",
  signed_in: "signed_in",
  signed_out_by_provider: "expired",
};
// @cpt-begin:cpt-noter-state-ui-accounts-credentials:p1:inst-expired
export const accountRowState = (v: AccountView): AccountRowState => STATE[v.status.type];
// @cpt-end:cpt-noter-state-ui-accounts-credentials:p1:inst-expired

const key = (p: AccountProvider, what: "provider" | "tool" | "key"): MsgKey => `settings.accounts.${what}_${p}`;
export const providerName = (p: AccountProvider) => t(key(p, "provider"));
export const toolName = (p: AccountProvider) => t(key(p, "tool"));

/** **Used by 2 agents: Product manager, Architect** or the hint that no agent uses it yet. */
export const usedByText = (agents: AgentRef[]): string =>
  agents.length ? t("settings.accounts.used_by", { count: agents.length, names: agents.map((a) => a.name).join(", ") }) : t("settings.accounts.used_none");

// @cpt-begin:cpt-noter-flow-ui-accounts-manage:p1:inst-test
/** The Test line: the latency only when the core says ok, otherwise the mapped error. */
export function testResultText(r: AccountTestResult): string {
  if (r.ok && r.latency_ms != null) return t("settings.accounts.test_ok", { seconds: (r.latency_ms / 1000).toFixed(1) });
  if (r.error === "offline") return t("settings.accounts.test_offline");
  if (r.error === "account_signed_out") return t("settings.accounts.test_signed_out");
  return t("settings.accounts.test_failed");
}
// @cpt-end:cpt-noter-flow-ui-accounts-manage:p1:inst-test

// @cpt-begin:cpt-noter-flow-ui-accounts-manage:p1:inst-signout-alert
/** The sign-out alert: who falls back to the matching key (or pauses without one), and the CLI stays signed in unless asked. */
export function signOutCopy(provider: AccountProvider, agents: AgentRef[], keyConfigured: boolean) {
  const tool = toolName(provider);
  const cli = t("settings.accounts.signout_cli", { tool });
  const fallback = keyConfigured
    ? t("settings.accounts.signout_has_key")
    : t("settings.accounts.signout_no_key", { pause: t(agents.length === 1 ? "settings.accounts.pause_one" : "settings.accounts.pause_other") });
  const lead = agents.length ? `${t("settings.accounts.signout_agents", { count: agents.length, names: agents.map((a) => a.name).join(", "), key: t(key(provider, "key")), fallback })} ` : "";
  return {
    title: t("settings.accounts.signout_title", { provider: providerName(provider) }),
    message: lead + cli,
    checkbox: t("settings.accounts.signout_also", { tool }),
  };
}
// @cpt-end:cpt-noter-flow-ui-accounts-manage:p1:inst-signout-alert
