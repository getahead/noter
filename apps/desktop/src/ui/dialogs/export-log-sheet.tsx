// **Export Log…** (`dlg-export-log`): the call's change log as Markdown or JSON; the core owns the save panel.
import { useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { LogFormat } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../feedback/inline-banner";
import { PushButton } from "../primitives/push-button";
import { RadioGroup } from "../primitives/radio-group";
import { Sheet, SheetFooter } from "../primitives/sheet";
import type { SheetProps } from "./sheets";

type Props = SheetProps & { bridge: Bridge; callId: string; callTitle: string; onExported: (path: string) => void };

// @cpt-flow:cpt-noter-flow-ui-history-undo-export:p1
export function ExportLogSheet({ close, bridge, callId, callTitle, onExported }: Props) {
  const [format, setFormat] = useState<LogFormat>("markdown");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    // @cpt-begin:cpt-noter-flow-ui-history-undo-export:p1:inst-export
    const res = await bridge.act("history:export", "history_export", () => bridge.core.historyExport({ scope: { type: "call", call_id: callId }, format }), { screen: "export-log" });
    // @cpt-end:cpt-noter-flow-ui-history-undo-export:p1:inst-export
    setBusy(false);
    if (res.status === "ok") {
      // @cpt-begin:cpt-noter-flow-ui-history-undo-export:p1:inst-done
      onExported(res.data.path);
      close();
      // @cpt-end:cpt-noter-flow-ui-history-undo-export:p1:inst-done
    } else if (res.error.code === "cancelled") {
      // @cpt-begin:cpt-noter-flow-ui-history-undo-export:p1:inst-cancel
      close(); // the save panel was cancelled: back to History, no status
      // @cpt-end:cpt-noter-flow-ui-history-undo-export:p1:inst-cancel
    } else {
      // @cpt-begin:cpt-noter-flow-ui-history-undo-export:p1:inst-error
      setFailed(true); // the sheet and the chosen format stay for another try
      // @cpt-end:cpt-noter-flow-ui-history-undo-export:p1:inst-error
    }
  }

  return (
    <Sheet title={t("dialogs.export_log.title")} width={440} busy={busy} onCancel={close} onDefault={() => void run()}>
      <div className="np-sheet__head">
        <div className="np-sheet__title">{t("dialogs.export_log.title")}</div>
        <div className="np-dim">{callTitle}</div>
      </div>
      <div className="np-sheet__body">
        {/* @cpt-begin:cpt-noter-flow-ui-history-undo-export:p1:inst-choose */}
        <p>{t("dialogs.export_log.period")}</p>
        <RadioGroup
          name="export-log-format"
          label={t("dialogs.export_log.format")}
          value={format}
          options={[
            { value: "markdown", label: t("dialogs.export_log.markdown") },
            { value: "json", label: t("dialogs.export_log.json") },
          ]}
          onAction={(v) => setFormat(v as LogFormat)}
        />
        {/* @cpt-end:cpt-noter-flow-ui-history-undo-export:p1:inst-choose */}
        {failed && <InlineBanner banner={{ id: "export-log-error", severity: "error", text: t("dialogs.export_log.error"), actions: [{ label: t("action.try_again"), onAction: () => void run() }] }} />}
      </div>
      <SheetFooter defaultButton={<PushButton label={t("dialogs.export_log.confirm")} variant="primary" submit loading={busy} onAction={() => void run()} />}>
        <PushButton label={t("dialogs.cancel")} onAction={close} />
      </SheetFooter>
    </Sheet>
  );
}
