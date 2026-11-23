// Settings › Models & Runtimes, M2 part (docs/features/ui/accounts.md › Milestone notes): API keys, the frame of
// the own accounts, the local runtime and Runtime per task. Sign-in, Test and sign-out arrive in M3.
import { useEffect, useRef, useState } from "react";

import { useWindow } from "../../app/use-window";
import type { KeyProvider } from "../../core/bindings";
import { t } from "../../i18n/format";
import { useAlert } from "../../ui/dialogs/host";
import { StatusRow } from "../../ui/feedback/status-row";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { installCli, installKey, loadAccounts, removeKey } from "./accounts";
import { saveSection, useRowErrors } from "./actions";
import { AccountRow, KeyRow } from "./CredentialRow";
import { Group, Row } from "./form";
import { KeySheet } from "./KeySheet";
import { keyConfigured, removeAlert, runtimeChoices, TASKS } from "./keys";
import type { PaneProps } from "./pane-props";

// @cpt-dod:cpt-noter-dod-ui-accounts-keys:p1
export function ModelsRuntimesPane({ bridge, settings }: PaneProps) {
  const askAlert = useAlert();
  const accounts = useWindow(bridge, (s) => s.whole.accounts);
  const installing = useWindow(bridge, (s) => s.commands[installKey("ollama")]?.state);
  const rowError = useRowErrors(bridge);
  const [sheet, setSheet] = useState<{ provider: KeyProvider; mode: "add" | "replace" } | null>(null);
  const [saved, setSaved] = useState<KeyProvider | null>(null);
  const [locked, setLocked] = useState(false);
  const asked = useRef(false);
  // the pane reads the accounts once it opens; `accounts:changed` keeps the slice current afterwards
  useEffect(() => {
    if (!asked.current) void loadAccounts(bridge);
    asked.current = true;
  }, [bridge]);

  const keychainLocked = locked || !!accounts?.keys.some((k) => k.status.type === "keychain_locked");
  // @cpt-begin:cpt-noter-flow-ui-accounts-key:p1:inst-remove-alert
  const remove = async (provider: KeyProvider) => {
    if (await askAlert(removeAlert(provider))) await removeKey(bridge, provider);
  };
  // @cpt-end:cpt-noter-flow-ui-accounts-key:p1:inst-remove-alert
  const local = accounts?.local;
  const localReady = !!local?.running;
  // @cpt-begin:cpt-noter-flow-ui-accounts-manage:p1:inst-return-manage
  return (
    <>
      {keychainLocked && (
        <div className="st-banner" role="alert">
          {t("settings.keys.locked_banner")}
          <PushButton label={t("action.try_again")} size="small" onAction={() => (setLocked(false), void loadAccounts(bridge))} />
        </div>
      )}
      <Group title={t("settings.keys.title")}>
        {(accounts?.keys ?? []).map((k) => (
          // @cpt-begin:cpt-noter-flow-ui-accounts-key:p1:inst-open-key
          <KeyRow
            key={k.provider}
            view={k}
            saved={saved === k.provider}
            locked={keychainLocked}
            onSavedExpire={() => setSaved(null)}
            onAdd={() => setSheet({ provider: k.provider, mode: "add" })}
            onReplace={() => setSheet({ provider: k.provider, mode: "replace" })}
            onRemove={() => void remove(k.provider)}
          />
          // @cpt-end:cpt-noter-flow-ui-accounts-key:p1:inst-open-key
        ))}
      </Group>
      <Group title={t("settings.accounts.title")} foot={<span className="np-dim">{t("settings.accounts.foot")}</span>}>
        {(accounts?.accounts ?? []).map((a) => (
          <AccountRow key={a.provider} bridge={bridge} view={a} keyConfigured={keyConfigured(accounts, a.provider)} onUseKey={() => setSheet({ provider: a.provider === "claude" ? "anthropic" : "codex", mode: "add" })} />
        ))}
      </Group>
      <Group title={t("settings.local.title")}>
        <StatusRow
          variant="runtime"
          tone={localReady ? "ok" : local?.cli.installed ? "warn" : "off"}
          icon={localReady ? "checkCircle" : local?.cli.installed ? "warning" : "info"}
          word={t(localReady ? "settings.local.up_to_date" : "settings.local.not_ready")}
          state={localReady ? "ready" : local?.cli.installed ? "stopped" : "missing"}
          title={localReady ? t(local?.default_model ? "settings.local.detected" : "settings.local.detected_no_model", { model: local?.default_model ?? "" }) : t("settings.local.not_configured")}
          subtitle={localReady ? t("settings.local.fallback") : t("settings.local.not_configured_note")}
          message={installing === "ERROR" ? t("settings.local.install_failed") : undefined}
          actions={
            // @cpt-begin:cpt-noter-flow-ui-accounts-key:p1:inst-if-local
            !local?.cli.installed && <PushButton label={installing === "WAITING" ? t("settings.local.installing") : t("settings.local.install")} size="small" loading={installing === "WAITING"} onAction={() => void installCli(bridge, "ollama")} />
            // @cpt-end:cpt-noter-flow-ui-accounts-key:p1:inst-if-local
          }
        />
      </Group>
      <Group title={t("settings.runtimes.title")}>
        {TASKS.map(({ field, label }) => (
          <Row key={field} label={t(label)} error={rowError("runtimes", field)}>
            {/* @cpt-begin:cpt-noter-flow-ui-accounts-manage:p1:inst-save-task */}
            <PopupButton cls="st-runtime__popup" options={runtimeChoices(accounts, settings.runtimes[field])} value={settings.runtimes[field]} label={t(label)} onAction={(v) => void saveSection(bridge, "runtimes", { [field]: v as typeof settings.runtimes.post_call })} />
            {/* @cpt-end:cpt-noter-flow-ui-accounts-manage:p1:inst-save-task */}
          </Row>
        ))}
      </Group>
      {sheet && (
        <KeySheet
          bridge={bridge}
          provider={sheet.provider}
          mode={sheet.mode}
          onLocked={() => setLocked(true)}
          // @cpt-begin:cpt-noter-flow-ui-accounts-key:p1:inst-return-key
          onClose={(stored) => (setSheet(null), stored && setSaved(sheet.provider))}
          // @cpt-end:cpt-noter-flow-ui-accounts-key:p1:inst-return-key
        />
      )}
    </>
  );
  // @cpt-end:cpt-noter-flow-ui-accounts-manage:p1:inst-return-manage
}
