// The drawer's state machine and the controls it derives: footer order, disabled reasons, launch lines.
import { describe, expect, it } from "vitest";

import type { HandoffView, LaunchPlan } from "../../core/bindings";
import { copyEnabled, drawerState, footer, launchLine, noMapping, openDisabledReason, openLabel, promptOf, schemeHelp } from "./controls";

const repo = { id: "rep_1", key: "VSTOR", local_path: "/work/vhi", default_tool: "claude_code" as const, path_exists: true };
const view = (o: Partial<HandoffView> = {}): HandoffView =>
  ({
    item: { id: "itm_1" },
    state: { type: "ready" },
    rev: 1,
    prompt_md: "Do it",
    generated_md: "Do it",
    edited: false,
    versions: [],
    target: "claude_code",
    repo,
    unmapped_key: null,
    launch: { path: "claude_cli_link", needs_automation: false, automation_denied: false },
    default_action: "open",
    last: null,
    ...o,
  }) as unknown as HandoffView;
const plan = (path: LaunchPlan["path"], needs_automation = false): Partial<HandoffView> => ({ launch: { path, needs_automation, automation_denied: false } });

describe("drawerState (cpt-noter-state-ui-handoff-drawer)", () => {
  it("follows the core's prompt state", () => {
    expect(drawerState(undefined, {})).toBe("LOADING");
    expect(drawerState(undefined, { loadFailed: "internal" })).toBe("LOAD_FAILED");
    expect(drawerState(view({ state: { type: "not_generated" } }), {})).toBe("NOT_GENERATED");
    expect(drawerState(view({ state: { type: "generating" } }), {})).toBe("GENERATING");
    expect(drawerState(view({ state: { type: "failed", code: "runtime_unavailable" } }), {})).toBe("GENERATION_FAILED");
    expect(drawerState(view({ state: { type: "not_generated" } }), { genFailed: "runtime_unavailable" })).toBe("GENERATION_FAILED");
    expect(drawerState(view(), {})).toBe("READY");
  });

  it("a ready prompt is edited by a draft or a held edit, and busy while an action runs", () => {
    expect(drawerState(view({ edited: true }), {})).toBe("EDITED");
    expect(drawerState(view(), { draft: "Do it differently" })).toBe("EDITED");
    expect(drawerState(view(), { draft: "Do it" })).toBe("READY");
    expect(drawerState(view(), { pending: "save" })).toBe("SAVING");
    expect(drawerState(view(), { pending: "copy" })).toBe("COPYING");
    expect(drawerState(view(), { pending: "open" })).toBe("OPENING");
  });

  it("an open outcome shows until the prompt is edited again", () => {
    expect(drawerState(view(), { opened: "iterm" })).toBe("OPENED");
    expect(drawerState(view(), { openFailed: "automation_denied" })).toBe("OPEN_FAILED");
    expect(drawerState(view(), { opened: "iterm", draft: "changed" })).toBe("EDITED");
  });
});

describe("footer and labels (cpt-noter-algo-ui-handoff-controls)", () => {
  it("Open is the default for the user's own items, Copy Prompt for anyone else's", () => {
    expect(footer(view())).toEqual({ order: ["copy", "open"], primary: "open" });
    expect(footer(view({ default_action: "copy_prompt" }))).toEqual({ order: ["open", "copy"], primary: "copy" });
  });

  it("names the target on the button and the launch line", () => {
    expect(openLabel("codex")).toBe("Open in Codex");
    expect(launchLine(view())).toBe("Opens Claude Code in your usual terminal with the prompt filled in; nothing is sent until you press Return.");
    expect(launchLine(view({ target: "codex", ...plan("codex_app") }))).toContain("Opens Codex");
  });

  it("the terminal fallback names the app and cwd, and the Automation question only when macOS will ask", () => {
    expect(launchLine(view(plan("iterm")))).toBe("No Claude Code link handler found. Noter will open iTerm and run claude in /work/vhi.");
    expect(launchLine(view(plan("iterm", true)))).toBe("No Claude Code link handler found. Noter will open iTerm and run claude in /work/vhi; macOS asks once to allow Automation.");
    expect(launchLine(view({ target: "codex", ...plan("terminal") }))).toContain("open Terminal and run codex");
    expect(launchLine(view(plan("none")))).toContain("can't be launched");
  });

  it("the scheme is help text for link paths only", () => {
    expect(schemeHelp("claude_cli_link")).toBe("Opens through claude-cli://open · no Automation prompt");
    expect(schemeHelp("codex_app")).toContain("codex://new");
    expect(schemeHelp("iterm")).toBeUndefined();
    expect(schemeHelp("none")).toBeUndefined();
  });
});

describe("what is enabled", () => {
  it("Open names why it is off, in the order the user can fix it", () => {
    expect(openDisabledReason(view(), {})).toBeNull();
    expect(openDisabledReason(undefined, {})).toBe("The prompt is not ready yet");
    expect(openDisabledReason(view({ state: { type: "generating" }, prompt_md: null }), {})).toBe("The prompt is not ready yet");
    expect(openDisabledReason(view(), { pending: "copy" })).toBe("Another handoff action is running");
    expect(openDisabledReason(view({ repo: null, unmapped_key: "VSTOR" }), {})).toBe("No repository mapped for VSTOR");
    expect(openDisabledReason(view({ repo: { ...repo, path_exists: false } }), {})).toBe("The mapped folder is missing");
    expect(openDisabledReason(view(plan("none")), {})).toBe("Nothing can launch Claude Code here; use Copy Prompt");
  });

  it("Copy needs only a ready prompt: no repository, no launch handler", () => {
    expect(copyEnabled(view({ repo: null, ...plan("none") }), {})).toBe(true);
    expect(copyEnabled(view({ state: { type: "generating" }, prompt_md: null }), {})).toBe(false);
    expect(copyEnabled(view(), { pending: "open" })).toBe(false);
    expect(copyEnabled(undefined, {})).toBe(false);
  });

  it("the unmapped key is named when the core has one", () => {
    expect(noMapping(view({ repo: null, unmapped_key: "VSTOR" }))).toBe("No repository mapped for VSTOR");
    expect(noMapping(view({ repo: null }))).toBe("No repository mapped");
  });

  it("the editor shows the draft, else the core's prompt", () => {
    expect(promptOf(view(), {})).toBe("Do it");
    expect(promptOf(view(), { draft: "" })).toBe("");
    expect(promptOf(undefined, {})).toBe("");
  });
});
