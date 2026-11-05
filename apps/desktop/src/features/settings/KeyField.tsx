// The secure key field with **Verify** and its result line: the same control in the key sheet and in the
// first-run Assistants step. The draft lives in this component only and leaves with it.
import { useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { KeyProvider } from "../../core/bindings";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import { TextField } from "../../ui/primitives/text-field";
import { setKey } from "./accounts";
import { canVerify, reasonText, sheetNext, type SheetState } from "./keys";

export interface KeyDraft {
  draft: string;
  state: SheetState;
  /** The line under the field after a refusal. */
  message: string | null;
  edit: (value: string) => void;
  /** **Verify** or Return: one `api_key_set` with the draft; true when the key was stored. */
  verify: () => Promise<boolean>;
}

/** The key sheet's machine over the bridge: KEY_DRAFT → KEY_VERIFYING → KEY_CONFIGURED | KEY_INVALID | KEYCHAIN_LOCKED. */
export function useKeyDraft(bridge: Bridge, provider: KeyProvider, onLocked?: () => void): KeyDraft {
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<SheetState>("DRAFT");
  const [message, setMessage] = useState<string | null>(null);
  // Return right after typing reads the latest draft and state, not the render's closure
  const latest = useRef({ draft, state });
  const go = (next: { draft?: string; state?: SheetState }) => {
    latest.current = { ...latest.current, ...next };
    if (next.draft !== undefined) setDraft(next.draft);
    if (next.state !== undefined) setState(next.state);
  };
  const edit = (value: string) => {
    go({ draft: value, state: sheetNext(latest.current.state, "edit") });
    setMessage(null);
  };
  const verify = async () => {
    // @cpt-begin:cpt-noter-flow-ui-accounts-key:p1:inst-enter
    const { draft: key, state: at } = latest.current;
    if (!canVerify(at, key)) return false;
    go({ state: sheetNext(at, "submit") });
    // @cpt-end:cpt-noter-flow-ui-accounts-key:p1:inst-enter
    const res = await setKey(bridge, provider, key);
    if (res.status === "ok") {
      // @cpt-begin:cpt-noter-flow-ui-accounts-key:p1:inst-saved
      go({ draft: "", state: sheetNext("VERIFYING", "ok") });
      setMessage(null);
      return true;
      // @cpt-end:cpt-noter-flow-ui-accounts-key:p1:inst-saved
    }
    // @cpt-begin:cpt-noter-flow-ui-accounts-key:p1:inst-if-rejected
    // @cpt-begin:cpt-noter-flow-ui-accounts-key:p1:inst-invalid
    const code = res.error.code;
    if (code === "keychain_locked") {
      go({ state: sheetNext("VERIFYING", "locked") });
      setMessage(t("settings.keys.locked_line"));
      onLocked?.();
      return false;
    }
    // the core's accounts view carries the provider's reason once the key was refused
    const status = bridge.store.getState().whole.accounts?.keys.find((k) => k.provider === provider)?.status;
    go({ state: sheetNext("VERIFYING", "rejected") });
    setMessage(code === "key_rejected" ? reasonText(provider, status?.type === "rejected" ? status.reason : "key_rejected") : t("settings.keys.error"));
    return false;
    // @cpt-end:cpt-noter-flow-ui-accounts-key:p1:inst-invalid
    // @cpt-end:cpt-noter-flow-ui-accounts-key:p1:inst-if-rejected
  };
  return { draft, state, message, edit, verify };
}

/** The field, **Verify** and the result line; `id` names the field for the sheet's and the step's labels. */
export function KeyField({ id, label, placeholder, draft: k, verifiedText }: { id: string; label: string; placeholder: string; draft: KeyDraft; verifiedText: string }) {
  const verifying = k.state === "VERIFYING";
  const invalid = k.state === "INVALID" || k.state === "LOCKED";
  return (
    <div className="st-keyfield" data-state={k.state.toLowerCase()}>
      <TextField id={id} variant="secure" ariaLabel={label} placeholder={placeholder} value={k.draft} invalid={invalid} message={k.message ?? undefined} disabled={verifying} onChange={k.edit} onEnter={() => void k.verify()} />
      <PushButton label={t("settings.keys.verify")} size="small" loading={verifying} disabled={!canVerify(k.state, k.draft)} onAction={() => void k.verify()} />
      {k.state === "VERIFIED" && (
        <div className="st-keyfield__ok" role="status">
          {verifiedText}
        </div>
      )}
    </div>
  );
}
