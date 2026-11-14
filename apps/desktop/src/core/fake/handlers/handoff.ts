import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function handoffHandlers(fake: Core.FakeCore): Core.Handlers {
  return {
  // ── Handoff ──────────────────────────────────────────────────────────
  // @cpt-flow:cpt-noter-flow-core-handoff-prompt:p1
  handoff_get: (a, { world }) => {
    const item = shared.findItem(world, a.item_id);
    shared.requireEngineering(item);
    return shared.handoffView(fake, world, item, fake.handlerState.handoffGenerating.has(item.id) ? { type: "generating" } : fake.handlerState.handoffRevs.has(item.id) ? { type: "ready" } : { type: "not_generated" });
  },
  // Returns at once with `generating`; the finished view arrives through `entity:changed`.
  handoff_generate: (a, { world, fake, emit }) => {
    const item = shared.findItem(world, a.item_id);
    shared.requireEngineering(item);
    if (!a.regenerate && !fake.handlerState.handoffGenerating.has(item.id) && fake.handlerState.handoffRevs.has(item.id)) return shared.handoffView(fake, world, item);
    fake.handlerState.handoffGenerating.set(item.id, fake);
    fake.later(1500, () => {
      if (!fake.handlerState.handoffGenerating.delete(item.id)) return;
      fake.handlerState.handoffRevs.set(item.id, (fake.handlerState.handoffRevs.get(item.id) ?? 0) + 1);
      fake.handlerState.handoffEdits.delete(item.id);
      emit("entity:changed", { type: "handoff", handoff: shared.handoffView(fake, world, item) });
    });
    return shared.handoffView(fake, world, item, { type: "generating" });
  },
  handoff_cancel: (a, { world }) => {
    const item = shared.findItem(world, a.item_id);
    shared.requireEngineering(item);
    fake.handlerState.handoffGenerating.delete(item.id);
    return shared.handoffView(fake, world, item, fake.handlerState.handoffRevs.has(item.id) ? { type: "ready" } : { type: "not_generated" });
  },
  handoff_edit: (a, { world, emit }) => {
    const item = shared.findItem(world, a.item_id);
    shared.requireEngineering(item);
    shared.checkRev(fake.handlerState.handoffRevs.get(item.id) ?? 1, a.rev);
    if (!a.prompt_md.trim()) throw coreError("invalid_input", "prompt", { type: "validation", field: "prompt_md", rule: "required" });
    fake.handlerState.handoffEdits.set(item.id, a.prompt_md);
    fake.handlerState.handoffRevs.set(item.id, a.rev + 1);
    const view = shared.handoffView(fake, world, item);
    emit("entity:changed", { type: "handoff", handoff: view });
    return view;
  },
  handoff_set_target: (a, { world }) => {
    const item = shared.findItem(world, a.item_id);
    shared.requireEngineering(item);
    fake.handlerState.handoffTargets.set(item.id, a.target);
    return shared.handoffView(fake, world, item);
  },
  // Opening or copying a handoff accepts a suggested item.
  handoff_open: (a, { world, emit }) => {
    const item = shared.findItem(world, a.item_id);
    shared.requireEngineering(item);
    const repo = world.repos.mappings.find((m) => item.linked_issue?.startsWith(m.key));
    if (!repo) throw coreError("repo_not_mapped");
    if (!repo.path_exists) throw coreError("repo_path_missing");
    const target = fake.handlerState.handoffTargets.get(item.id) ?? repo.default_tool;
    item.status = "handed_off";
    item.review = "accepted";
    item.handoff = { target, at: shared.now(), cwd: repo.local_path, awaiting: true };
    shared.bump(item);
    emit("entity:changed", { type: "item", item });
    // Codex has no link that carries the prompt (D-33): it opens in a terminal.
    return { path_used: target === "codex" ? "terminal" : "claude_cli_link", item, prompt_file: `handoffs/${item.id}.md` };
  },
  // Copying hands the item off too (core-handoff.md §2): accepted, owner kept, not done.
  handoff_copy: (a, { world, emit }) => {
    const item = shared.findItem(world, a.item_id);
    shared.requireEngineering(item);
    const view = shared.handoffView(fake, world, item);
    item.status = "handed_off";
    item.review = "accepted";
    item.handoff = { target: view.target, at: shared.now(), cwd: view.repo?.local_path ?? "", awaiting: true };
    shared.bump(item);
    emit("entity:changed", { type: "item", item });
    return { chars: [...(view.prompt_md ?? "")].length, item };
  },

  };
}
