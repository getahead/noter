import { useEffect, useRef, useState } from "react";
import { focusFirstAvailable, focusIfLost, startedFrom } from "../../app/a11y/focus";
import type { Bridge } from "../../app/bridge/bridge";
import { useWindow } from "../../app/use-window";
import type { HandoffTarget, RepoMapping } from "../../core/bindings";
import { t } from "../../i18n/format";
import { useAlert, useSheet } from "../../ui/dialogs/host";
import { EmptyState } from "../../ui/feedback/empty-state";
import { Icon } from "../../ui/icons";
import { PopupButton } from "../../ui/primitives/popup-button";
import { PushButton } from "../../ui/primitives/push-button";
import { Table, Th } from "../../ui/primitives/table";
import { toolLabel } from "../handoff/controls";
import { mappingError, readRepos, removeRepo, saveRepo, useRepos } from "../handoff/mappings";
import { Group } from "./form";

export function RepositoriesPane({ bridge }: { bridge: Bridge }) {
  const list = useRepos(bridge);
  const failed = useWindow(bridge, (s) => s.commands["repos:list"]?.state === "ERROR");
  const sheets = useSheet();
  const ask = useAlert();
  const [selected, select] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const focusAfterRemove = useRef<number | null>(null);
  const stayOnRemove = useRef(false);
  useEffect(() => {
    if (!busy && stayOnRemove.current) { stayOnRemove.current = false; focusFirstAvailable(document, ["repo-remove"]); }
  }, [busy]);
  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null || !list || busy) return;
    focusAfterRemove.current = null;
    const next = Math.min(index, list.mappings.length - 1);
    focusFirstAvailable(document, [...(next >= 0 ? [`r${next}`] : []), "repo-add"]);
  }, [busy, list]);
  // the first mapping replaces the empty state, and its Add Mapping… with it: the new one takes the focus the sheet gave back
  const count = list?.mappings.length ?? 0;
  const had = useRef(count);
  useEffect(() => {
    if (had.current === 0 && count > 0) focusIfLost(document, ["repo-add"]);
    had.current = count;
  }, [count]);
  const mapping = list?.mappings.find((repo) => repo.id === selected);
  const edit = (repo?: RepoMapping) => sheets.open("add-mapping", { bridge, mapping: repo });
  const changeTool = async (repo: RepoMapping, target: HandoffTarget) => {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await saveRepo(bridge, { id: repo.id, key: repo.key, local_path: repo.local_path, default_tool: target });
      if (result.status === "error") setError(mappingError(result.error.code)?.message ?? null);
    } finally { active.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (!mapping || active.current) return;
    const index = list?.mappings.findIndex((repo) => repo.id === mapping.id) ?? -1;
    const restore = startedFrom(document, "repo-remove");
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      const confirmed = await ask({ title: t("mapping.remove_title", { key: mapping.key }), message: t("mapping.remove_note"), cancel: t("dialogs.cancel"), confirm: t("mapping.remove"), destructive: true });
      if (!confirmed) { stayOnRemove.current = restore; return; } // Remove is disabled until busy ends: the effect below focuses it
      const result = await removeRepo(bridge, mapping.id);
      if (result.status === "error") { setError(mappingError(result.error.code)?.message ?? null); focusAfterRemove.current = null; }
      else { if (restore && index >= 0) focusAfterRemove.current = index; select(null); }
    } finally { active.current = false; setBusy(false); }
  };
  return (
    <>
      {failed && <p className="hd__err" role="alert">{t("mapping.error.read")} <PushButton label={t("action.try_again")} size="small" onAction={() => void readRepos(bridge)} /></p>}
      {list?.mappings.length === 0 ? <EmptyState title={t("mapping.empty_title")} body={t("mapping.empty")} icon="branch" actionId="repo-add" actionLabel={t("mapping.add_more")} onAction={() => edit()} /> : <Group foot={<>
        <PushButton id="repo-add" label={t("mapping.add_more")} size="small" disabled={busy} onAction={() => edit()} />
        <PushButton label={t("mapping.edit_more")} size="small" disabled={busy || !mapping} onAction={() => edit(mapping)} />
        <PushButton id="repo-remove" label={t("mapping.remove")} size="small" icon="minus" disabled={busy || !mapping} onAction={() => void remove()} />
      </>}>
        {(
          <Table label={t("settings.pane.repositories")} cls="hd-repositories">
            <thead><tr><Th label={t("mapping.project")} /><Th label={t("mapping.local_path")} /><Th label={t("mapping.tool")} /></tr></thead>
            <tbody>{list?.mappings.map((repo, i) => (
              <tr key={repo.id} id={`r${i}`} tabIndex={selected === repo.id || (!selected && i === 0) ? 0 : -1} aria-selected={selected === repo.id} onClick={() => select(repo.id)} onFocus={() => select(repo.id)} onDoubleClick={() => !busy && edit(repo)}>
                <td>{repo.key}</td>
                <td title={repo.local_path}><span className="np-mono">{repo.local_path}</span>{!repo.path_exists && <span className="hd__warn"><Icon name="warning" size={12} />{t("mapping.missing")}</span>}</td>
                <td><PopupButton label={t("mapping.tool")} variant="inline" value={repo.default_tool} disabled={busy} options={(["claude_code", "codex"] as const).map((value) => ({ value, label: toolLabel(value) }))} onAction={(target) => void changeTool(repo, target as HandoffTarget)} /></td>
              </tr>
            ))}</tbody>
          </Table>
        )}
      </Group>}
      {error && <p className="hd__err" role="alert">{error}</p>}
    </>
  );
}
