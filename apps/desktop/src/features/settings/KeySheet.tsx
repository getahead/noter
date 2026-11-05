// **Add…** / **Replace…** an API key: a sheet with the secure field, **Verify** (checks and stores, D-3) and
// **Save**, which only closes it. Cancel before Verify leaves the old key; after a successful Verify it only closes.
import type { Bridge } from "../../app/bridge/bridge";
import type { KeyProvider } from "../../core/bindings";
import { t } from "../../i18n/format";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { KeyField, useKeyDraft } from "./KeyField";
import { canSave, KEY_TITLE } from "./keys";

export function KeySheet({ bridge, provider, mode, onClose, onLocked }: { bridge: Bridge; provider: KeyProvider; mode: "add" | "replace"; onClose: (saved: boolean) => void; onLocked?: () => void }) {
  const draft = useKeyDraft(bridge, provider, onLocked);
  const name = t(KEY_TITLE[provider]);
  const title = t(mode === "add" ? "settings.keys.sheet_add" : "settings.keys.sheet_replace", { name });
  const saved = canSave(draft.state);
  // Return in the field verifies; the sheet's default (⌘Return) saves once verified
  return (
    <Sheet title={title} width={480} busy={draft.state === "VERIFYING"} onCancel={() => onClose(saved)} onDefault={() => (saved ? onClose(true) : void draft.verify())}>
      <div className="np-sheet__head">
        <div className="np-sheet__title">{title}</div>
        <div className="np-sheet__sub">{t("settings.keys.sheet_note")}</div>
      </div>
      <div className="np-sheet__body">
        <KeyField id={`key-${provider}`} label={t("settings.keys.field")} placeholder={t("settings.keys.placeholder")} draft={draft} verifiedText={t(provider === "anthropic" ? "settings.keys.verified_anthropic" : "settings.keys.verified_codex")} />
      </div>
      <SheetFooter defaultButton={<PushButton label={t("settings.keys.save")} variant="primary" disabled={!saved} onAction={() => onClose(true)} />}>
        <PushButton label={t("dialogs.cancel")} onAction={() => onClose(saved)} />
      </SheetFooter>
    </Sheet>
  );
}
