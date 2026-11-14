import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function historyHandlers(fake: Core.FakeCore): Core.Handlers {
  const newId = (prefix: string) => shared.nextId(fake, prefix);
  return {
  // ── History and undo ─────────────────────────────────────────────────
  history_list: (a, { world }) => {
    const t = a.target;
    const rows = world.changes.filter(
      (c) =>
        (t.type === "all" || (t.type === "item" && c.entity.id === t.item_id) || (t.type === "call" && c.entity.id === t.call_id) || (t.type === "person" && c.entity.id === t.person_id)) &&
        (a.actor === "all" || (a.actor === "you" && c.actor.type === "you") || (a.actor === "jobs" && c.actor.type === "job") || (a.actor === "models" && c.actor.type === "model")) &&
        (!a.job_id || (c.actor.type === "job" && c.actor.job_id === a.job_id)),
    );
    return shared.pageRows(a.page, shared.historyRows(world, rows));
  },
  change_undo: (a, { world, emit, fake }) => {
    const target = a.target;
    const rows = world.changes.filter((c) => (target.type === "change" ? c.id === target.change_id : c.batch_id === target.batch_id));
    if (!rows.length) throw coreError("not_found");
    const open = rows.filter((r) => r.status !== "undone");
    if (!open.length) throw coreError("already_undone");
    if (open.some((r) => !r.undoable)) throw coreError("not_undoable");
    // Rows edited later keep their value and are counted; the rest are undone.
    const undo = open.filter((r) => !shared.editedLater(world, r));
    if (!undo.length) throw coreError("edited_later");
    undo.forEach((r) => Object.assign(r, { status: "undone", undoable: false, redoable: true }));
    shared.replayChanges(world, undo, "before", emit, fake);
    return { undone: undo.reduce((n, r) => n + r.batch_size, 0), skipped_edited_later: open.length - undo.length };
  },
  // Redo by target, at any time, while the rows were not edited later; writes new change rows.
  change_redo: (a, { world, emit, fake }) => {
    const target = a.target;
    const rows = world.changes.filter((c) => (target.type === "change" ? c.id === target.change_id : c.batch_id === target.batch_id));
    if (!rows.length) throw coreError("not_found");
    // After a partial undo the rows edited later are still applied: redo the undone ones.
    const undone = rows.filter((r) => r.status === "undone");
    if (!undone.length) throw coreError("not_undone");
    const redoable = undone.filter((r) => r.redoable && (!shared.isSpeakerChange(r) ||
      JSON.stringify(shared.namingState(world, (JSON.parse(r.before!) as ReturnType<typeof shared.namingState>).callId)) === r.before));
    if (!redoable.length) {
      if (undone.every(shared.isSpeakerChange)) {
        const partial = undone.length === 1 ? shared.replaySpeakerChangeAroundEditedSections(world, undone[0]!, emit) : null;
        if (partial) {
          undone.forEach((r) => Object.assign(r, { status: "applied", undoable: true, redoable: false }));
          undone.forEach((r) => shared.logChange(fake, world, { entity: r.entity, summary: `Redid: ${r.summary}`, field: r.field, before: r.before, after: r.after }));
          return { undone: partial.undone, skipped_edited_later: partial.skipped };
        }
        return { undone: 0, skipped_edited_later: undone.length };
      }
      throw coreError("edited_later");
    }
    redoable.forEach((r) => Object.assign(r, { status: "applied", undoable: true, redoable: false }));
    shared.replayChanges(world, redoable, "after", emit, fake);
    redoable.forEach((r) => shared.logChange(fake, world, { entity: r.entity, summary: `Redid: ${r.summary}`, field: r.field, before: r.before, after: r.after }));
    return { undone: redoable.reduce((n, r) => n + r.batch_size, 0), skipped_edited_later: undone.length - redoable.length };
  },
  proposals_list: (a, { world }) => {
    const rows = world.proposals.filter((p) => !a.kinds.length || a.kinds.includes(p.kind));
    return shared.pageRows(a.page, rows);
  },
  proposal_decide: (a, { world, publish }) => {
    const p = world.proposals.find((x) => x.id === a.proposal_id);
    if (!p) throw coreError("not_found");
    shared.checkRev(p.rev, a.rev);
    world.proposals = world.proposals.filter((x) => x.id !== p.id);
    world.app.proposals.waiting = world.proposals.length;
    publish("proposals:counts");
    return { proposal: p, status: a.decision === "accept" ? "applied" : "rejected", applied: a.decision === "accept" ? p.count : 0, batch_id: p.batch_id };
  },
  proposal_always_for_term: (a, { world }) => {
    const p = world.proposals.find((x) => x.id === a.proposal_id);
    if (!p) throw coreError("not_found");
    if (!p.term) throw coreError("invalid_input", "not a term proposal", { type: "validation", field: "proposal_id", rule: "invalid_format" });
    let term = world.glossary.terms.find((t) => t.term === p.term);
    if (!term) {
      term = { id: newId("gls"), rev: 1, term: p.term, variants_latin: [], variants_cyrillic: [], spoken_forms: [], lang: null, always_apply: false, added_from: null };
      world.glossary.terms.push(term);
    }
    term.always_apply = a.always;
    term.rev += 1;
    return term;
  },
  // The scope is checked before the (absent) save panel, as the core does; a cancelled panel is `failNext(…, "cancelled")`.
  history_export: (a, { world }) => {
    const s = a.scope;
    if (s.type === "call") shared.call(world, s.call_id);
    if (s.type === "period") {
      const day = (d: string, field: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))) throw coreError("invalid_input", field, { type: "validation", field, rule: "invalid_format" });
        return d;
      };
      if (day(s.from, "scope.from") > day(s.to, "scope.to")) throw coreError("invalid_input", "scope.to", { type: "validation", field: "scope.to", rule: "out_of_range" });
    }
    return { path: `~/Downloads/Noter log ${s.type}.${a.format === "json" ? "json" : "md"}`, files: 1 };
  },
  activity_get: (a, { world }) => ({
    day: a.day ?? new Date(world.now).toISOString().slice(0, 10),
    needs_attention: world.jobs.jobs.flatMap((j) => (j.last_run?.status === "failed" ? [j.last_run] : [])),
    proposals: world.proposals,
    groups: [{ run: null, changes: world.changes.filter((c) => a.actor === "all" || (a.actor === "you") === (c.actor.type === "you")), total: world.changes.length }],
  }),

  };
}
