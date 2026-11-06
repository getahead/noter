// **Export…** (sheet `export`): what to put in the folder the core's save panel names. At least one thing is chosen;
// Audio only while it is kept. The core shows the panel, so a cancelled one just closes the sheet.
import { useEffect, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import type { ShareScope } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { useSheetIfAny } from "../../ui/dialogs/host";
import type { SheetProps } from "../../ui/dialogs/sheets";
import { Checkbox } from "../../ui/primitives/checkbox";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { runExport } from "./share-actions";
import { scopeLine, scopeOf, type ShareOrigin } from "./share-logic";

// @cpt-flow:cpt-noter-flow-ui-call-page-outputs-share:p1
export function ExportSheet({ close, bridge, callId, scopeLabel, scope, audioKept, onExported }: SheetProps & { bridge: Bridge; callId: string; scopeLabel: string; scope: ShareScope | null; audioKept: boolean; onExported: (path: string) => void }) {
  const [on, setOn] = useState({ summary_and_items: true, transcript: false, audio: false });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const none = !on.summary_and_items && !on.transcript && !(audioKept && on.audio);
  const flip = (k: keyof typeof on) => (v: boolean) => setOn((p) => ({ ...p, [k]: v }));

  const run = async () => {
    if (busy || none) return;
    setBusy(true);
    const r = await runExport(bridge, callId, { ...on, audio: audioKept && on.audio }, scope);
    setBusy(false);
    if (r.kind === "failed") return setFailed(true); // options stay for another try
    if (r.kind === "done") onExported(r.path);
    close();
  };

  return (
    <Sheet title={t("export.title")} width={480} busy={busy} onCancel={close} onDefault={() => void run()}>
      <div className="np-sheet__head">
        <div className="np-sheet__title">{t("export.title")}</div>
        <div className="np-dim">{t("export.scope", { scope: scopeLabel })}</div>
      </div>
      <div className="np-sheet__body">
        <Checkbox label={t("export.summary")} checked={on.summary_and_items} onAction={flip("summary_and_items")} />
        <Checkbox label={t("export.transcript")} checked={on.transcript} onAction={flip("transcript")} />
        {audioKept && <Checkbox label={t("export.audio")} checked={on.audio} onAction={flip("audio")} />}
        {none && <p className="np-dim" role="status">{t("export.none")}</p>}
        {failed && <InlineBanner banner={{ id: "export-error", severity: "error", text: t("export.failed"), actions: [{ label: t("action.try_again"), onAction: () => void run() }] }} />}
      </div>
      <SheetFooter defaultButton={<PushButton label={t("export.confirm")} variant="primary" submit loading={busy} disabled={none} onAction={() => void run()} />}>
        <PushButton label={t("outputs.cancel")} onAction={close} />
      </SheetFooter>
    </Sheet>
  );
}

/** Opens the sheet for a call and a scope; registers it with the host the first time a page asks. */
export function useExport(bridge: Bridge, callId: string, audioKept: boolean, onExported: (path: string) => void) {
  const sheets = useSheetIfAny();
  useEffect(() => sheets?.register("export", ExportSheet as never), [sheets]);
  return (origin: ShareOrigin) => sheets?.open("export", { bridge, callId, scopeLabel: scopeLine(origin), scope: origin.type === "toolbar" ? null : scopeOf(origin, false), audioKept, onExported });
}
