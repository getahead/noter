// **Add Folder**: the 520-pt source form. It sends only privacy and scope (the core opens the folder panel, so
// there is no path to preview first); folders are always indexed and watched, so no mode or schedule fields.
import { useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { PrivacyClass } from "../../core/bindings";
import { t } from "../../i18n/format";
import { PopupButton } from "../../ui/primitives/popup-button";
import { RadioGroup } from "../../ui/primitives/radio-group";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { ScopeFields, useCallTypes } from "./ScopeFields";
import { ALL_SCOPE, addFolder, scopeOf, scopeValid, type ScopeDraft } from "./sources";

export const PRIVACY_CHOICES = () => [
  { value: "normal", label: t("sources.privacy_normal") },
  { value: "sensitive", label: t("sources.privacy_sensitive") },
];

export function AddFolderSheet({ bridge, onClose }: { bridge: Bridge; onClose: () => void }) {
  const [privacy, setPrivacy] = useState<PrivacyClass>("normal");
  const [scope, setScope] = useState<ScopeDraft>(ALL_SCOPE);
  const types = useCallTypes(bridge);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    if (busy) return;
    if (!scopeValid(scope)) return setError(t("sources.error_scope"));
    setBusy(true);
    setError(null);
    const r = await addFolder(bridge, privacy, scopeOf(scope));
    setBusy(false);
    if (r.ok) onClose();
    // a cancelled folder panel adds nothing and keeps the form
    else if (r.code !== "cancelled") setError(r.field === "path" && r.rule === "duplicate" ? t("sources.error_duplicate") : t("sources.error_add"));
  };
  return (
    <Sheet title={t("sources.add_folder_title")} width={520} busy={busy} onCancel={onClose} onDefault={() => void add()}>
      <div className="np-sheet__head"><div className="np-sheet__title">{t("sources.add_folder_title")}</div><div className="np-sheet__sub">{t("sources.add_folder_note")}</div></div>
      <div className="np-sheet__body">
        <RadioGroup name="src-folder-mode" label={t("sources.mode")} value="indexed" options={[{ value: "indexed", label: t("sources.mode_indexed"), note: t("sources.folder_indexed_note") }, { value: "live", label: t("sources.mode_live"), note: t("sources.folder_live_off"), disabled: true }]} />
        <label className="st-row__label" htmlFor="src-privacy">{t("sources.privacy")}</label>
        <PopupButton id="src-privacy" label={t("sources.privacy")} options={PRIVACY_CHOICES()} value={privacy} onAction={(v) => setPrivacy(v as PrivacyClass)} />
        <p className="np-dim">{privacy === "sensitive" ? t("sources.privacy_sensitive_note") : t("sources.privacy_normal_note")}</p>
        <ScopeFields types={types} value={scope} onChange={setScope} />
        {error && <p className="hd__err" role="alert">{error}</p>}
      </div>
      <SheetFooter defaultButton={<PushButton label={t("sources.add_source")} variant="primary" disabled={busy} onAction={() => void add()} />}>
        <PushButton label={t("dialogs.cancel")} onAction={onClose} />
      </SheetFooter>
    </Sheet>
  );
}
