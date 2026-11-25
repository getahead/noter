import * as Bindings from "../../bindings";
import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

function shortName(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.length < 2 ? name : `${words[0]} ${Array.from(words.at(-1)!)[0]}.`;
}

// The real core joins these chips to the person when it reads them. The fixture embeds copies.
function refreshChips(world: Core.World, person: Bindings.PersonRow) {
  const chip = shared.personRef(person);
  const refresh = (held: Bindings.PersonChip | null) => {
    if (held?.id === person.id) Object.assign(held, chip);
  };
  const refreshLabel = (label: Bindings.SpeakerLabel) => {
    if (label.type === "person") refresh(label.person);
  };
  for (const call of [...world.calls, ...world.call_details.map((detail) => detail.call)]) call.participants.forEach(refresh);
  for (const snapshot of [...world.transcripts, ...world.call_details]) {
    for (const speaker of snapshot.speakers) {
      refreshLabel(speaker.label);
      refresh(speaker.suggestion);
    }
  }
  for (const transcript of world.transcripts) {
    for (const segment of [...transcript.segments, ...transcript.hypotheses]) {
      refreshLabel(segment.speaker.label);
      segment.crosstalk_with.forEach((ref) => refreshLabel(ref.label));
    }
  }
  for (const item of world.items) refresh(item.owner);
}

export function peopleHandlers(fake: Core.FakeCore): Core.Handlers {
  const newId = (prefix: string) => shared.nextId(fake, prefix);
  /** What the user owes a person: their own open actions from calls the person was on (the page's list, the row's count). */
  const owed = (world: Core.FakeCore["world"], p: Bindings.PersonRow) => (p.is_you ? [] : world.items.filter((i) => i.owner?.is_you && i.status === "open" && i.owed === "by_you" && world.calls.some((c) => c.id === i.call.id && c.participants.some((x) => x.id === p.id))));
  return {
  // ── People ───────────────────────────────────────────────────────────
  people_list: (a, { world }) => {
    const fold = (text: string) => text.normalize("NFKC").toLowerCase().replaceAll("ё", "е").replaceAll("ß", "ss").split(/\s+/).filter(Boolean).join(" ");
    const query = a.query ? fold(a.query) : "";
    return {
      people: world.people.filter((p) => !query || [p.display_name, p.short_name, ...p.aliases].some((name) => fold(name).includes(query))).map((p) => ({ ...p, you_owe: owed(world, p).length })),
      unnamed: world.transcripts.flatMap((t) =>
        t.speakers.flatMap((s) => {
          if (s.label.type !== "unnamed") return [];
          // what the speaker said first, as the core quotes it (issue 1151)
          const first = t.segments.find((g) => g.speaker.speaker_id === s.id);
          return [{ call: shared.callRef(shared.call(world, t.call_id)), speaker_id: s.id, n: s.label.n, segment_count: s.segment_count, sample: s.sample, sample_text: first?.text ?? null, sample_lang: first?.lang ?? null, suggestion: s.suggestion }];
        }),
      ),
    };
  },
  person_get: (a, { world }) => {
    const p = shared.person(world, a.person_id);
    const spoken = new Set(world.transcripts.filter((tr) => tr.speakers.some((s) => s.label.type === "person" && s.label.person.id === p.id)).map((tr) => tr.call_id));
    const calls = world.calls.filter((c) => spoken.has(c.id) || c.participants.some((x) => x.id === p.id));
    const callIds = new Set(calls.map((call) => call.id));
    const topicIds = new Set(world.items.flatMap((item) => callIds.has(item.call.id) && item.topic ? [item.topic.id] : []));
    return {
      person: { ...p, you_owe: owed(world, p).length },
      calls,
      owns_open: world.items.filter((i) => i.owner?.id === p.id && i.status === "open"),
      you_owe: owed(world, p),
      open_questions: world.items.filter((i) => i.kind === "open_question" && i.status === "open" && calls.some((c) => c.id === i.call.id)),
      topics: world.topics.filter((topic) => topicIds.has(topic.id)),
      talk_share: world.settings.privacy.behaviour_metrics ? 0.31 : null,
      // PE-R5 Languages and the PE-R1 cadence, as the core reads them (#1152)
      languages: languagesOf(world, p.id),
      cadence: p.is_you ? null : cadenceOf(calls.map((c) => [c.started_at, c.participants.filter((x) => !x.is_you).length] as [number, number])),
    };
  },
  person_create: (a, { world, emit }) => {
    if (!a.display_name.trim()) throw coreError("invalid_input", "name", { type: "validation", field: "display_name", rule: "required" });
    const p: Bindings.PersonRow = { ...world.people[1], id: newId("per"), rev: 1, display_name: a.display_name, short_name: a.display_name, initials: a.display_name.slice(0, 2).toUpperCase(), email: a.email ?? null, role: a.role ?? null, org: a.org ?? null, aliases: [], voice_profile: false, open_items: 0, you_owe: 0, notes: null, is_you: false, last_call_at: null };
    world.people.push(p);
    emit("entity:changed", { type: "person", person: p });
    return { person: p, change_id: shared.logChange(fake, world, { entity: { kind: "person", id: p.id, label: p.display_name }, summary: `Added ${p.display_name}` }) };
  },
  person_update: (a, { world, emit }) => {
    const p = shared.person(world, a.person_id);
    shared.checkRev(p.rev, a.rev);
    const patch = a.patch;
    if (patch.display_name != null && !patch.display_name.trim()) throw coreError("invalid_input", "name", { type: "validation", field: "display_name", rule: "required" });
    if (patch.display_name != null) {
      if (p.short_name === shortName(p.display_name)) p.short_name = shortName(patch.display_name);
      p.display_name = patch.display_name;
      p.initials = patch.display_name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("").toUpperCase();
    }
    if (patch.short_name != null) p.short_name = patch.short_name;
    if (patch.email !== undefined) p.email = patch.email;
    if (patch.role !== undefined) p.role = patch.role;
    if (patch.org !== undefined) p.org = patch.org;
    if (patch.aliases != null) p.aliases = patch.aliases;
    if (patch.notes !== undefined) p.notes = patch.notes;
    p.rev += 1;
    if (patch.display_name != null || patch.short_name != null) refreshChips(world, p);
    emit("entity:changed", { type: "person", person: p });
    return { person: p, change_id: shared.logChange(fake, world, { entity: { kind: "person", id: p.id, label: p.display_name }, summary: `Edited ${p.display_name}` }) };
  },
  people_merge: (a, { world, emit }) => {
    if (a.source === a.target) throw coreError("invalid_input", "same person", { type: "validation", field: "target", rule: "duplicate" });
    const src = shared.person(world, a.source);
    const dst = shared.person(world, a.target);
    dst.aliases = [...new Set([...dst.aliases, src.display_name, ...src.aliases])];
    dst.open_items += src.open_items;
    dst.voice_profile ||= src.voice_profile; // the core moves the source's profiles and keeps opt-in as target || source
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
    p.voice_profile_stats = { opted_in_at: shared.now(), profiles: a.from_speaker ? 1 : 0,
      matched_calls: new Set(world.transcripts.flatMap((t) => t.speakers.filter((s) => s.label.type === "person" && s.label.person.id === p.id && s.named_by === "voice_profile").map(() => t.call_id))).size };
    return { person_id: p.id, enabled: true, centroids: p.voice_profile_stats.profiles, opted_in_at: p.voice_profile_stats.opted_in_at };
  },
  voice_profile_delete: (a, { world }) => {
    const p = shared.person(world, a.person_id);
    p.voice_profile = false;
    p.voice_profile_stats = null;
    return { person_id: p.id, enabled: false, centroids: 0, opted_in_at: null };
  },

  };
}

/** Speaking time per language of the person's lines, largest first. */
function languagesOf(world: Core.World, personId: string): Bindings.LanguageShare[] {
  const ms = new Map<string, { lang: Bindings.Lang; ms: number }>();
  for (const tr of world.transcripts)
    for (const g of tr.segments)
      if (g.lang && g.speaker.label.type === "person" && g.speaker.label.person.id === personId) {
        const key = typeof g.lang === "string" ? g.lang : g.lang.code;
        const e = ms.get(key) ?? { lang: g.lang, ms: 0 };
        e.ms += g.t1_ms - g.t0_ms;
        ms.set(key, e);
      }
  const total = [...ms.values()].reduce((n, e) => n + e.ms, 0);
  return total ? [...ms.values()].sort((a, b) => b.ms - a.ms).map((e) => ({ lang: e.lang, share: e.ms / total })) : [];
}

/** 1:1 when most calls had only them; the usual gap (median) between three or more calls. */
function cadenceOf(calls: [number, number][]): Bindings.Cadence | null {
  const DAY = 86_400_000;
  const one_on_one = calls.filter(([, others]) => others === 1).length * 2 > calls.length;
  const starts = calls.map(([at]) => at).sort((a, b) => a - b);
  const gaps = starts.slice(1).map((at, i) => Math.round((at - starts[i]!) / DAY)).sort((a, b) => a - b);
  const mid = starts.length >= 3 ? gaps[Math.floor(gaps.length / 2)]! : -1;
  const every: Bindings.CadenceEvery | null = mid >= 6 && mid <= 8 ? "weekly" : mid >= 13 && mid <= 15 ? "every_two_weeks" : mid >= 27 && mid <= 33 ? "monthly" : null;
  return one_on_one || every ? { one_on_one, every } : null;
}
