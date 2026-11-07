// The core repository list shared by Settings and Handoff in this window. Other windows are re-read on focus.
import { useEffect, useSyncExternalStore } from "react";
import type { Bridge } from "../../app/bridge/bridge";
import type { ErrorCode, HandoffTarget, RepoList, RepoMapping, RepoUpsertArgs } from "../../core/bindings";
import { t } from "../../i18n/format";

export interface MappingDraft { id?: string; key: string; path: string; target: HandoffTarget }
export const initialMapping = (key = "", mapping?: RepoMapping): MappingDraft => mapping
  ? { id: mapping.id, key: mapping.key, path: mapping.local_path, target: mapping.default_tool }
  : { key, path: "", target: "claude_code" };

// @cpt-begin:cpt-noter-flow-ui-handoff-mapping:p1:inst-choose
export function mappingArgs(draft: MappingDraft, picker: boolean): RepoUpsertArgs | null {
  const key = draft.key.trim();
  const path = draft.path.trim();
  return key && (picker || path) ? { ...(draft.id ? { id: draft.id } : {}), key, local_path: picker ? null : path, default_tool: draft.target } : null;
}
// @cpt-end:cpt-noter-flow-ui-handoff-mapping:p1:inst-choose

// @cpt-begin:cpt-noter-flow-ui-handoff-mapping:p1:inst-error
export function mappingError(code: ErrorCode): { field: "key" | "path" | "form"; message: string } | null {
  if (code === "cancelled") return null;
  if (code === "invalid_input") return { field: "key", message: t("mapping.error.key") };
  if (code === "repo_path_missing") return { field: "path", message: t("mapping.error.path") };
  return { field: "form", message: t("mapping.error.other") };
}
// @cpt-end:cpt-noter-flow-ui-handoff-mapping:p1:inst-error

let held: RepoList | undefined;
let mutation = 0;
let read = 0;
const listeners = new Set<() => void>();
export const reposOf = () => held;
export const subscribeRepos = (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener));
export function holdRepos(list: RepoList) {
  held = { mappings: list.mappings.map((mapping) => ({ ...mapping })) };
  listeners.forEach((listener) => listener());
}
export const resetRepos = () => { held = undefined; mutation = 0; read = 0; };

// @cpt-flow:cpt-noter-flow-ui-handoff-mapping:p1
// @cpt-begin:cpt-noter-flow-ui-handoff-mapping:p1:inst-list
export async function readRepos(bridge: Bridge) {
  const request = ++read;
  const before = mutation;
  const result = await bridge.act("repos:list", "repos_list", () => bridge.core.reposList({}));
  // A read started before a save must not replace that save's returned list.
  if (result.status === "ok" && request === read && before === mutation) holdRepos(result.data);
  return result;
}
// @cpt-end:cpt-noter-flow-ui-handoff-mapping:p1:inst-list

// @cpt-begin:cpt-noter-flow-ui-handoff-mapping:p1:inst-save
// @cpt-begin:cpt-noter-flow-ui-handoff-mapping:p1:inst-return
export async function saveRepo(bridge: Bridge, args: RepoUpsertArgs) {
  const result = await bridge.act("repos:save", "repo_upsert", () => bridge.core.repoUpsert(args));
  if (result.status === "ok") { mutation += 1; holdRepos(result.data); }
  return result;
}
// @cpt-end:cpt-noter-flow-ui-handoff-mapping:p1:inst-return
// @cpt-end:cpt-noter-flow-ui-handoff-mapping:p1:inst-save

// @cpt-begin:cpt-noter-flow-ui-handoff-mapping:p1:inst-remove
export async function removeRepo(bridge: Bridge, id: string) {
  const result = await bridge.act("repos:remove", "repo_remove", () => bridge.core.repoRemove({ id }));
  if (result.status === "ok") { mutation += 1; holdRepos(result.data); }
  return result;
}
// @cpt-end:cpt-noter-flow-ui-handoff-mapping:p1:inst-remove

/** Repository commands have no change event. A returning window revalidates from the core. */
export function watchRepoFocus(bridge: Bridge, events: EventTarget) {
  const refresh = () => void readRepos(bridge);
  events.addEventListener("focus", refresh);
  return () => events.removeEventListener("focus", refresh);
}
export function useRepos(bridge: Bridge) {
  const list = useSyncExternalStore(subscribeRepos, reposOf, reposOf);
  useEffect(() => {
    void readRepos(bridge);
    return watchRepoFocus(bridge, window);
  }, [bridge]);
  return list;
}
