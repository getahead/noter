// Set Up Voice Profile (480 pt): the explicit opt-in. Naming a speaker never gets here; only this button creates a profile.
import { useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { PersonRow } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { createProfile } from "./actions";

export function VoiceProfileSheet({ close, bridge, person, calls }: { close: () => void; bridge: Bridge; person: PersonRow; calls: number }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function create() {
    if (busy) return; // a second press is no second submission
    setBusy(true);
    const ok = await createProfile(bridge, person);
    setBusy(false);
    setFailed(!ok);
    if (ok) close();
  }
  return (
    <Sheet title={t("person.voice.title")} width={480} busy={busy} onCancel={close} onDefault={() => void create()}>
      <div className="np-sheet__head">
        <div className="np-sheet__title">{t("person.voice.title")}</div>
        <div className="np-dim">{person.display_name}</div>
      </div>
      <div className="np-sheet__body">
        <p>{t("person.voice.body")}</p>
        <p className="np-muted">{t("person.voice.built", { name: person.short_name, count: calls })}</p>
        {failed && <InlineBanner banner={{ id: "person-voice-error", severity: "error", text: t("person.voice.err") }} />}
      </div>
      <SheetFooter defaultButton={<PushButton label={t("person.voice.create")} variant="primary" submit loading={busy} onAction={() => void create()} />}>
        <PushButton label={t("dialogs.cancel")} onAction={close} />
      </SheetFooter>
    </Sheet>
  );
}
