// What the drawer shows and enables, derived from the core's view and the local draft; no command, no DOM.
import type { HandoffTarget, HandoffView, LaunchPath } from "../../core/bindings";
import type { MsgKey } from "../../i18n/en";
import { t } from "../../i18n/format";
import type { Local } from "./local";

export type DrawerState = "LOADING" | "LOAD_FAILED" | "NOT_GENERATED" | "GENERATING" | "GENERATION_FAILED" | "READY" | "EDITED" | "SAVING" | "COPYING" | "OPENING" | "OPENED" | "OPEN_FAILED";

// @cpt-algo:cpt-noter-algo-ui-handoff-controls:p1
// @cpt-state:cpt-noter-state-ui-handoff-drawer:p1
/** The state of the drawer: the core's prompt state, then what the user is doing with a ready prompt. */
export function drawerState(view: HandoffView | undefined, local: Local): DrawerState {
  // @cpt-begin:cpt-noter-state-ui-handoff-drawer:p1:inst-load
  // @cpt-begin:cpt-noter-state-ui-handoff-drawer:p1:inst-load-error
  if (!view) return local.loadFailed ? "LOAD_FAILED" : "LOADING";
  // @cpt-end:cpt-noter-state-ui-handoff-drawer:p1:inst-load-error
  // @cpt-end:cpt-noter-state-ui-handoff-drawer:p1:inst-load
  // @cpt-begin:cpt-noter-state-ui-handoff-drawer:p1:inst-generate
  // @cpt-begin:cpt-noter-state-ui-handoff-drawer:p1:inst-failed
  if (local.genFailed || view.state.type === "failed") return "GENERATION_FAILED";
  if (view.state.type === "generating") return "GENERATING";
  if (view.state.type === "not_generated") return "NOT_GENERATED";
  // @cpt-end:cpt-noter-state-ui-handoff-drawer:p1:inst-failed
  // @cpt-end:cpt-noter-state-ui-handoff-drawer:p1:inst-generate
  // @cpt-begin:cpt-noter-state-ui-handoff-drawer:p1:inst-save
  // @cpt-begin:cpt-noter-state-ui-handoff-drawer:p1:inst-action
  if (local.pending) return local.pending === "save" ? "SAVING" : local.pending === "copy" ? "COPYING" : "OPENING";
  // @cpt-end:cpt-noter-state-ui-handoff-drawer:p1:inst-action
  // @cpt-end:cpt-noter-state-ui-handoff-drawer:p1:inst-save
  // @cpt-begin:cpt-noter-state-ui-handoff-drawer:p1:inst-edit
  if (isDirty(view, local)) return "EDITED";
  // @cpt-end:cpt-noter-state-ui-handoff-drawer:p1:inst-edit
  // @cpt-begin:cpt-noter-state-ui-handoff-drawer:p1:inst-open-error
  if (local.openFailed) return "OPEN_FAILED";
  // @cpt-end:cpt-noter-state-ui-handoff-drawer:p1:inst-open-error
  // @cpt-begin:cpt-noter-state-ui-handoff-drawer:p1:inst-opened
  if (local.opened) return "OPENED";
  // @cpt-end:cpt-noter-state-ui-handoff-drawer:p1:inst-opened
  return view.edited ? "EDITED" : "READY";
}

/** The user typed something the core does not hold yet. */
export const isDirty = (view: HandoffView, local: Local): boolean => local.draft !== undefined && local.draft !== view.prompt_md;

/** The prompt the editor shows: the draft, else the core's current prompt. */
export const promptOf = (view: HandoffView | undefined, local: Local): string => local.draft ?? view?.prompt_md ?? "";

export const toolLabel = (target: HandoffTarget): string => t(target === "codex" ? "handoff.tool.codex" : "handoff.tool.claude_code");
export const openLabel = (target: HandoffTarget): string => t("handoff.open", { tool: toolLabel(target) });

const COMMAND: Record<HandoffTarget, string> = { claude_code: "claude", codex: "codex" };

// @cpt-begin:cpt-noter-algo-ui-handoff-controls:p1:inst-label
/** The launch-path line: what the core will run, never a scheme (the scheme is help text only). */
export function launchLine(view: HandoffView): string {
  const { launch, target, repo } = view;
  const tool = toolLabel(target);
  switch (launch.path) {
    case "claude_cli_link":
    case "claude_desktop":
    case "codex_app":
      return t("handoff.launch.link", { tool });
    case "terminal":
    case "iterm":
      return t(launch.needs_automation ? "handoff.launch.fallback_auto" : "handoff.launch.fallback", { tool, app: launch.path === "iterm" ? "iTerm" : "Terminal", command: COMMAND[target], cwd: repo?.local_path ?? "" });
    case "none":
      return t("handoff.launch.none", { tool });
  }
}

/** The scheme as help text of the line and of the open button; only the link paths have one. */
export function schemeHelp(path: LaunchPath): string | undefined {
  return path === "claude_cli_link" || path === "claude_desktop" || path === "codex_app" ? t(`handoff.scheme.${path}` as MsgKey) : undefined;
}
// @cpt-end:cpt-noter-algo-ui-handoff-controls:p1:inst-label

// @cpt-begin:cpt-noter-algo-ui-handoff-controls:p1:inst-default
/** Footer order and the default (⌘Return, on the right): Open for the user's own items, Copy Prompt for anyone else's. */
export function footer(view: HandoffView): { order: Array<"copy" | "open">; primary: "copy" | "open" } {
  const own = view.default_action === "open";
  return { order: own ? ["copy", "open"] : ["open", "copy"], primary: own ? "open" : "copy" };
}
// @cpt-end:cpt-noter-algo-ui-handoff-controls:p1:inst-default

// @cpt-begin:cpt-noter-algo-ui-handoff-controls:p1:inst-open
/** **No repository mapped for VSTOR**, or without the key when the core names none. */
export const noMapping = (view: HandoffView): string => (view.unmapped_key ? t("handoff.no_mapping", { key: view.unmapped_key }) : t("handoff.no_mapping_plain"));

/** Why Open is off, as its help tag; null when it can run. */
export function openDisabledReason(view: HandoffView | undefined, local: Local): string | null {
  if (!view || view.state.type !== "ready" || view.prompt_md === null || local.genFailed) return t("handoff.disabled.prompt");
  if (local.pending) return t("handoff.disabled.busy");
  if (!view.repo) return noMapping(view);
  if (!view.repo.path_exists) return t("handoff.disabled.path");
  if (view.launch.path === "none") return t("handoff.disabled.launch", { tool: toolLabel(view.target) });
  return null;
}
// @cpt-end:cpt-noter-algo-ui-handoff-controls:p1:inst-open

// @cpt-begin:cpt-noter-algo-ui-handoff-controls:p1:inst-copy
/** Copy needs a ready prompt and nothing else: no repository, no launch handler. */
export const copyEnabled = (view: HandoffView | undefined, local: Local): boolean => !!view && view.state.type === "ready" && view.prompt_md !== null && !local.pending && !local.genFailed;
// @cpt-end:cpt-noter-algo-ui-handoff-controls:p1:inst-copy
