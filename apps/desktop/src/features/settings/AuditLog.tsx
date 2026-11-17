import { useEffect, useMemo, useRef, useState } from "react";
import type { UiPrefs } from "../../core/bindings";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { PushButton } from "../../ui/primitives/push-button";
import { Table, Th } from "../../ui/primitives/table";
import { auditRows, createAudit, formatBytes, requestCount, totalBytes, type AuditView } from "./audit";

// @cpt-flow:cpt-noter-flow-ui-privacy-sources-audit:p1
export function AuditLog({ bridge, callId = null, onAllCalls }: { bridge: Bridge; callId?: string | null; onAllCalls?: () => void }) {
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const [v, setV] = useState<AuditView | null>(null);
  const store = useRef<ReturnType<typeof createAudit> | null>(null);
  useEffect(() => {
    const s = (store.current = createAudit(bridge, callId, setV));
    void s.load();
    return s.dispose;
  }, [bridge, callId]);
  if (!v) return <AuditLogView v={null} callId={callId} prefs={prefs} onLoad={() => {}} onExport={() => {}} onAllCalls={() => {}} />;
  return <AuditLogView v={v} callId={callId} prefs={prefs} onLoad={() => void store.current?.load()} onExport={() => void store.current?.export()} onAllCalls={() => onAllCalls?.()} />;
}

export function AuditLogView({ v, callId, prefs, onLoad, onExport, onAllCalls }: { v: AuditView | null; callId: string | null; prefs: UiPrefs | undefined; onLoad: () => void; onExport: () => void; onAllCalls: () => void }) {
  const shown = v?.rows ?? [];
  const table = useMemo(() => auditRows(shown, prefs), [shown, prefs]);
  if (!v || v.status === "loading") return <p className="st-audit__loading" role="status">{t("audit.loading")}</p>;
  const complete = v.cursor === null;
  return (
    <>
      {callId && (
        <div className="st-audit__filter" role="status">
          <span>{t("audit.filter_call", { title: shown.find((r) => r.call)?.call?.title ?? t("audit.filter_this_call") })}</span>
          <PushButton label={t("audit.all_calls")} size="small" onAction={onAllCalls} />
        </div>
      )}
      {table.length === 0 && !v.failed ? (
        <EmptyState variant="section" title={complete && !callId ? t("audit.empty") : callId ? t("audit.empty_call") : t("audit.empty_page")} />
      ) : (
        table.length > 0 && (
          <Table label={t("settings.privacy.left_mac")} cls="st-audit">
            <thead><tr><Th label={t("audit.time")} /><Th label={t("audit.what")} /><Th label={t("audit.size")} /><Th label={t("audit.destination")} /></tr></thead>
            <tbody>{table.map((r) => (
              <tr key={r.id}><td>{r.time}</td><td>{r.what}{r.redacted ? ` · ${t("audit.redacted")}` : ""}</td><td className="np-tnum">{r.size}</td><td>{r.destination}</td></tr>
            ))}</tbody>
          </Table>
        )
      )}
      {v.failed && <p className="hd__err" role="alert">{t("audit.error")} <PushButton label={t("action.try_again")} size="small" disabled={v.busy} onAction={onLoad} /></p>}
      <div className="st-audit__foot" aria-live="polite">
        {table.length > 0 && (complete ? t("audit.total", { count: requestCount(shown), size: formatBytes(totalBytes(shown)) }) : v.total != null ? t("audit.shown_of", { shown: shown.length, total: v.total }) : t("audit.total_so_far", { count: requestCount(shown), size: formatBytes(totalBytes(shown)) }))}
        {!complete && !v.failed && <PushButton label={t("audit.more")} size="small" disabled={v.busy} onAction={onLoad} />}
        <PushButton label={t("audit.export")} size="small" disabled={v.exporting || (!!callId && table.length === 0)} onAction={onExport} />
        {v.exportFailed && <span role="alert">{t("audit.export_failed")}</span>}
        {v.exported && <span>{t("audit.exported", { path: v.exported })}</span>}
      </div>
    </>
  );
}
