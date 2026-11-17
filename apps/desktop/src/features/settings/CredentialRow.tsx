// Credential row (DESIGN 3.2): one API key as a row (Settings) or a field form (first run), and one own
// account as its frame (the sign-in arrives in M3). The key itself is never shown or held.
import { useEffect, useRef, useState } from "react";

import { focusFirstAvailable } from "../../app/a11y/focus";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { AccountProvider, AccountView, KeyView } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { InlineStatus } from "../../ui/feedback/inline-status";
import type { IconName } from "../../ui/icons";
import { Badge, type BadgeProps } from "../../ui/primitives/badge";
import { PushButton } from "../../ui/primitives/push-button";
import { accountRowState, providerName, testResultText, toolName, usedByText, type AccountRowState } from "./account-rows";
import { signOutAccount, signOutKey, testAccount, testKey } from "./accounts";
import { KeyField, useKeyDraft } from "./KeyField";
import { AccountSignInSheet } from "./AccountSignInSheet";
import { useSignIn } from "./signin-store";
import { SignOutSheet } from "./SignOutSheet";
import { KEY_NAME, KEY_USE, keyRowState, reasonText, type KeyRowState } from "./keys";

const COMPONENT = "cpt-noter-component-ui-credential-row";
const TAG: Record<KeyRowState, { label: MsgKey; icon?: IconName; tone: BadgeProps["tone"] }> = {
  not_set: { label: "settings.keys.not_set", tone: "neutral" },
  configured: { label: "settings.keys.configured", icon: "check", tone: "success" },
  rejected: { label: "settings.keys.rejected", icon: "error", tone: "error" },
  verifying: { label: "settings.keys.verifying", tone: "neutral" },
  keychain_locked: { label: "settings.keys.locked", icon: "warning", tone: "warning" },
};

/** The state pill (the prototype's `P.badge` with tone and icon). */
const Tag = ({ state }: { state: KeyRowState }) => <Badge text={t(TAG[state].label)} tone={TAG[state].tone} icon={TAG[state].icon} cls="st-cred__tag" />;

export interface KeyRowProps {
  view: KeyView;
  /** **Saved** beside the actions for 2 s after the sheet closed on a stored key. */
  saved?: boolean;
  onSavedExpire?: () => void;
  onAdd: () => void;
  onReplace: () => void;
  onRemove: () => void;
  /** The pane's Keychain is locked: every action of every row is disabled. */
  locked?: boolean;
}

// @cpt-component:cpt-noter-component-ui-credential-row:p1
/** Row variant: name, use line, state tag, the Keychain line and **Add…** / **Replace…** / **Remove…**. */
export function KeyRow({ view, saved, onSavedExpire, onAdd, onReplace, onRemove, locked }: KeyRowProps) {
  const state = keyRowState(view);
  const removeId = view.provider === "anthropic" ? "credential-remove-anthropic" : "credential-remove-codex";
  const addId = view.provider === "anthropic" ? "credential-add-anthropic" : "credential-add-codex";
  const returnFocus = useRef(false);
  const previousState = useRef(state);
  useEffect(() => {
    const previous = previousState.current;
    previousState.current = state;
    if (returnFocus.current && previous !== "not_set" && state === "not_set") {
      returnFocus.current = false;
      focusFirstAvailable(document, [addId]);
    }
  }, [addId, state]);
  // while the Keychain is locked every key action waits (DESIGN › Credential row › States)
  const busy = state === "verifying" || state === "keychain_locked" || !!locked;
  return (
    <div className="e-status st-cred" role="group" aria-label={t(KEY_NAME[view.provider])} data-component={COMPONENT} data-variant="row" data-state={state}>
      <div className="e-status__main">
        <span className="e-status__title">{t(KEY_NAME[view.provider])}</span>
        <span className="e-status__sub">{t(KEY_USE[view.provider])}</span>
        <Tag state={state} />
        {state === "configured" && <span className="st-cred__dots">{t("settings.keys.keychain")}</span>}
        {view.status.type === "rejected" && <span className="st-row__err">{reasonText(view.provider, view.status.reason)}</span>}
      </div>
      <div className="st-cred__actions">
        {saved && <InlineStatus text={t("settings.keys.saved")} onExpire={onSavedExpire ?? (() => {})} />}
        {state === "not_set" ? (
          <PushButton id={addId} label={t("settings.keys.add")} size="small" disabled={locked} onAction={onAdd} />
        ) : (
          <>
            <PushButton label={t("settings.keys.replace")} size="small" disabled={busy} onAction={onReplace} />
            <PushButton id={removeId} label={t("settings.keys.remove")} size="small" disabled={busy} onAction={() => { returnFocus.current = document.activeElement?.id === removeId; onRemove(); }} />
          </>
        )}
      </div>
    </div>
  );
}

/** Field variant (first-run step 6): the label, the secure field with **Verify**, or the Keychain line with **Remove** once stored. */
export function KeyFieldRow({ bridge, view, onRemove }: { bridge: Bridge; view: KeyView; onRemove: () => void }) {
  const draft = useKeyDraft(bridge, view.provider);
  const stored = view.status.type === "configured";
  const fieldId = view.provider === "anthropic" ? "fr-key-anthropic" : "fr-key-codex";
  const removeId = view.provider === "anthropic" ? "first-run-key-remove-anthropic" : "first-run-key-remove-codex";
  const returnFocus = useRef(false);
  const previousStored = useRef(stored);
  useEffect(() => {
    const wasStored = previousStored.current;
    previousStored.current = stored;
    if (returnFocus.current && wasStored && !stored) {
      returnFocus.current = false;
      focusFirstAvailable(document, [fieldId]);
    }
  }, [fieldId, stored]);
  return (
    <div className="st-cred st-cred--field" data-component={COMPONENT} data-variant="field" data-state={stored ? "configured" : draft.state.toLowerCase()}>
      <label className="fr-sublabel" htmlFor={`fr-key-${view.provider}`}>
        {t(KEY_NAME[view.provider])}
      </label>
      {stored ? (
        <div className="st-keyfield">
          <span className="st-cred__dots">{t("settings.keys.keychain")}</span>
          <PushButton id={removeId} label={t("settings.keys.remove_short")} size="small" onAction={() => { returnFocus.current = document.activeElement?.id === removeId; onRemove(); }} />
        </div>
      ) : (
        <KeyField id={fieldId} label={t(KEY_NAME[view.provider])} placeholder={t(view.provider === "anthropic" ? "first_run.assistants.key_placeholder_anthropic" : "first_run.assistants.key_placeholder_codex")} draft={draft} verifiedText={t("settings.keys.keychain")} />
      )}
    </div>
  );
}

const ACCOUNT: Record<AccountProvider, { title: MsgKey; use: MsgKey; signin: MsgKey }> = {
  claude: { title: "settings.accounts.claude", use: "settings.accounts.use_claude", signin: "settings.accounts.signin_claude" },
  chatgpt: { title: "settings.accounts.chatgpt", use: "settings.accounts.use_chatgpt", signin: "settings.accounts.signin_chatgpt" },
};
const ACCOUNT_TAG: Record<AccountRowState, { tone: BadgeProps["tone"]; icon?: IconName }> = {
  not_signed_in: { tone: "neutral" },
  signing_in: { tone: "neutral" },
  signed_in: { tone: "success", icon: "check" },
  expired: { tone: "warning", icon: "warning" },
};

/** Account-login variant: Not signed in / Finishing in your browser… / Signed in with Test and Sign Out… / Signed out by the provider. */
export function AccountRow({ bridge, view, keyConfigured, onUseKey }: { bridge: Bridge; view: AccountView; keyConfigured: boolean; onUseKey?: () => void }) {
  const a = ACCOUNT[view.provider];
  const state = accountRowState(view);
  const [testLine, setTestLine] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const signOutError = useWindow(bridge, (s) => s.commands[signOutKey(view.provider)]?.state) === "ERROR";
  const { machines } = useSignIn(bridge, view.provider);
  const testing = useWindow(bridge, (s) => s.commands[testKey(view.provider)]?.state) === "WAITING";
  const status = view.status;
  const provider = providerName(view.provider);
  const tagText = {
    not_signed_in: t("settings.accounts.not_signed_in"),
    signing_in: t("settings.accounts.signing_in"),
    signed_in: t("settings.accounts.signed_in"),
    expired: t("settings.accounts.expired", { provider }),
  }[state];
  const runTest = async () => {
    setTestLine(null);
    const res = await testAccount(bridge, view.provider);
    setTestLine(res.status === "ok" ? testResultText(res.data) : t("settings.accounts.test_failed"));
  };
  // the row changes only with the core's answer; a refusal leaves it as it was and says so
  const confirmSignOut = async (also: boolean) => {
    setAsking(false);
    setTestLine(null);
    await signOutAccount(bridge, view.provider, also);
  };
  return (
    <div className="e-status st-cred" role="group" aria-label={t(a.title)} data-component={COMPONENT} data-variant="account-login" data-provider={view.provider} data-state={state}>
      <div className="e-status__main">
        <span className="e-status__title">{t(a.title)}</span>
        <Badge text={tagText} tone={ACCOUNT_TAG[state].tone} icon={ACCOUNT_TAG[state].icon} cls="st-cred__tag" />
        {status.type === "signed_in" ? (
          <>
            <span className="e-status__sub">{`${status.identity.email} · ${t("settings.accounts.through", { plan: status.identity.plan, tool: toolName(view.provider) })}`}</span>
            <span className="e-status__sub">{usedByText(view.agents)}</span>
          </>
        ) : status.type === "signed_out_by_provider" ? (
          <span className="st-row__err">{t("settings.accounts.expired_note", { provider })}</span>
        ) : (
          <span className="e-status__sub">{t(a.use)}</span>
        )}
        {testLine && <span className="st-cred__dots" role="status">{testLine}</span>}
        {signOutError && <span className="st-row__err" role="alert">{t("settings.accounts.signout_failed")}</span>}
      </div>
      <div className="st-cred__actions">
        {state === "signed_in" ? (
          <>
            <PushButton label={t("settings.accounts.test")} size="small" loading={testing} onAction={() => void runTest()} />
            <PushButton label={t("settings.accounts.sign_out")} size="small" onAction={() => setAsking(true)} />
          </>
        ) : state === "signing_in" ? (
          <>
            {/* @cpt-begin:cpt-noter-flow-ui-accounts-sign-in:p1:inst-hide */}
            <PushButton label={t("settings.accounts.show")} size="small" onAction={() => machines.dispatch(view.provider, { type: "show" })} />
            {/* @cpt-end:cpt-noter-flow-ui-accounts-sign-in:p1:inst-hide */}
            <PushButton label={t("settings.accounts.cancel")} size="small" variant="quiet" onAction={() => void machines.cancel(view.provider)} />
          </>
        ) : (
          <PushButton label={t(state === "expired" ? "settings.accounts.sign_in_again" : a.signin)} size="small" onAction={() => void machines.open(view.provider)} />
        )}
      </div>
      <AccountSignInSheet bridge={bridge} provider={view.provider} view={view} onUseKey={onUseKey} />
      {asking && (
        // @cpt-begin:cpt-noter-flow-ui-accounts-manage:p1:inst-signout
        <SignOutSheet
          provider={view.provider}
          agents={view.agents}
          keyConfigured={keyConfigured}
          onCancel={() => setAsking(false)}
          onConfirm={(also) => void confirmSignOut(also)}
        />
        // @cpt-end:cpt-noter-flow-ui-accounts-manage:p1:inst-signout
      )}
    </div>
  );
}
