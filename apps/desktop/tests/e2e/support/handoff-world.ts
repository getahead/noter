// Starting states of the handoff stories. The fixture's `itm_replay` (VSTOR-9912, engineering, owned by Dmitri S., suggested)
// is the someone-else item; `own()` makes it the user's accepted item. A repository mapping for VSTOR is created through
// `repo_upsert` with a real folder, as the Repositories pane does. Harness controls: `harness.launch_world` (what the Mac
// reports for a launch and which paths fail) and `harness.native_log` (the launches and clipboard writes so far). Tests only.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ItemView, LaunchPath } from "../../../src/core/bindings";
import type { World } from "../../support/scenario";
import type { Steer } from "./app";
import * as W from "../../support/world-presets";
import { sectionOf, written } from "./outputs-world";

export const REAL = process.env.NOTER_CORE === "stdio";
/** One command through the page's own IPC, as the app sends it. */
export const ITEM = "itm_replay";
const itemOf = (w: World): ItemView => w.items.find((i) => i.id === ITEM)!;
export const callOf = (w: World) => itemOf(w).call.id;

/** The item stands in the written outputs of the past call (both cores take the world: the real one through harness.world_set), so its call page shows it. */
export function place(w: World): void {
  written(w);
  const it = itemOf(w);
  it.call = { ...it.call, id: W.PAST_CALL, title: "Backend sync" };
  sectionOf(w, "action_items").items.push(it);
}

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

/** No mapping at all (the fake world starts with a VSTOR one; the real core with none). */
export const unmap = (w: World): void => void (!REAL && (w.repos.mappings.length = 0));

/** A VSTOR mapping to a folder that exists (the fake world already has one). */
export const map = (steer: Steer, tool: "claude_code" | "codex" = "claude_code") =>
  !REAL ? undefined : steer.invoke("repo_upsert", { key: "VSTOR", local_path: mkdtempSync(join(tmpdir(), "noter-vhi-frontend-")), default_tool: tool });

/** What the Mac reports for the next launches: the path Noter would use and the ones that fail (real core only). */
export async function launch(steer: Steer, path: LaunchPath, opts: { needsAutomation?: boolean; denied?: boolean; fail?: Array<{ path: LaunchPath; code: string }> } = {}): Promise<void> {
  if (!REAL) return;
  await steer.invoke("harness.launch_world", { plan: { path, needs_automation: opts.needsAutomation ?? false, automation_denied: opts.denied ?? false }, fail: opts.fail ?? [] });
}

/** The launches and clipboard writes the core asked the Mac for, oldest first. */
export const nativeLog = (steer: Steer) => steer.invoke("harness.native_log", {}) as Promise<Array<Record<string, unknown>>>;
