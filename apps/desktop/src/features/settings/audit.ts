import type { Bridge } from "../../app/bridge/bridge";
import type { AuditEntry, AuditWhat, ExportResult, LogFormat, Page } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { clock, locale, shortDay, t } from "../../i18n/format";
import type { UiPrefs } from "../../core/bindings";

const WHAT: Record<AuditWhat, MsgKey> = {
  transcript_delta: "audit.what.transcript",
  full_transcript: "audit.what.transcript",
  outputs: "audit.what.summary",
  document_excerpts: "audit.what.excerpts",
  search_question: "audit.what.question",
  evidence_lookup: "audit.what.evidence",
  live_mcp_query: "audit.what.lookup",
  handoff_prompt: "audit.what.handoff",
};

export interface AuditRow {
  id: string;
  callId: string | null;
  time: string;
  what: string;
  size: string;
  destination: string;
  redacted: boolean;
}

// @cpt-begin:cpt-noter-algo-ui-privacy-sources-audit-rows:p1:inst-page
/** Append a page: each audit id once, the core's order kept. */
export function mergePage(rows: readonly AuditEntry[], page: readonly AuditEntry[]): AuditEntry[] {
  const seen = new Set(rows.map((r) => r.id));
  return [...rows, ...page.filter((r) => !seen.has(r.id) && seen.add(r.id))];
}

/** Filter by the returned call id, never by title. */
export const forCall = (rows: readonly AuditEntry[], callId: string | null): AuditEntry[] => (callId ? rows.filter((r) => r.call?.id === callId) : [...rows]);
// @cpt-end:cpt-noter-algo-ui-privacy-sources-audit-rows:p1:inst-page

export function formatBytes(n: number): string {
  const [unit, div] = n >= 1_000_000 ? (["megabyte", 1_000_000] as const) : n >= 1000 ? (["kilobyte", 1000] as const) : (["byte", 1] as const);
  return new Intl.NumberFormat(locale(), { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: unit === "byte" ? 0 : 1 }).format(n / div);
}

// @cpt-begin:cpt-noter-algo-ui-privacy-sources-audit-rows:p1:inst-counts
/** A request is a run or a lookup: tool results belong to their run and are not requests of their own. */
export const requestCount = (rows: readonly AuditEntry[]): number => rows.filter((r) => r.kind !== "tool_result").length;
export const totalBytes = (rows: readonly AuditEntry[]): number => rows.reduce((sum, r) => sum + r.bytes_out, 0);
// @cpt-end:cpt-noter-algo-ui-privacy-sources-audit-rows:p1:inst-counts

// @cpt-begin:cpt-noter-algo-ui-privacy-sources-audit-rows:p1:inst-words
// @cpt-begin:cpt-noter-algo-ui-privacy-sources-audit-rows:p1:inst-redaction
// @cpt-begin:cpt-noter-algo-ui-privacy-sources-audit-rows:p1:inst-return
export function auditRows(rows: readonly AuditEntry[], prefs: UiPrefs | undefined): AuditRow[] {
  return rows.map((r) => ({
    id: r.id,
    callId: r.call?.id ?? null,
    time: `${shortDay(r.at, prefs)} ${clock(r.at, prefs)}`,
    what: (r.kind === "tool_result" ? t("audit.what.tool_result") + " · " : "") + t(WHAT[r.what]) + (r.call ? ` · ${r.call.title}` : ""),
    size: formatBytes(r.bytes_out),
    destination: r.destination,
    redacted: r.redacted,
  }));
}
// @cpt-end:cpt-noter-algo-ui-privacy-sources-audit-rows:p1:inst-return
// @cpt-end:cpt-noter-algo-ui-privacy-sources-audit-rows:p1:inst-redaction
// @cpt-end:cpt-noter-algo-ui-privacy-sources-audit-rows:p1:inst-words

// @cpt-begin:cpt-noter-flow-ui-privacy-sources-audit:p1:inst-read
export async function readAudit(bridge: Bridge, cursor: string | null): Promise<Page<AuditEntry> | null> {
  const res = await bridge.act("audit:list", "audit_list", () => bridge.core.auditList({ page: { cursor, limit: 100 } }));
  return res.status === "ok" ? res.data : null;
}
// @cpt-end:cpt-noter-flow-ui-privacy-sources-audit:p1:inst-read

// @cpt-begin:cpt-noter-flow-ui-privacy-sources-audit:p1:inst-export
/** The export covers the whole log: the contract has no call filter, so a filtered view never exports under its label. */
export async function exportAudit(bridge: Bridge, format: LogFormat): Promise<ExportResult | null> {
  const res = await bridge.act("audit:export", "audit_export", () => bridge.core.auditExport({ format }));
  // @cpt-begin:cpt-noter-flow-ui-privacy-sources-audit:p1:inst-save-result
  return res.status === "ok" ? res.data : null;
  // @cpt-end:cpt-noter-flow-ui-privacy-sources-audit:p1:inst-save-result
}
// @cpt-end:cpt-noter-flow-ui-privacy-sources-audit:p1:inst-export

export interface AuditView {
  rows: AuditEntry[];
  cursor: string | null;
  /** `loading` until the first page; a failed read keeps the rows already read and sets `failed`. */
  status: "loading" | "ready";
  failed: boolean;
  busy: boolean;
  exporting: boolean;
  exported: string | null;
}

/** The audit reads and export as a small store: one read or export at a time, and a read that finishes after `dispose` is dropped. */
export function createAudit(bridge: Bridge, notify: (v: AuditView) => void) {
  let v: AuditView = { rows: [], cursor: null, status: "loading", failed: false, busy: false, exporting: false, exported: null };
  let live = true;
  const set = (p: Partial<AuditView>) => live && notify((v = { ...v, ...p }));
  return {
    view: () => v,
    dispose: () => void (live = false),
    /** First page, Load More and Try Again: all read from the current cursor. */
    async load() {
      if (v.busy) return;
      set({ busy: true, failed: false });
      const page = await readAudit(bridge, v.cursor);
      if (!page) return set({ busy: false, failed: true, status: "ready" });
      set({ busy: false, status: "ready", rows: mergePage(v.rows, page.rows), cursor: page.next_cursor });
    },
    async export() {
      if (v.exporting) return;
      set({ exporting: true });
      const r = await exportAudit(bridge, "markdown");
      set({ exporting: false, exported: r?.path ?? v.exported });
    },
  };
}
