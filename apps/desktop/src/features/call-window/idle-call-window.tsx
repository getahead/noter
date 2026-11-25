import { useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { CallLayout, ErrorCode } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { PushButton } from "../../ui/primitives/push-button";
import { recordBlock } from "../today/model";

// @cpt-component:cpt-noter-component-shell-call-window:p1
export function IdleCallWindow({ bridge, layout }: { bridge: Bridge; layout: CallLayout }) {
  const setup = useWindow(bridge, (s) => s.whole.setup);
  const environment = useWindow(bridge, (s) => s.whole.environment);
  const starting = useWindow(bridge, (s) => s.commands.capture_start?.state === "WAITING");
  const [refusal, setRefusal] = useState<ErrorCode | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const block = recordBlock(setup, environment);
  const blocker = block ?? (refusal === "model_missing" || refusal === "disk_full" ? refusal : null);
  const models = blocker === "model_missing";
  const reason = blocker ? t(models ? "today.record_model_missing" : "today.record_disk_full") : undefined;

  // @cpt-begin:cpt-noter-state-ui-call-window-window:p1:inst-start-idle
  async function start() {
    setActionFailed(false);
    setRefusal(null);
    const result = await bridge.act("capture_start", "capture_start", () => bridge.core.captureStart({ source: "call_window", sensitive: false }), { slice: "capture" });
    if (result.status === "error") setRefusal(result.error.code);
  }
  // @cpt-end:cpt-noter-state-ui-call-window-window:p1:inst-start-idle

  // @cpt-begin:cpt-noter-state-ui-call-window-window:p1:inst-close-idle
  async function close() {
    const result = await bridge.act("window_hide_call", "window_hide_call", () => bridge.core.windowHideCall({}), { slice: "callWindow" });
    setActionFailed(result.status === "error");
  }
  // @cpt-end:cpt-noter-state-ui-call-window-window:p1:inst-close-idle

  async function openSettings() {
    const result = await bridge.core.windowNavigate({ target: { type: "settings", pane: models ? "models_and_runtimes" : "maintenance" } });
    setActionFailed(result.status === "error");
  }

  return (
    <main className={`np-win cw-win cw-win--${layout} cw-idle`} data-component="cpt-noter-component-shell-call-window" data-variant={layout} data-state="idle">
      <EmptyState variant="large" icon="record" heading title={t("cw.indicator.not_recording")} body={reason}
        linkLabel={blocker ? t(models ? "settings.pane.models_and_runtimes" : "settings.pane.maintenance") : undefined} onLink={openSettings} />
      <div className="cw-idle__actions">
        <PushButton label={t("cw.close")} onAction={close} />
        <PushButton label={t("menu.start_recording")} variant="primary" disabled={!!block} help={reason} loading={starting} onAction={start} />
      </div>
      {actionFailed && <p role="status">{t("window.error")}</p>}
      {refusal && !blocker && <p role="status">{t("today.record_failed")}</p>}
    </main>
  );
}
