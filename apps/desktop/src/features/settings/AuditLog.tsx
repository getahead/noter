import { useEffect, useMemo, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { AuditEntry } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { PushButton } from "../../ui/primitives/push-button";
import { Table, Th } from "../../ui/primitives/table";
import { auditRows, exportAudit, formatBytes, mergePage, readAudit, requestCount, totalBytes } from "./audit";

// @cpt-flow:cpt-noter-flow-ui-privacy-sources-audit:p1
export function AuditLog({ bridge, callId = null }: { bridge: Bridge; callId?: string | null }) {
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [exported, setExported] = useState<string | null>(null);
  const load = async (from: string | null) => {
    const page = await readAudit(bridge, from);
    if (!page) return setState("error");
    setRows((prev) => mergePage(prev, page.rows));
    setCursor(page.next_cursor);
    setState("ready");
  };
  useEffect(() => void load(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => (callId ? rows.filter((r) => r.call?.id === callId) : rows), [rows, callId]);
  const table = useMemo(() => auditRows(shown, prefs), [shown, prefs]);
  if (state === "loading") return null;
  if (state === "error") return <p className="hd__err" role="alert">{t("audit.error")} <PushButton label={t("action.try_again")} size="small" onAction={() => void load(cursor)} /></p>;
  const complete = cursor === null;
  return (
    <>
      {table.length === 0 ? (
        <EmptyState variant="section" title={complete && !callId ? t("audit.empty") : callId ? t("audit.empty_call") : t("audit.empty_page")} />
      ) : (
        <Table label={t("settings.privacy.left_mac")} cls="st-audit">
          <thead><tr><Th label={t("audit.time")} /><Th label={t("audit.what")} /><Th label={t("audit.size")} /><Th label={t("audit.destination")} /></tr></thead>
          <tbody>{table.map((r) => (
            <tr key={r.id}><td>{r.time}</td><td>{r.what}{r.redacted ? ` · ${t("audit.redacted")}` : ""}</td><td className="np-tnum">{r.size}</td><td>{r.destination}</td></tr>
          ))}</tbody>
        </Table>
      )}
      <div className="st-audit__foot" aria-live="polite">
        {table.length > 0 && t("audit.total", { count: requestCount(shown), size: formatBytes(totalBytes(shown)) })}
        {!complete && <PushButton label={t("audit.more")} size="small" onAction={() => void load(cursor)} />}
        <PushButton label={t("audit.export")} size="small" disabled={!!callId} help={callId ? t("audit.export_all_only") : undefined} onAction={() => void exportAudit(bridge, "markdown").then((r) => setExported(r?.path ?? null))} />
        {exported && <span>{t("audit.exported", { path: exported })}</span>}
      </div>
    </>
  );
}
