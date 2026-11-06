// **Delete Old Audio…** from the capture/disk warning: the core's `nav:request delete_old_audio` opens the 30-day sheet
// over the current page; its button runs `audio_delete_older` and the totals come from the result.
import { useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { NavTarget } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineStatus } from "../feedback/inline-status";
import { DeleteOldAudioSheet } from "./delete-old-audio-sheet";
import { useSheetIfAny } from "./host";
import type { SheetProps } from "./sheets";

// @cpt-flow:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1
function OldAudioSheet({ close, bridge, onFreed }: SheetProps & { bridge: Bridge; onFreed: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(false);
    // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-delete-old
    const r = await bridge.act("audio:delete_older", "audio_delete_older", () => bridge.core.audioDeleteOlder({ older_than_days: 30 }));
    // @cpt-end:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-delete-old
    setBusy(false);
    // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-sheet-return
    if (r.status === "error") return setError(true);
    onFreed(t("audio.freed", { count: r.data.calls, mb: Math.round(r.data.freed_mb) }));
    close();
    // @cpt-end:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-sheet-return
  };
  return <DeleteOldAudioSheet close={close} busy={busy} onDelete={() => void run()} error={error ? t("audio.failed") : undefined} />;
}

/** Opens the sheet on the request and shows the freed totals once it closed. */
export function OldAudio({ bridge, nav }: { bridge: Bridge; nav: NavTarget | null }) {
  const sheets = useSheetIfAny();
  const [freed, setFreed] = useState<string | null>(null);
  useEffect(() => sheets?.register("delete-old-audio", OldAudioSheet as never), [sheets]);
  // @cpt-begin:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-old
  useEffect(() => void (nav?.type === "delete_old_audio" && sheets?.open("delete-old-audio", { bridge, onFreed: setFreed })), [nav, sheets, bridge]);
  // @cpt-end:cpt-noter-flow-ui-call-page-outputs-tags-audio:p1:inst-old
  return freed ? <InlineStatus text={freed} variant="notice" onExpire={() => setFreed(null)} /> : null;
}
