import * as Bindings from "../../bindings";
import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function outputsHandlers(fake: Core.FakeCore): Core.Handlers {
  const newId = (prefix: string) => shared.nextId(fake, prefix);
  return {
  // ── Outputs and sharing ──────────────────────────────────────────────
  outputs_get: (a, { world }) => {
    const out = world.outputs.find((o) => o.call_id === a.call_id);
    // As the core: a rejected item leaves its section and is never suggested again, so each item section counts its rejected ones.
    if (out) {
      const rejected = new Set(world.items.filter((i) => i.call.id === a.call_id && i.review === "rejected").map((i) => i.id));
      const count = (s: Bindings.OutputSection) => world.items.filter((i) => rejected.has(i.id) && `${i.kind}s` === s.kind).length;
      return { ...out, sections: out.sections.map((s) => ({ ...s, items: s.items.filter((i) => !rejected.has(i.id)), suppressed_count: count(s) })) };
    }
    const c = shared.call(world, a.call_id);
    return { call_id: c.id, status: "not_started", sections: [], archive: c.archive, review_waiting: c.review_waiting, sensitive: c.privacy === "sensitive", written_locally: false };
  },
  output_edit: (a, { world, emit }) => {
    const s = shared.section(world, a.summary_id);
    if (s.rev !== null) shared.checkRev(s.rev, a.rev);
    const before = s.body_md;
    shared.versionsOf(s).push({ body_md: a.body_md, kind: "user_edit" });
    s.body_md = a.body_md;
    s.user_edited = true;
    s.rev = (s.rev ?? 0) + 1;
    s.version_count += 1;
    const change_id = shared.logChange(fake, world, { entity: { kind: "summary", id: a.summary_id, label: "Summary" }, field: "body", before, after: a.body_md, summary: "Edited the summary" });
    emit("entity:changed", { type: "section", call_id: a.call_id, section: s });
    return { section: s, change_id };
  },
  // D2: post-call analysis may run during a live call; regeneration waits.
  outputs_regenerate: (a, { world, fake, emit }) => {
    shared.call(world, a.call_id);
    if (shared.live(world.app.capture)) throw coreError("job_blocked", "regeneration waits for the live call to end");
    const run = newId("run");
    // No sections means all of them, as in the real core.
    const sections = a.sections.length ? a.sections : (world.outputs.find((o) => o.call_id === a.call_id)?.sections.map((x) => x.kind) ?? []);
    sections.forEach((kind, i) => {
      fake.later(300 * (i + 1), () => emit("outputs:progress", { call_id: a.call_id, status: "writing", section: kind, state: { type: "writing" } }));
      fake.later(300 * (i + 2), () => {
        const section = world.outputs.find((o) => o.call_id === a.call_id)?.sections.find((s) => s.kind === kind);
        if (section) {
          section.names_updated = false;
          // Use Local Model: the local runtime writes the section, as in the real core.
          if (a.local && section.writer) {
            section.writer = { ...section.writer, runtime: "local", model: "local", generated_at: shared.now() };
            world.outputs.find((o) => o.call_id === a.call_id)!.written_locally = true;
          }
          emit("entity:changed", { type: "section", call_id: a.call_id, section });
        }
        emit("outputs:progress", { call_id: a.call_id, status: "ready", section: kind, state: { type: "ready" } });
      });
    });
    return { job_run_id: run };
  },
  output_versions: (a, { world }) => {
    const s = shared.section(world, a.summary_id);
    const versions = shared.versionsOf(s).map((v, i) => ({
      id: `ver_${a.summary_id}_${i + 1}`,
      n: i + 1,
      kind: v.kind,
      writer: v.kind === "generated" ? s.writer : null,
      created_at: (s.writer?.generated_at ?? world.now) + i * shared.MIN,
    }));
    return { versions };
  },
  output_version_get: (a, { world }) => {
    const s = shared.section(world, a.summary_id);
    const n = Number(a.version_id.split("_").at(-1));
    const v = shared.versionsOf(s)[n - 1];
    if (!n || !v) throw coreError("not_found", `version ${a.version_id}`);
    return { meta: { id: a.version_id, n, kind: v.kind, writer: v.kind === "generated" ? s.writer : null, created_at: (s.writer?.generated_at ?? world.now) + (n - 1) * shared.MIN }, body_md: v.body_md };
  },
  // As the core's share render: only ready sections, never a rejected item; an item section copies the call's items as
  // they are now, and counts as ready once the outputs are written.
  share_copy: (a, { world }) => {
    const c = shared.call(world, a.call_id);
    const out = world.outputs.find((o) => o.call_id === a.call_id);
    const finished = out?.status === "ready" || out?.status === "partially_failed";
    const kinds: Partial<Record<Bindings.SectionKind, Bindings.ItemView["kind"]>> = { decisions: "decision", action_items: "action_item", open_questions: "open_question", risks: "risk" };
    const chosen = (out?.sections ?? [])
      .filter((x) => !a.scope.sections.length || a.scope.sections.includes(x.kind))
      .map((x) => {
        const mine = world.items.filter((i) => i.call.id === c.id && i.kind === kinds[x.kind]);
        if (!mine.length) return x;
        const state = finished && (x.state.type === "pending" || x.state.type === "empty") ? { type: "ready" as const } : x.state;
        return { ...x, items: mine, body_md: null, state };
      });
    if (!a.scope.item_ids.every((id) => chosen.some((x) => x.items.some((i) => i.id === id))))
      throw coreError("invalid_input", "scope.item_ids", { type: "validation", field: "scope.item_ids", rule: "out_of_range" });
    const picked = (i: Bindings.ItemView) => i.review !== "rejected" && (!a.scope.item_ids.length || a.scope.item_ids.includes(i.id));
    const blocks = chosen
      .filter((x) => x.state.type === "ready")
      .map((x) => ({ kind: x.kind, body: a.scope.item_ids.length ? null : x.body_md, lines: x.items.filter(picked) }))
      .filter((b) => b.body || b.lines.length);
    const unreviewed = blocks.flatMap((b) => b.lines).filter((i) => i.review === "suggested").length;
    if (unreviewed && !a.scope.include_unreviewed) throw coreError("unreviewed_in_scope");
    if (!blocks.length) throw coreError("outputs_not_ready", "nothing to share yet");
    const heading = { markdown: (k: string) => `## ${k}`, slack: (k: string) => `*${k}*`, jira: (k: string) => `h2. ${k}` }[a.format];
    const text = blocks.map((b) => [heading(b.kind), ...(b.body ? [b.body] : []), ...b.lines.map((i) => `- ${i.text}`)].join("\n")).join("\n\n");
    return { text, sections: blocks.length, items: blocks.reduce((n, b) => n + b.lines.length, 0), unreviewed_in_scope: unreviewed, sensitive: out?.sensitive ?? false };
  },
  calls_export: (a, { world }) => {
    if (!a.call_ids.length) throw coreError("invalid_input", "call_ids", { type: "validation", field: "call_ids", rule: "required" });
    const calls = a.call_ids.map((id) => shared.call(world, id));
    const per = (a.include.summary_and_items ? 2 : 0) + (a.include.transcript ? 2 : 0) + (a.include.audio ? 2 : 0);
    const files = a.scope ? calls.length : calls.length * Math.max(1, per);
    return { path: `~/Downloads/Noter export ${new Date(world.now).toISOString().slice(0, 10)}`, files };
  },

  };
}
