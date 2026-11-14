import * as Bindings from "../../bindings";
import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function peopleHandlers(fake: Core.FakeCore): Core.Handlers {
  const newId = (prefix: string) => shared.nextId(fake, prefix);
  return {
  // ── People ───────────────────────────────────────────────────────────
  people_list: (a, { world }) => {
    const query = a.query?.toLowerCase();
    return {
      people: world.people.filter((p) => !query || [p.display_name, ...p.aliases].some((name) => name.toLowerCase().includes(query))),
      unnamed: world.transcripts.flatMap((t) =>
        t.speakers.flatMap((s) => (s.label.type === "unnamed" ? [{ call: shared.callRef(shared.call(world, t.call_id)), speaker_id: s.id, n: s.label.n, segment_count: s.segment_count, sample: s.sample, suggestion: s.suggestion }] : [])),
      ),
    };
  },
  person_get: (a, { world }) => {
    const p = shared.person(world, a.person_id);
    const calls = world.calls.filter((c) => c.participants.some((x) => x.id === p.id));
    const callIds = new Set(calls.map((call) => call.id));
    const topicIds = new Set(world.items.flatMap((item) => callIds.has(item.call.id) && item.topic ? [item.topic.id] : []));
    return {
      person: p,
      calls,
      owns_open: world.items.filter((i) => i.owner?.id === p.id && i.status === "open"),
      you_owe: p.is_you ? [] : world.items.filter((i) => i.owner?.is_you && i.status === "open" && i.call.id && i.owed === "by_you"),
      open_questions: world.items.filter((i) => i.kind === "open_question" && i.status === "open" && calls.some((c) => c.id === i.call.id)),
      topics: world.topics.filter((topic) => topicIds.has(topic.id)),
      talk_share: world.settings.privacy.behaviour_metrics ? 0.31 : null,
    };
  },
  person_create: (a, { world, emit }) => {
    if (!a.display_name.trim()) throw coreError("invalid_input", "name", { type: "validation", field: "display_name", rule: "required" });
    if (world.people.some((p) => p.display_name.toLowerCase() === a.display_name.trim().toLowerCase())) throw coreError("invalid_input", "duplicate", { type: "validation", field: "display_name", rule: "duplicate" });
    const p: Bindings.PersonRow = { ...world.people[1], id: newId("per"), rev: 1, display_name: a.display_name, short_name: a.display_name, initials: a.display_name.slice(0, 2).toUpperCase(), email: a.email ?? null, role: a.role ?? null, org: a.org ?? null, aliases: [], voice_profile: false, open_items: 0, is_you: false, last_call_at: null };
    world.people.push(p);
    emit("entity:changed", { type: "person", person: p });
    return { person: p, change_id: shared.logChange(fake, world, { entity: { kind: "person", id: p.id, label: p.display_name }, summary: `Added ${p.display_name}` }) };
  },
  person_update: (a, { world, emit }) => {
    const p = shared.person(world, a.person_id);
    shared.checkRev(p.rev, a.rev);
    const patch = a.patch;
    if (patch.display_name != null && !patch.display_name.trim()) throw coreError("invalid_input", "name", { type: "validation", field: "display_name", rule: "required" });
    if (patch.display_name != null) p.display_name = patch.display_name;
    if (patch.short_name != null) p.short_name = patch.short_name;
    if (patch.email !== undefined) p.email = patch.email;
    if (patch.role !== undefined) p.role = patch.role;
    if (patch.org !== undefined) p.org = patch.org;
    if (patch.aliases != null) p.aliases = patch.aliases;
    p.rev += 1;
    emit("entity:changed", { type: "person", person: p });
    return { person: p, change_id: shared.logChange(fake, world, { entity: { kind: "person", id: p.id, label: p.display_name }, summary: `Edited ${p.display_name}` }) };
  },
  people_merge: (a, { world, emit }) => {
    if (a.source === a.target) throw coreError("invalid_input", "same person", { type: "validation", field: "target", rule: "duplicate" });
    const src = shared.person(world, a.source);
    const dst = shared.person(world, a.target);
    dst.aliases = [...new Set([...dst.aliases, src.display_name, ...src.aliases])];
    dst.open_items += src.open_items;
    dst.rev += 1;
    world.people = world.people.filter((p) => p !== src);
    world.items.forEach((i) => i.owner?.id === src.id && (i.owner = shared.personRef(dst)));
    emit("entity:changed", { type: "removed", kind: "person", id: src.id });
    emit("entity:changed", { type: "person", person: dst });
    return { person: dst, change_id: shared.logChange(fake, world, { entity: { kind: "person", id: dst.id, label: dst.display_name }, summary: `Merged ${src.display_name} into ${dst.display_name}` }) };
  },
  person_delete: (a, { world, emit }) => {
    const p = shared.person(world, a.person_id);
    if (p.is_you) throw coreError("invalid_input", "cannot delete yourself", { type: "validation", field: "person_id", rule: "invalid_format" });
    const calls = new Set<string>();
    for (const callId of new Set([...world.transcripts.map((t) => t.call_id), ...world.call_details.map((d) => d.call.id)])) {
      const lists = shared.speakerLists(world, callId);
      for (const speaker of lists.flat()) {
        if (speaker.label.type !== "person" || speaker.label.person.id !== p.id) continue;
        if (speaker.channel === "mic") {
          speaker.label = { type: "guest_your_side" };
        } else {
          const n = Number(speaker.id.match(/^spk_(?:b_)?(\d+)$/)?.[1] ?? 0);
          speaker.label = { type: "unnamed", n: Number.isSafeInteger(n) && n > 0 ? n : 0 };
        }
        speaker.named_by = null;
        calls.add(callId);
      }
    }
    for (const callId of calls) {
      const transcript = world.transcripts.find((t) => t.call_id === callId);
      const speakers = shared.speakerLists(world, callId)[0];
      for (const segment of transcript?.segments ?? []) {
        const speaker = speakers?.find((s) => s.id === segment.speaker.speaker_id);
        if (speaker) segment.speaker.label = speaker.label;
      }
      if (speakers) emit("entity:changed", { type: "speakers", call_id: callId, speakers });
    }
    world.people = world.people.filter((x) => x !== p);
    world.items.forEach((i) => i.owner?.id === p.id && (i.owner = null));
    emit("entity:changed", { type: "removed", kind: "person", id: p.id });
    return { deleted: 1 };
  },
  voice_profile_create: (a, { world }) => {
    const p = shared.person(world, a.person_id);
    p.voice_profile = true;
    return { person_id: p.id, enabled: true, centroids: a.from_speaker ? 1 : 0, opted_in_at: shared.now() };
  },
  voice_profile_delete: (a, { world }) => {
    const p = shared.person(world, a.person_id);
    p.voice_profile = false;
    return { person_id: p.id, enabled: false, centroids: 0, opted_in_at: null };
  },

  };
}
