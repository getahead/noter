import { useEffect, useReducer, useRef, useState } from "react";

import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { ShareTestResult } from "../../core/bindings";
import { t } from "../../i18n/format";
import { InlineBanner } from "../../ui/feedback/inline-banner";
import { Icon } from "../../ui/icons";
import { Progress } from "../../ui/primitives/progress";
import { PushButton } from "../../ui/primitives/push-button";
import { Sheet, SheetFooter } from "../../ui/primitives/sheet";
import { Table, Th } from "../../ui/primitives/table";
import { capsOf } from "./accelerator";
import { resultRows, shareTestReduce, surfaceKey, visibilityKey } from "./share-test";

const HIDE_DEFAULT = "Ctrl+Alt+Super+0";

// @cpt-flow:cpt-noter-flow-ui-settings-share-test:p1
// @cpt-dod:cpt-noter-dod-ui-settings-privacy:p1
export function ShareTestSheet({ bridge, onClose }: { bridge: Bridge; onClose: () => void }) {
  const [state, dispatch] = useReducer(shareTestReduce, "TABLE");
  const [result, setResult] = useState<ShareTestResult | null>(null);
  // @cpt-begin:cpt-noter-flow-ui-settings-share-test:p1:inst-if-call
  const call = useWindow(bridge, (s) => s.whole.capture?.phase === "recording" || s.whole.capture?.phase === "paused");
  // @cpt-end:cpt-noter-flow-ui-settings-share-test:p1:inst-if-call
  const permission = useWindow(bridge, (s) => s.whole.environment?.permissions.find((p) => p.kind === "screen_recording")?.state ?? "not_asked");
  const display = useWindow(bridge, (s) => s.whole.environment?.displays.find((d) => !d.holds_call_app)?.name ?? s.whole.environment?.displays[0]?.name ?? "");
  const hide = useWindow(bridge, (s) => s.whole.hotkeys?.bindings.find((b) => b.action === "hide_for_presenting")?.shortcut ?? HIDE_DEFAULT);

  const run = async (capture: boolean) => {
    // @cpt-begin:cpt-noter-flow-ui-settings-share-test:p1:inst-api-share
    const res = await bridge.act("share:run", "share_test_run", () => bridge.core.shareTestRun({ run_capture_test: capture }));
    // @cpt-end:cpt-noter-flow-ui-settings-share-test:p1:inst-api-share
    if (res.status === "ok") {
      setResult(res.data);
      if (capture) dispatch({ type: "outcome", outcome: res.data.capture_test });
    } else if (capture) dispatch({ type: "outcome", outcome: { type: "failed", code: res.error.code } });
  };
  // the table answers on its own, also during a call
  const asked = useRef(false);
  useEffect(() => {
    if (!asked.current) void run(false);
    asked.current = true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // @cpt-begin:cpt-noter-flow-ui-settings-share-test:p1:inst-run-capture
  const start = () => {
    dispatch({ type: "run", screenRecording: permission });
    if (permission === "granted") void run(true);
  };
  const answer = async () => {
    const res = await bridge.act("share:permission", "permission_request", () => bridge.core.permissionRequest({ kind: "screen_recording" }));
    const granted = res.status === "ok";
    dispatch({ type: "answered", granted });
    if (granted) void run(true);
  };
  // @cpt-end:cpt-noter-flow-ui-settings-share-test:p1:inst-run-capture

  // @cpt-begin:cpt-noter-flow-ui-settings-share-test:p1:inst-share-done
  // @cpt-begin:cpt-noter-flow-ui-settings-share-test:p1:inst-return-share
  const done = onClose; // Done closes the sheet and the Privacy pane is back
  // @cpt-end:cpt-noter-flow-ui-settings-share-test:p1:inst-return-share
  // @cpt-end:cpt-noter-flow-ui-settings-share-test:p1:inst-share-done
  const running = state === "RUNNING";
  return (
    <Sheet title={t("settings.share.title")} width={640} busy={running} onCancel={done} onDefault={done}>
      <div className="np-sheet__head">
        <div className="np-sheet__title">{t("settings.share.title")}</div>
      </div>
      <div className="np-sheet__body" data-state={state.toLowerCase()}>
        <h3 className="t-headline">{t("settings.share.heading")}</h3>
        {/* @cpt-begin:cpt-noter-flow-ui-settings-share-test:p1:inst-share-table */}
        <Table variant="read-only" label={t("settings.share.heading")}>
          <thead>
            <tr>
              <Th label={t("settings.share.surface")} />
              <Th label={t("settings.share.window")} />
              <Th label={t("settings.share.app")} />
              <Th label={t("settings.share.display")} />
            </tr>
          </thead>
          <tbody>
            {result?.rows.map((r) => (
              <tr key={r.surface}>
                <td>{t(surfaceKey(r.surface))}</td>
                {[r.window_share, r.app_share, r.display_share].map((v, i) => (
                  <td key={i}>{v === "depends_on_app" ? <span className="dlg-warn"><Icon name="warning" size={11} />{t(visibilityKey(v))}</span> : t(visibilityKey(v))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
        {/* @cpt-end:cpt-noter-flow-ui-settings-share-test:p1:inst-share-table */}
        {state === "ASKING" && (
          <div className="dlg-perm" data-component="cpt-noter-component-ui-status-row" data-state="asking">
            <Icon name="display" size={13} />
            <span>{t("settings.share.permission")}</span>
            <span className="np-tb__spacer" />
            <PushButton label={t("settings.share.continue")} size="small" variant="primary" onAction={() => void answer()} />
          </div>
        )}
        {state === "NEEDS_PERMISSION" && (
          <div className="dlg-perm" data-component="cpt-noter-component-ui-status-row" data-state="needs-permission">
            <Icon name="display" size={13} />
            <span>{t("settings.share.permission")}</span>
            <span className="np-tb__spacer" />
            <PushButton label={t("settings.share.open_system_settings")} size="small" onAction={() => void bridge.core.openExternal({ target: { type: "system_settings", permission: "screen_recording" } })} />
          </div>
        )}
        {running && (
          <div className="dlg-perm" role="status">
            <Progress variant="spinner" label={t("settings.share.running", { display })} />
            <span>{t("settings.share.running", { display })}</span>
          </div>
        )}
        {/* @cpt-begin:cpt-noter-flow-ui-settings-share-test:p1:inst-share-result */}
        {state === "RAN" && result && (
          <>
            <div className="dlg-capture">
              {(["settings.share.on_screen", "settings.share.what_sees"] as const).map((k) => (
                <div key={k}>
                  <div className="dlg-capture__h">{t(k)}</div>
                  <div className="dlg-capture__img">
                    <Icon name="display" size={40} />
                  </div>
                </div>
              ))}
            </div>
            <ul className="dlg-results">
              {resultRows(result.rows).map((r) => (
                <li key={r.surface} className={r.ok ? "" : "dlg-warn"}>
                  <Icon name={r.ok ? "check" : "warning"} size={12} /> {t(r.message, { surface: t(surfaceKey(r.surface)) })}
                </li>
              ))}
            </ul>
          </>
        )}
        {/* @cpt-end:cpt-noter-flow-ui-settings-share-test:p1:inst-share-result */}
        {state === "FAILED" && (
          <div className="dlg-perm dlg-warn" role="alert">
            <Icon name="warning" size={13} />
            <span>{t("settings.share.failed")}</span>
            <span className="np-tb__spacer" />
            <PushButton label={t("settings.share.try_again")} size="small" onAction={start} />
          </div>
        )}
        <InlineBanner banner={{ id: "share-limits", severity: "info", dismissible: false, text: t("settings.share.limits", { chord: capsOf(hide) }) }} />
      </div>
      <SheetFooter
        defaultButton={<PushButton label={t("settings.share.done")} variant="primary" onAction={done} />}
      >
        {/* @cpt-begin:cpt-noter-flow-ui-settings-share-test:p1:inst-capture-disabled */}
        <PushButton label={state === "RAN" ? t("settings.share.run_again") : t("settings.share.run")} loading={running} disabled={call} onAction={start} />
        {call && <span className="np-dim">{t("settings.share.during_call")}</span>}
        {/* @cpt-end:cpt-noter-flow-ui-settings-share-test:p1:inst-capture-disabled */}
      </SheetFooter>
    </Sheet>
  );
}
