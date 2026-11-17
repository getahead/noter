import type { Bridge } from "../../app/bridge/bridge";
import type { PrivacyClass, PrivacyMode, SourceMode, SourceRow, SourceScope } from "../../core/bindings";
import { clock, shortDay, t } from "../../i18n/format";
import type { UiPrefs } from "../../core/bindings";
import type { IconName } from "../../ui/icons";
import type { StatusTone } from "../../ui/feedback/status-row";

export interface SourceStatusView {
  tone: StatusTone;
  word: string;
  icon?: IconName;
  subtitle: string;
  message?: string;
  progress?: { done: number; total: number | null };
  /** Re-index and Remove stay off while the source is indexing; a Live source is never indexed. */
  working: boolean;
  /** Revoke Token only with a token. */
  canRevoke: boolean;
  /** Failed rows offer Try Again (a re-index); expired rows can only show their reason. */
  canRetry: boolean;
}

// @cpt-begin:cpt-noter-algo-ui-privacy-sources-status:p1:inst-map
// @cpt-begin:cpt-noter-algo-ui-privacy-sources-status:p1:inst-progress
// @cpt-begin:cpt-noter-algo-ui-privacy-sources-status:p1:inst-privacy
// @cpt-begin:cpt-noter-algo-ui-privacy-sources-status:p1:inst-actions
/** One source row as the status row shows it: the core's status, count and last sync, never a made-up percentage. */
export function sourceStatus(row: SourceRow, mode: PrivacyMode, prefs: UiPrefs | undefined): SourceStatusView {
  const s = row.status;
  const sync = row.last_sync_at == null ? t("sources.never_synced") : t("sources.last_sync", { when: `${shortDay(row.last_sync_at, prefs)} ${clock(row.last_sync_at, prefs)}` });
  const parts = [t("sources.documents", { count: row.documents }), sync];
  if (row.privacy === "sensitive") parts.push(t("sources.sensitive_note"));
  if (row.mode === "live" && mode !== "cloud_allowed") parts.push(t("sources.live_paused"));
  const base = { subtitle: parts.join(" · "), working: s.type === "indexing", canRevoke: row.has_token && s.type !== "indexing", canRetry: s.type === "failed" && row.mode !== "live" };
  switch (s.type) {
    case "idle":
      return { ...base, tone: "ok", word: t(row.mode === "live" ? "sources.live" : "sources.up_to_date"), icon: "checkCircle" };
    case "indexing":
      return { ...base, tone: "run", word: t("sources.running"), progress: { done: s.done, total: s.total } };
    case "failed":
      return { ...base, tone: "err", word: t("sources.failed"), icon: "error", message: t("sources.failed_note") };
    case "sign_in_expired":
      return { ...base, tone: "warn", word: t("sources.expired"), icon: "warning", message: t("sources.expired_note") };
  }
}
// @cpt-end:cpt-noter-algo-ui-privacy-sources-status:p1:inst-actions
// @cpt-end:cpt-noter-algo-ui-privacy-sources-status:p1:inst-privacy
// @cpt-end:cpt-noter-algo-ui-privacy-sources-status:p1:inst-progress
// @cpt-end:cpt-noter-algo-ui-privacy-sources-status:p1:inst-map

/** Rows in the core's order, once each. */
export const orderedSources = (rows: readonly SourceRow[]): SourceRow[] => [...new Map(rows.map((r) => [r.id, r])).values()];

export const ALL_CALLS: SourceScope = { type: "all_calls" };

// @cpt-begin:cpt-noter-flow-ui-privacy-sources-add:p1:inst-list
export async function readSources(bridge: Bridge): Promise<SourceRow[] | null> {
  const res = await bridge.act("sources:list", "sources_list", () => bridge.core.sourcesList({}));
  return res.status === "ok" ? res.data.sources : null;
}
// @cpt-end:cpt-noter-flow-ui-privacy-sources-add:p1:inst-list

export type SourceResult = { ok: true; row: SourceRow } | { ok: false; field: string | null; rule: string | null; code: string };

const fail = (res: { error: { code: string; detail?: unknown } }): SourceResult => {
  const d = res.error.detail as { type?: string; field?: string; rule?: string } | null | undefined;
  const v = d?.type === "validation" ? d : null;
  return { ok: false, code: res.error.code, field: v?.field ?? null, rule: v?.rule ?? null };
};

// @cpt-begin:cpt-noter-flow-ui-privacy-sources-add:p1:inst-add-folder
/** No path: the core opens the folder panel. A cancelled panel adds nothing. */
export async function addFolder(bridge: Bridge, privacy: PrivacyClass, scope: SourceScope): Promise<SourceResult> {
  const res = await bridge.act("sources:add", "source_add_folder", () => bridge.core.sourceAddFolder({ path: null, privacy, scope }));
  return res.status === "ok" ? { ok: true, row: res.data } : fail(res);
}
// @cpt-end:cpt-noter-flow-ui-privacy-sources-add:p1:inst-add-folder

// @cpt-begin:cpt-noter-flow-ui-privacy-sources-add:p1:inst-add-mcp
export async function addMcp(bridge: Bridge, a: { server: string; mode: SourceMode; schedule: string | null; privacy: PrivacyClass; scope: SourceScope }): Promise<SourceResult> {
  const res = await bridge.act("sources:add", "source_add_mcp", () => bridge.core.sourceAddMcp(a));
  return res.status === "ok" ? { ok: true, row: res.data } : fail(res);
}
// @cpt-end:cpt-noter-flow-ui-privacy-sources-add:p1:inst-add-mcp

// @cpt-begin:cpt-noter-flow-ui-privacy-sources-manage:p1:inst-reindex
export async function reindexSource(bridge: Bridge, id: string): Promise<boolean> {
  const res = await bridge.act(`source:${id}`, "source_reindex", () => bridge.core.sourceReindex({ source_id: id }));
  return res.status === "ok";
}
// @cpt-end:cpt-noter-flow-ui-privacy-sources-manage:p1:inst-reindex

/** A missing server is a field error before anything is sent. */
export const mcpServerError = (server: string): string | null => (server.trim() ? null : t("sources.error_server_required"));

export interface McpDraft {
  server: string;
  mode: SourceMode;
  schedule: string;
  privacy: PrivacyClass;
}

/** Check, send and word the outcome: a message for the field/sheet, or null when the source was added. */
export async function submitMcp(bridge: Bridge, d: McpDraft): Promise<string | null> {
  const local = mcpServerError(d.server);
  if (local) return local;
  const r = await addMcp(bridge, { server: d.server.trim(), mode: d.mode, schedule: d.mode === "indexed" ? d.schedule : null, privacy: d.privacy, scope: ALL_CALLS });
  if (r.ok) return null;
  if (r.field === "server" && r.rule === "duplicate") return t("sources.error_server_duplicate");
  return r.field === "server" && r.rule === "invalid_format" ? t("sources.error_server_unknown") : t("sources.error_add");
}

export interface SourcesView {
  rows: SourceRow[] | null;
  failed: boolean;
}

/** The sources list: a failed read keeps the rows already shown. */
export function createSources(bridge: Bridge, notify: (v: SourcesView) => void) {
  let v: SourcesView = { rows: null, failed: false };
  return {
    view: () => v,
    async load() {
      const list = await readSources(bridge);
      notify((v = { rows: list ? orderedSources(list) : v.rows, failed: !list }));
    },
  };
}

/** The row's tag: how the source is read, and Sensitive when it is. */
export const sourceTag = (r: SourceRow): string => [r.mode === "live" ? t("sources.mode_live") : t("sources.mode_indexed"), r.privacy === "sensitive" ? t("sources.privacy_sensitive") : null].filter(Boolean).join(" · ");

/** The schedules the core syncs on (hourly, daily, weekly). */
export const scheduleChoices = () => [
  { value: "hourly", label: t("sources.schedule_hourly") },
  { value: "daily", label: t("sources.schedule_daily") },
  { value: "weekly", label: t("sources.schedule_weekly") },
];
