import { useEffect, useMemo, useState } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { PrivacyMode, SourceRow, UiPrefs } from "../../core/bindings";
import { t } from "../../i18n/format";
import { EmptyState } from "../../ui/feedback/empty-state";
import { StatusRow } from "../../ui/feedback/status-row";
import { PushButton } from "../../ui/primitives/push-button";
import { AddMcpSourceSheet } from "./AddMcpSourceSheet";
import { Group } from "./form";
import type { PaneProps } from "./pane-props";
import { SourceDetailsSheet } from "./SourceDetailsSheet";
import { AddFolderSheet } from "./SourceFormSheet";
import { createSources, reindexSource, sourceStatus, sourceTag, type SourcesView as SourcesState } from "./sources";

type Sheet = "folder" | "mcp" | null;

// @cpt-flow:cpt-noter-flow-ui-privacy-sources-add:p1
export function KnowledgeSourcesPane({ bridge, settings }: PaneProps) {
  const prefs = useWindow(bridge, (s) => s.app?.prefs);
  const changed = useWindow(bridge, (s) => s.entities.source);
  const [view, setView] = useState<SourcesState>({ rows: null, failed: false });
  const { rows, failed } = view;
  const store = useMemo(() => createSources(bridge, setView), [bridge]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => store.load();
  // the core keeps rows current with entity:changed; the list is read again on each change
  useEffect(() => void load(), [bridge, changed]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <SourcesView rows={rows} failed={failed} mode={settings.privacy.mode} prefs={prefs} onRetry={() => void load()} onAdd={setSheet} onReindex={(id) => void reindexSource(bridge, id)} onDetails={setOpen} />
      {sheet === "folder" && <AddFolderSheet bridge={bridge} onClose={() => setSheet(null)} />}
      {rows?.find((r) => r.id === open) && <SourceDetailsSheet bridge={bridge} row={rows.find((r) => r.id === open)!} onRefresh={() => void load()} onClose={() => setOpen(null)} />}
      {sheet === "mcp" && <AddMcpSourceSheet bridge={bridge} onClose={() => setSheet(null)} />}
    </>
  );
}

export function SourcesView({ rows, failed, mode, prefs, onRetry, onAdd, onReindex, onDetails }: { rows: SourceRow[] | null; failed: boolean; mode: PrivacyMode; prefs: UiPrefs | undefined; onRetry: () => void; onAdd: (s: "folder" | "mcp") => void; onReindex: (id: string) => void; onDetails: (id: string) => void }) {
  if (failed && !rows) return <p className="hd__err" role="alert">{t("sources.read_error")} <PushButton label={t("action.try_again")} size="small" onAction={onRetry} /></p>;
  if (!rows) return <p className="np-dim" role="status">{t("sources.loading")}</p>;
  if (rows.length === 0) return (
    <>
      <EmptyState title={t("sources.empty_title")} body={t("sources.empty_body")} icon="books" actionId="source-add-folder" actionLabel={t("sources.add_folder")} onAction={() => onAdd("folder")} />
      <div className="st-sources__foot"><PushButton label={t("sources.add_mcp")} size="small" onAction={() => onAdd("mcp")} /></div>
    </>
  );
  return (
    <Group foot={<div className="st-sources__foot">
      <PushButton id="source-add-folder" label={t("sources.add_folder")} size="small" onAction={() => onAdd("folder")} />
      <PushButton label={t("sources.add_mcp")} size="small" onAction={() => onAdd("mcp")} />
    </div>}>
      {failed && <p className="hd__err" role="alert">{t("sources.read_error")} <PushButton label={t("action.try_again")} size="small" onAction={onRetry} /></p>}
      {rows.map((r) => {
        const v = sourceStatus(r, mode, prefs);
        return (
          <StatusRow key={r.id} variant="source" tone={v.tone} word={v.word} icon={v.icon} title={r.name} tag={sourceTag(r)} subtitle={v.subtitle} message={v.message} progress={v.progress} progressText={v.progressText} state={v.state} onOpen={() => onDetails(r.id)}
            actions={<>
              {v.canRetry ? <PushButton label={t("sources.try_again")} size="small" onAction={() => onReindex(r.id)} /> : r.status.type === "idle" && r.mode !== "live" ? <PushButton label={t("sources.reindex")} size="small" onAction={() => onReindex(r.id)} /> : null}
              <PushButton label={t("sources.details")} size="small" onAction={() => onDetails(r.id)} />
            </>} />
        );
      })}
    </Group>
  );
}
