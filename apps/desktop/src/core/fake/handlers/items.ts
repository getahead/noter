import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function itemsHandlers(fake: Core.FakeCore): Core.Handlers {
  const newId = (prefix: string) => shared.nextId(fake, prefix);
  return {
  // ── Items ────────────────────────────────────────────────────────────
  items_list: (a, { world }) => {
    const f = a.filter;
    const rows = world.items.filter(
      (i) =>
        (!f.call_id || i.call.id === f.call_id) &&
        (!f.kinds?.length || f.kinds.includes(i.kind)) &&
        (!f.statuses?.length || f.statuses.includes(i.status)) &&
        (!f.reviews?.length || f.reviews.includes(i.review)) &&
        (!f.person_id || i.owner?.id === f.person_id) &&
        (!f.topic_id || i.topic?.id === f.topic_id) &&
        (!f.due_before || (i.due !== null && i.due < f.due_before)),
    );
    return shared.pageRows(a.page, rows);
  },
  // @cpt-flow:cpt-noter-flow-core-items-today-read:p1
  item_get: (a, { world }) => {
    const item = shared.findItem(world, a.item_id);
    const evidence = item.spans.map((span) => {
      const segments = world.transcripts.find((t) => t.call_id === span.call_id)?.segments ?? [];
      const minutes = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1_000) % 60).padStart(2, "0")}`;
      const at = item.call.started_at + span.t0_ms;
      return {
        id: `evd_span_${item.id}_${span.t0_ms}`,
        source: "call" as const,
        reference: `${minutes(span.t0_ms)}–${minutes(span.t1_ms)}`,
        url: null,
        span,
        summary: segments.filter((segment) => (!span.channel || segment.channel === span.channel) && segment.t1_ms > span.t0_ms && segment.t0_ms < span.t1_ms).map((segment) => segment.text).join(" "),
        confidence: "high" as const,
        dated_at: at,
        collected_at: at,
        closed_item: false,
      };
    });
    return { item, evidence, history: shared.historyRows(world, world.changes.filter((c) => c.entity.id === item.id)) };
  },
  item_set_done: (a, { world, emit }) => {
    const item = shared.findItem(world, a.item_id);
    shared.checkRev(item.rev, a.rev);
    const before = shared.itemStatus(item, a.done);
    item.status = a.done ? "done" : "open";
    item.done_at = a.done ? shared.todayNow(world) : null;
    if (item.review === "suggested" && a.done) item.review = "accepted";
    return shared.itemChanged(fake, world, item, emit, a.done ? "Ticked an item" : "Unticked an item", "status", before);
  },
  item_review: (a, { world, emit }) => {
    const item = shared.findItem(world, a.item_id);
    shared.checkRev(item.rev, a.rev);
    const before = item.review;
    item.review = a.decision === "accept" ? "accepted" : a.decision === "reject" ? "rejected" : "suggested";
    return shared.itemChanged(fake, world, item, emit, `Review: ${item.review}`, "review_state", before);
  },
  items_review_all: (a, { world }) => {
    shared.call(world, a.call_id);
    const items = world.items.filter((i) => i.call.id === a.call_id && i.review === "suggested" && (!a.kinds.length || a.kinds.includes(i.kind)));
    const batch_id = items.length ? newId("bat") : null;
    items.forEach((i) => {
      shared.bump(Object.assign(i, { review: "accepted" as const }));
      shared.logChange(fake, world, { entity: { kind: "item", id: i.id, label: i.text }, field: "review_state", before: "suggested", after: "accepted", summary: "Accepted suggested items", batch_id });
    });
    return { items, batch_id, skipped: 0 };
  },
  item_edit: (a, { world, emit }) => {
    const item = shared.findItem(world, a.item_id);
    shared.checkRev(item.rev, a.rev);
    const before = item.text;
    if (a.patch.text != null) {
      if (!a.patch.text.trim()) throw coreError("invalid_input", "text required", { type: "validation", field: "text", rule: "required" });
      item.text = a.patch.text;
      item.edited = true;
    }
    if (a.patch.kind) item.kind = a.patch.kind;
    if (a.patch.is_engineering != null) item.is_engineering = a.patch.is_engineering;
    if (a.patch.due) item.due = a.patch.due.type === "set" ? a.patch.due.date : null;
    if (a.patch.linked_issue) item.linked_issue = a.patch.linked_issue.type === "set" ? a.patch.linked_issue.text : null;
    if (a.patch.owner) {
      const o = a.patch.owner;
      item.owner = o.type === "clear" ? null : o.person.type === "existing" ? shared.personRef(shared.person(world, (o.person as { person_id: string }).person_id)) : { id: newId("per"), display_name: o.person.display_name, short_name: o.person.display_name, initials: o.person.display_name.slice(0, 2).toUpperCase(), is_you: false };
    }
    if (a.patch.topic_id) item.topic = { id: a.patch.topic_id, name: shared.topic(world, a.patch.topic_id).name };
    return shared.itemChanged(fake, world, item, emit, "Edited an item", "text", before);
  },
  item_reopen: (a, { world, emit }) => {
    const item = shared.findItem(world, a.item_id);
    shared.checkRev(item.rev, a.rev);
    if (item.status === "open") throw coreError("invalid_input", "already open", { type: "validation", field: "item_id", rule: "invalid_format" });
    const before = shared.itemStatus(item);
    item.status = "open";
    item.closed_by = null;
    item.done_at = null;
    return shared.itemChanged(fake, world, item, emit, "Reopened an item", "status", before);
  },
  item_create: (a, { world, emit }) => {
    if (!a.text.trim()) throw coreError("invalid_input", "text required", { type: "validation", field: "text", rule: "required" });
    const c = shared.call(world, a.call_id);
    const owner = a.owner?.type === "existing" ? shared.person(world, a.owner.person_id) : null;
    const item = shared.blankItem(fake, c, {
      rev: 0,
      kind: a.kind,
      text: a.text,
      owner: owner ? shared.personRef(owner) : null,
      due: a.due ?? null,
      created_by: "user",
      spans: a.span ? [a.span] : [],
      owed: owner?.is_you ? "by_you" : "to_you",
    });
    world.items.push(item);
    return shared.itemChanged(fake, world, item, emit, "Added an item", null, null);
  },
  item_answer_handoff_landed: (a, { world, emit }) => {
    const item = shared.findItem(world, a.item_id);
    shared.checkRev(item.rev, a.rev);
    if (item.status !== "handed_off") throw coreError("invalid_input", "item is not handed off", { type: "validation", field: "item_id", rule: "invalid_format" });
    const before = shared.itemStatus(item);
    if (a.answer === "landed" || a.answer === "done_another_way") {
      item.status = "done";
      item.done_at = shared.todayNow(world);
    }
    return shared.itemChanged(fake, world, item, emit, `Handoff: ${a.answer.replace(/_/g, " ")}`, "status", before);
  },

  };
}
