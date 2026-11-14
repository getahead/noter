import * as Bindings from "../../bindings";
import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function agentsHandlers(fake: Core.FakeCore): Core.Handlers {
  const newId = (prefix: string) => shared.nextId(fake, prefix);
  return {
  // ── Agents (draft) ───────────────────────────────────────────────────
  agents_get: (_a, { world }) => world.agents,
  agent_create: (a, { world, emit }) => {
    const names = { security_reviewer: "Security reviewer", qa: "QA", customer: "Customer", finance: "Finance", blank: "New agent" } as const;
    const name = a.name?.trim() || names[a.template];
    const base = world.agents.agents[0];
    const ag: Bindings.AgentView = { ...base, id: newId("agt"), rev: 1, name, badge: "person.crop.circle", builtin: false, enabled: true, order: world.agents.agents.length + 1, budget_share: 0, status: { type: "ok" }, skill_path: `skills/roles/${name.toLowerCase().replace(/\W+/g, "-")}/SKILL.md`, stats: { cards_7d: 0, useful_share: null } };
    world.agents.agents.push(ag);
    emit("entity:changed", { type: "agent", agent: ag });
    return { agent: ag, change_id: shared.logChange(fake, world, { entity: { kind: "agent", id: ag.id, label: ag.name }, summary: `Added agent ${ag.name}` }) };
  },
  agent_update: (a, { world, emit }) => {
    const ag = shared.agent(world, a.agent_id);
    shared.checkRev(ag.rev, a.rev);
    if (a.patch.runtime) {
      const rt = world.agents.runtimes.find((r) => r.runtime === a.patch.runtime);
      if (!rt?.available) throw coreError("runtime_unavailable", "runtime", { type: "runtime", runtime: a.patch.runtime, reason: rt?.reason ?? "no_key", fix: null });
    }
    Object.assign(ag, Object.fromEntries(Object.entries(a.patch).filter(([, v]) => v != null)));
    ag.rev += 1;
    emit("entity:changed", { type: "agent", agent: ag });
    return { agent: ag, change_id: shared.logChange(fake, world, { entity: { kind: "agent", id: ag.id, label: ag.name }, summary: `Changed ${ag.name}` }) };
  },
  agents_reorder: (a, { world }) => {
    const ids = new Set(world.agents.agents.map((x) => x.id));
    if (a.order.length !== ids.size || !a.order.every((id) => ids.has(id))) throw coreError("invalid_input", "order must list every agent once", { type: "validation", field: "order", rule: "invalid_format" });
    a.order.forEach((id, i) => (shared.agent(world, id).order = i + 1));
    world.agents.agents.sort((x, y) => x.order - y.order);
    return world.agents;
  },
  agent_remove: (a, { world, emit }) => {
    const ag = shared.agent(world, a.agent_id);
    if (ag.builtin) throw coreError("invalid_input", "built-in agents can be disabled, not removed", { type: "validation", field: "agent_id", rule: "invalid_format" });
    world.agents.agents = world.agents.agents.filter((x) => x !== ag);
    emit("entity:changed", { type: "removed", kind: "agent", id: ag.id });
    return { deleted: 1 };
  },
  agent_skill_get: (a, { world }) => {
    const ag = shared.agent(world, a.agent_id);
    const s = fake.handlerState.skills.get(ag.id);
    return { agent_id: ag.id, rev: s?.rev ?? 1, body_md: s?.body ?? shared.defaultSkill(ag), is_default: !s, missing: false };
  },
  agent_skill_save: (a, { world }) => {
    const ag = shared.agent(world, a.agent_id);
    shared.checkRev(fake.handlerState.skills.get(ag.id)?.rev ?? 1, a.rev);
    if (!a.body_md.trim()) throw coreError("invalid_input", "skill", { type: "validation", field: "body_md", rule: "required" });
    fake.handlerState.skills.set(ag.id, { rev: a.rev + 1, body: a.body_md });
    return { agent_id: ag.id, rev: a.rev + 1, body_md: a.body_md, is_default: false, missing: false };
  },
  agent_skill_reset: (a, { world }) => {
    const ag = shared.agent(world, a.agent_id);
    const rev = (fake.handlerState.skills.get(ag.id)?.rev ?? 1) + 1;
    fake.handlerState.skills.delete(ag.id);
    return { agent_id: ag.id, rev, body_md: shared.defaultSkill(ag), is_default: true, missing: false };
  },
  council_set_mode: (a, { world }) => {
    const row = world.agents.council.find((r) => r.call_type === a.call_type);
    if (row) Object.assign(row, { live: a.live, post_call: a.post_call });
    else world.agents.council.push({ call_type: a.call_type, live: a.live, post_call: a.post_call, agents: [] });
    return world.agents;
  },

  };
}
