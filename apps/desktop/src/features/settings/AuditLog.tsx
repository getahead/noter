import { useEffect, useMemo, useRef, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { PushButton } from "../../ui/primitives/push-button";
import { Table, Th } from "../../ui/primitives/table";
import { auditRows, createAudit, forCall, formatBytes, requestCount, totalBytes, type AuditView } from "./audit";

// @cpt-flow:cpt-noter-flow-ui-privacy-sources-audit:p1
export function AuditLog({ bridge, callId = null }: { bridge: Bridge; callId?: string | null }) {
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const [v, setV] = useState<AuditView | null>(null);
  const store = useRef<ReturnType<typeof createAudit> | null>(null);
  useEffect(() => {
    const s = (store.current = createAudit(bridge, setV));
    void s.load();
    return s.dispose;
  }, [bridge]);
  const shown = useMemo(() => forCall(v?.rows ?? [], callId), [v?.rows, callId]);
  const table = useMemo(() => auditRows(shown, prefs), [shown, prefs]);
  if (!v || v.status === "loading") return <p className="st-audit__loading" role="status">{t("audit.loading")}</p>;
  const complete = v.cursor === null;
  return (
    <>
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
      {v.failed && <p className="hd__err" role="alert">{t("audit.error")} <PushButton label={t("action.try_again")} size="small" disabled={v.busy} onAction={() => void store.current?.load()} /></p>}
      <div className="st-audit__foot" aria-live="polite">
        {table.length > 0 && t(complete ? "audit.total" : "audit.total_so_far", { count: requestCount(shown), size: formatBytes(totalBytes(shown)) })}
        {!complete && !v.failed && <PushButton label={t("audit.more")} size="small" disabled={v.busy} onAction={() => void store.current?.load()} />}
        <PushButton label={t("audit.export")} size="small" disabled={!!callId || v.exporting} help={callId ? t("audit.export_all_only") : undefined} onAction={() => void store.current?.export()} />
        {v.exported && <span>{t("audit.exported", { path: v.exported })}</span>}
      </div>
    </>
  );
}
