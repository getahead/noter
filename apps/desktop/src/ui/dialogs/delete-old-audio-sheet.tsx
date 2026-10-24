import { t } from "../../i18n/format";
import { PushButton } from "../primitives/push-button";
import { Sheet, SheetFooter } from "../primitives/sheet";
import type { SheetProps } from "./sheets";

/** **Delete Old Audio…**: the sheet's frame. Its command `audio_delete_older` is M2, so the destructive button stays off until the owner passes `onDelete`. */
export function DeleteOldAudioSheet({
  close,
  days = 30,
  busy,
  onDelete,
}: SheetProps & { days?: number; busy?: boolean; onDelete?: () => void }) {
  return (
    <Sheet
      title={t("dialogs.old_audio.title")}
      width={480}
      busy={busy}
      onCancel={close}
    >
      <div className="np-sheet__head">
        <div className="np-sheet__title">{t("dialogs.old_audio.title")}</div>
      </div>
      <div className="np-sheet__body">
        <p>{t("dialogs.old_audio.message", { days })}</p>
        <p className="np-dim">{t("dialogs.old_audio.note")}</p>
      </div>
      <SheetFooter
        defaultButton={
          <PushButton
            label={t("dialogs.old_audio.confirm")}
            variant="destructive"
            loading={busy}
            disabled={!onDelete}
            onAction={onDelete}
          />
        }
      >
        <PushButton label={t("dialogs.cancel")} onAction={close} />
      </SheetFooter>
    </Sheet>
  );
}
