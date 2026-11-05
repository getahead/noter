// Starting states of the handoff stories. The fixture's `itm_replay` (VSTOR-9912, engineering, owned by Dmitri S., suggested)
// is the someone-else item; `own()` makes it the user's accepted item. A repository mapping for VSTOR is created through
// `repo_upsert` with a real folder, as the Repositories pane does. Harness controls: `harness.launch_world` (what the Mac
// reports for a launch and which paths fail) and `harness.native_log` (the launches and clipboard writes so far). Tests only.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import type { ItemView, LaunchPath } from "../../../src/core/bindings";
import type { World } from "../../support/scenario";
import { invoke, REAL } from "./outputs-world";

export const ITEM = "itm_replay";
export const itemOf = (w: World): ItemView => w.items.find((i) => i.id === ITEM)!;
export const callOf = (w: World) => itemOf(w).call.id;

/** The item is the user's, accepted and engineering: Open in Claude Code is the default. */
export function own(w: World): void {
  const me = w.people.find((p) => p.is_you)!;
  const you = { id: me.id, display_name: me.display_name, short_name: me.short_name, initials: me.initials, is_you: true };
  Object.assign(itemOf(w), { owner: you, review: "accepted", status: "open", is_engineering: true, handoff: null });
}

/** The call of the item is marked sensitive. */
export function sensitive(w: World): void {
  for (const c of [w.calls.find((x) => x.id === callOf(w))!, w.call_details.find((d) => d.call.id === callOf(w))!.call]) c.privacy = "sensitive";
}

/** A VSTOR mapping to a folder that exists. */
export const map = (page: Page, tool: "claude_code" | "codex" = "claude_code") =>
  invoke(page, "repo_upsert", { key: "VSTOR", local_path: mkdtempSync(join(tmpdir(), "noter-vhi-frontend-")), default_tool: tool });

/** What the Mac reports for the next launches: the path Noter would use and the ones that fail (real core only). */
export async function launch(page: Page, path: LaunchPath, opts: { needsAutomation?: boolean; denied?: boolean; fail?: Array<{ path: LaunchPath; code: string }> } = {}): Promise<void> {
  if (!REAL) return;
  await invoke(page, "harness.launch_world", { plan: { path, needs_automation: opts.needsAutomation ?? false, automation_denied: opts.denied ?? false }, fail: opts.fail ?? [] });
}

/** The launches and clipboard writes the core asked the Mac for, oldest first. */
export const nativeLog = (page: Page) => invoke(page, "harness.native_log", {}) as Promise<Array<Record<string, unknown>>>;
