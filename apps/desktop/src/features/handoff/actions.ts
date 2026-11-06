// The handoff commands. Each sends the item and the `rev` the user based an edit on, writes what the core returns into
// the window store and leaves what the drawer shows (draft, running action, outcome, error) in `local.ts`. One action
// per item runs at a time; a failure names its error and marks nothing handed off; Copy Prompt always stays usable.
import type { Bridge } from "../../app/bridge/bridge";
import type { ErrorCode, HandoffTarget, HandoffView } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import { isDirty } from "./controls";
import { localOf, patchLocal } from "./local";

const COPIED_MS = 2000;
const ERRORS: Partial<Record<ErrorCode, MsgKey>> = { conflict: "handoff.err.conflict", invalid_input: "handoff.err.invalid" };
export const errorText = (code: ErrorCode) => t(ERRORS[code] ?? "handoff.err.other");

/** What the drawer shows: the view Cancel restored while a late completion is ignored, else the store's. */
export const viewOf = (bridge: Bridge, itemId: string): HandoffView | undefined => localOf(itemId).restored ?? bridge.store.getState().entities.handoff[itemId];

const get = (bridge: Bridge, itemId: string) => bridge.act(`handoff:${itemId}`, "handoff_get", () => bridge.core.handoffGet({ item_id: itemId }), { entity: "handoff" });

// @cpt-flow:cpt-noter-flow-ui-handoff-prepare:p1
/** `handoff_get`, then `handoff_generate` when no prompt exists yet; the finished prompt arrives as `entity:changed handoff`. */
export async function load(bridge: Bridge, itemId: string) {
  patchLocal(itemId, { loadFailed: undefined, genFailed: undefined });
  // @cpt-begin:cpt-noter-flow-ui-handoff-prepare:p1:inst-get
  const res = await get(bridge, itemId);
  // @cpt-end:cpt-noter-flow-ui-handoff-prepare:p1:inst-get
  if (res.status !== "ok") return void patchLocal(itemId, { loadFailed: res.error.code });
  if (res.data.state.type === "not_generated") await generate(bridge, itemId, false);
}

/** Write the prompt (again): **Regenerate** drops the user's edit, **Try Again** repeats a failed first write. */
export async function generate(bridge: Bridge, itemId: string, regenerate: boolean) {
  // @cpt-begin:cpt-noter-flow-ui-handoff-prepare:p1:inst-regenerate
  patchLocal(itemId, { restored: undefined, genFailed: undefined, loadFailed: undefined, ...(regenerate ? { draft: undefined, showDiff: undefined, opened: undefined, openFailed: undefined, error: undefined } : {}) });
  const res = await bridge.act(`handoff:gen:${itemId}`, "handoff_generate", () => bridge.core.handoffGenerate({ item_id: itemId, regenerate }), { entity: "handoff" });
  // @cpt-end:cpt-noter-flow-ui-handoff-prepare:p1:inst-regenerate
  if (res.status !== "ok") patchLocal(itemId, { genFailed: res.error.code });
}

// @cpt-begin:cpt-noter-flow-ui-handoff-prepare:p1:inst-cancel
/** **Cancel** while writing: the core's previous state wins over a completion that was already on its way. */
export async function cancel(bridge: Bridge, itemId: string) {
  const res = await bridge.act(`handoff:cancel:${itemId}`, "handoff_cancel", () => bridge.core.handoffCancel({ item_id: itemId }), { entity: "handoff" });
  if (res.status === "ok") patchLocal(itemId, { restored: res.data });
}
// @cpt-end:cpt-noter-flow-ui-handoff-prepare:p1:inst-cancel

// @cpt-begin:cpt-noter-flow-ui-handoff-prepare:p1:inst-edit
/** Save the draft with the `rev` it was based on, before a copy or open. True when there is nothing left unsaved. */
export async function flushDraft(bridge: Bridge, itemId: string): Promise<boolean> {
  const view = viewOf(bridge, itemId);
  const draft = localOf(itemId).draft;
  if (!view || draft === undefined || !isDirty(view, localOf(itemId))) return true;
  patchLocal(itemId, { pending: "save", error: undefined });
  const res = await bridge.act(`handoff:edit:${itemId}`, "handoff_edit", () => bridge.core.handoffEdit({ item_id: itemId, rev: view.rev ?? 0, prompt_md: draft }), { entity: "handoff" });
  if (res.status === "ok") return patchLocal(itemId, { pending: undefined, draft: undefined, restored: undefined }), true;
  // @cpt-begin:cpt-noter-flow-ui-handoff-prepare:p1:inst-conflict
  // the draft stays; a conflict reads the prompt again and waits for an explicit new save
  patchLocal(itemId, { pending: undefined, error: errorText(res.error.code) });
  if (res.error.code === "conflict") await get(bridge, itemId);
  // @cpt-end:cpt-noter-flow-ui-handoff-prepare:p1:inst-conflict
  return false;
}
// @cpt-end:cpt-noter-flow-ui-handoff-prepare:p1:inst-edit

// @cpt-begin:cpt-noter-flow-ui-handoff-deliver:p1:inst-target
export async function setTarget(bridge: Bridge, itemId: string, target: HandoffTarget) {
  const res = await bridge.act(`handoff:target:${itemId}`, "handoff_set_target", () => bridge.core.handoffSetTarget({ item_id: itemId, target }), { entity: "handoff" });
  patchLocal(itemId, res.status === "ok" ? { error: undefined, openFailed: undefined, restored: undefined } : { error: errorText(res.error.code) });
}
// @cpt-end:cpt-noter-flow-ui-handoff-deliver:p1:inst-target

/** The items whose copy or open is in flight (`pending` is what the drawer shows; this is the synchronous guard). */
const running = new Set<string>();

/** Runs `go` as the item's one action, after the draft is saved; a second invocation while one runs does nothing. */
async function action(bridge: Bridge, itemId: string, kind: "copy" | "open", go: () => Promise<void>) {
  if (running.has(itemId)) return;
  running.add(itemId);
  try {
    // @cpt-begin:cpt-noter-flow-ui-handoff-deliver:p1:inst-invoke
    if (!(await flushDraft(bridge, itemId))) return;
    patchLocal(itemId, { pending: kind, error: undefined });
    await go();
    patchLocal(itemId, { pending: undefined });
    // @cpt-end:cpt-noter-flow-ui-handoff-deliver:p1:inst-invoke
  } finally {
    running.delete(itemId);
  }
}

// @cpt-flow:cpt-noter-flow-ui-handoff-deliver:p1
/** **Copy Prompt**: the core puts the prompt on the clipboard and hands the item off; no tool is launched. */
export const copy = (bridge: Bridge, itemId: string) =>
  action(bridge, itemId, "copy", async () => {
    // @cpt-begin:cpt-noter-flow-ui-handoff-deliver:p1:inst-copy
    const res = await bridge.act(`handoff:act:${itemId}`, "handoff_copy", () => bridge.core.handoffCopy({ item_id: itemId }), { entity: "item" });
    if (res.status !== "ok") return void patchLocal(itemId, { error: errorText(res.error.code) });
    patchLocal(itemId, { copied: true, openFailed: undefined });
    setTimeout(() => patchLocal(itemId, { copied: undefined }), COPIED_MS);
    // @cpt-end:cpt-noter-flow-ui-handoff-deliver:p1:inst-copy
  });

/** **Open in Claude Code / Codex**: the core launches; a failure marks nothing and leaves Copy Prompt. */
export const open = (bridge: Bridge, itemId: string) =>
  action(bridge, itemId, "open", async () => {
    // @cpt-begin:cpt-noter-flow-ui-handoff-deliver:p1:inst-launch
    const res = await bridge.act(`handoff:act:${itemId}`, "handoff_open", () => bridge.core.handoffOpen({ item_id: itemId }), { entity: "item" });
    // @cpt-end:cpt-noter-flow-ui-handoff-deliver:p1:inst-launch
    if (res.status === "ok") return void patchLocal(itemId, { opened: res.data.path_used, openFailed: undefined });
    // @cpt-begin:cpt-noter-flow-ui-handoff-deliver:p1:inst-failure
    // @cpt-begin:cpt-noter-flow-ui-handoff-deliver:p1:inst-repo-error
    // @cpt-begin:cpt-noter-flow-ui-handoff-deliver:p1:inst-prompt-error
    patchLocal(itemId, { openFailed: res.error.code, opened: undefined });
    // the launch plan and the mapping may have moved: the core's view again
    if (res.error.code === "repo_not_mapped" || res.error.code === "repo_path_missing" || res.error.code === "prompt_not_ready") await get(bridge, itemId);
    // @cpt-end:cpt-noter-flow-ui-handoff-deliver:p1:inst-prompt-error
    // @cpt-end:cpt-noter-flow-ui-handoff-deliver:p1:inst-repo-error
    // @cpt-end:cpt-noter-flow-ui-handoff-deliver:p1:inst-failure
  });
