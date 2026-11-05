// Credential row (DESIGN 3.2): one API key as a row (Settings) or a field form (first run), and one own
// account as its frame (the sign-in arrives in M3). The key itself is never shown or held.
import type { Bridge } from "../../app/bridge/bridge";
import type { AccountProvider, AccountView, KeyView } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { InlineStatus } from "../../ui/feedback/inline-status";
import { Icon, type IconName } from "../../ui/icons";
import { PushButton } from "../../ui/primitives/push-button";
import { KeyField, useKeyDraft } from "./KeyField";
import { KEY_NAME, KEY_USE, keyRowState, reasonText, type KeyRowState } from "./keys";

const COMPONENT = "cpt-noter-component-ui-credential-row";
const TAG: Record<KeyRowState, { label: MsgKey; icon: IconName | null; tone: string }> = {
  not_set: { label: "settings.keys.not_set", icon: null, tone: "neutral" },
  configured: { label: "settings.keys.configured", icon: "check", tone: "success" },
  rejected: { label: "settings.keys.rejected", icon: "error", tone: "error" },
  verifying: { label: "settings.keys.verifying", icon: null, tone: "neutral" },
  keychain_locked: { label: "settings.keys.locked", icon: "warning", tone: "warning" },
};

function Tag({ state }: { state: KeyRowState }) {
  const tag = TAG[state];
  return (
    <span className="st-cred__tag" data-tone={tag.tone}>
      {tag.icon && <Icon name={tag.icon} size={12} />}
      {t(tag.label)}
    </span>
  );
}

export interface KeyRowProps {
  view: KeyView;
  /** **Saved** beside the actions for 2 s after the sheet closed on a stored key. */
  saved?: boolean;
  onSavedExpire?: () => void;
  onAdd: () => void;
  onReplace: () => void;
  onRemove: () => void;
}

// @cpt-component:cpt-noter-component-ui-credential-row:p1
/** Row variant: name, use line, state tag, the Keychain line and **Add…** / **Replace…** / **Remove…**. */
export function KeyRow({ view, saved, onSavedExpire, onAdd, onReplace, onRemove }: KeyRowProps) {
  const state = keyRowState(view);
  const busy = state === "verifying" || state === "keychain_locked";
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
          <PushButton label={t("settings.keys.add")} size="small" onAction={onAdd} />
        ) : (
          <>
            <PushButton label={t("settings.keys.replace")} size="small" disabled={busy} onAction={onReplace} />
            <PushButton label={t("settings.keys.remove")} size="small" disabled={busy} onAction={onRemove} />
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
  return (
    <div className="st-cred st-cred--field" data-component={COMPONENT} data-variant="field" data-state={stored ? "configured" : draft.state.toLowerCase()}>
      <label className="fr-sublabel" htmlFor={`fr-key-${view.provider}`}>
        {t(KEY_NAME[view.provider])}
      </label>
      {stored ? (
        <div className="st-keyfield">
          <span className="st-cred__dots">{t("settings.keys.keychain")}</span>
          <PushButton label={t("settings.keys.remove_short")} size="small" onAction={onRemove} />
        </div>
      ) : (
        <KeyField id={`fr-key-${view.provider}`} label={t(KEY_NAME[view.provider])} draft={draft} verifiedText={t("settings.keys.keychain")} />
      )}
    </div>
  );
}

const ACCOUNT: Record<AccountProvider, { title: MsgKey; use: MsgKey; signin: MsgKey }> = {
  claude: { title: "settings.accounts.claude", use: "settings.accounts.use_claude", signin: "settings.accounts.signin_claude" },
  chatgpt: { title: "settings.accounts.chatgpt", use: "settings.accounts.use_chatgpt", signin: "settings.accounts.signin_chatgpt" },
};

/** Account-login variant, M2 frame: the row says the sign-in arrives in M3 (as the later panes do). */
export function AccountRow({ view }: { view: AccountView }) {
  const a = ACCOUNT[view.provider];
  return (
    <div className="e-status st-cred" data-component={COMPONENT} data-variant="account-login" data-state="not_signed_in">
      <div className="e-status__main">
        <span className="e-status__title">{t(a.title)}</span>
        <span className="e-status__sub">{t(a.use)}</span>
        <span className="st-cred__tag" data-tone="neutral">
          {t("settings.accounts.not_signed_in")}
        </span>
      </div>
      <div className="st-cred__actions">
        <PushButton label={t(a.signin)} size="small" disabled help={t("settings.accounts.later")} />
      </div>
    </div>
  );
}
