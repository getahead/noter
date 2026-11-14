import * as Bindings from "../../bindings";
import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function transcriptHandlers(fake: Core.FakeCore): Core.Handlers {
  const newId = (prefix: string) => shared.nextId(fake, prefix);
  return {
  // ── Transcript ───────────────────────────────────────────────────────
  transcript_subscribe: (a, { world, fake, send }) => {
    const snap = world.transcripts.find((t) => t.call_id === a.call_id);
    if (!snap) {
      const c = shared.call(world, a.call_id);
      return { subscription_id: null, call_id: c.id, live: false, pass: "archive", archive: c.archive, segments: [], hypotheses: [], marks: [], gaps: [], speakers: [], last_seq: 0, audio_available: !c.audio_deleted };
    }
    const isLive = snap.live && world.app.capture.call_id === a.call_id && shared.live(world.app.capture);
    // Deleting a call's audio keeps its transcript and ends replay.
    if (!isLive) return { ...snap, subscription_id: null, live: false, audio_available: snap.audio_available && !world.calls.find((c) => c.id === a.call_id)?.audio_deleted };
    const sub = newId("sub");
    fake.openChannel(sub, "transcript_subscribe", send as (m: unknown) => void, snap.last_seq, a.call_id);
    // Like the real core, messages can reach the page before this snapshot resolves: one the
    // snapshot already contains (seq = last_seq) and the first new one. The client drops the
    // first and holds the second until the snapshot is in (R23).
    // The script is the fixture call's speech: a call started at runtime waits for its own (D-37).
    const played = shared.scriptPlayed.get(snap) ?? 0; // a resubscribe carries on where the script was, like the real core's snapshot
    const [first, ...rest] = world.live_script.filter((e) => shared.scriptCall(e) === undefined || shared.scriptCall(e) === a.call_id).slice(played);
    send({ seq: snap.last_seq, event: { type: "segments_updated", segments: snap.segments.slice(-1) } });
    // what the stream sends joins the snapshot, so the next subscribe returns everything up to `last_seq`
    const play = (event: (typeof rest)[number]) => {
      const delivered = fake.pushAll("transcript_subscribe", { event }, a.call_id);
      if (!delivered) return;
      if (event.type === "confirmed") snap.segments.push(event.segment);
      snap.last_seq += 1;
      shared.scriptPlayed.set(snap, (shared.scriptPlayed.get(snap) ?? 0) + 1);
    };
    const snapshot = { ...snap, segments: [...snap.segments], subscription_id: sub }; // taken before the first new message, which the client holds (R23)
    if (first && !shared.scriptRunning.has(snap)) {
      shared.scriptRunning.add(snap);
      play(first);
      if (!rest.length) shared.scriptRunning.delete(snap);
      rest.forEach((event, i) => fake.later((i + 1) * world.script_interval_ms, () => {
        play(event);
        if (i === rest.length - 1) shared.scriptRunning.delete(snap);
      }));
    }
    return snapshot;
  },
  levels_subscribe: (_a, { fake, send }) => {
    const sub = newId("sub");
    fake.openChannel(sub, "levels_subscribe", send as (m: unknown) => void);
    let t = 0;
    const tick = () => {
      t += 100;
      if (fake.push(sub, { at_ms: t, mic_db: -30 - Math.random() * 20, sys_db: -25 - Math.random() * 20 }) !== null) fake.later(100, tick);
    };
    fake.later(100, tick);
    return { subscription_id: sub, last_seq: 0 };
  },
  transcript_rename_speaker: (a, { world, emit, fake }) => {
    const t = world.transcripts.find((x) => x.call_id === a.call_id);
    const lists = shared.speakerLists(world, a.call_id);
    const spk = lists.flat().find((s) => s.id === a.speaker_id);
    if (!t || !spk) throw coreError("not_found");
    const p = a.person.type === "existing" ? shared.person(world, a.person.person_id) : undefined;
    const name = p?.display_name ?? (a.person.type === "new" ? a.person.display_name : "Unknown");
    if (!name.trim()) throw coreError("invalid_input", "name", { type: "validation", field: "person", rule: "required" });
    const before = JSON.stringify(shared.namingState(world, a.call_id));
    const oldName = shared.speakerName(spk.label);
    const assigned: Bindings.SpeakerLabel = { type: "person", person: p ? shared.personRef(p) : { id: newId("per"), display_name: name, short_name: name, initials: name.slice(0, 2).toUpperCase(), is_you: false } };
    const segmentId = a.scope.type === "one_segment" ? a.scope.segment_id : null;
    if (a.scope.type === "one_segment") {
      const segment = t.segments.find((s) => s.id === segmentId && s.speaker.speaker_id === spk.id);
      if (!segment) throw coreError("not_found", "segment");
      const resultSpeaker: typeof spk = { ...structuredClone(spk), id: newId("spk"), label: assigned, named_by: "you", segment_count: 1 };
      for (const list of new Set(lists)) {
        const original = list.find((speaker) => speaker.id === spk.id);
        if (original) original.segment_count = Math.max(0, original.segment_count - 1);
        if (!list.some((speaker) => speaker.id === resultSpeaker.id)) list.push(structuredClone(resultSpeaker));
      }
      segment.speaker = { speaker_id: resultSpeaker.id, label: assigned };
    } else {
      for (const speaker of lists.flat().filter((s) => s.id === a.speaker_id)) {
        speaker.label = assigned;
        speaker.named_by = "you";
      }
    }
    if (segmentId) fake.push("transcript_subscribe", { event: { type: "segments_updated", segments: [t.segments.find((s) => s.id === segmentId)!] } });
    emit("entity:changed", { type: "speakers", call_id: a.call_id, speakers: t.speakers });
    if (a.scope.type === "whole_call") {
      for (const section of shared.namedSections(world, a.call_id, [[oldName, name]])) emit("entity:changed", { type: "section", call_id: a.call_id, section });
    }
    const change_id = shared.logChange(fake, world, { entity: { kind: "speaker", id: spk.id, label: name }, before, after: JSON.stringify(shared.namingState(world, a.call_id)), summary: `Named a speaker as ${name}` });
    return { speakers: t.speakers, change_id };
  },
  transcript_fix_term: (a, { world, fake }) => {
    const seg = world.transcripts.find((t) => t.call_id === a.call_id)?.segments.find((s) => s.id === a.segment_id);
    if (!seg) throw coreError("not_found");
    if (!a.replacement.trim()) throw coreError("invalid_input", "replacement", { type: "validation", field: "replacement", rule: "required" });
    if (a.range.start < 0 || a.range.end <= a.range.start || a.range.end > seg.text.length) throw coreError("invalid_input", "range", { type: "validation", field: "range", rule: "out_of_range" });
    const original = seg.text.slice(a.range.start, a.range.end);
    seg.text = seg.text.slice(0, a.range.start) + a.replacement + seg.text.slice(a.range.end);
    const delta = a.replacement.length - (a.range.end - a.range.start);
    seg.corrections = seg.corrections.flatMap((correction) => {
      if (correction.range.end <= a.range.start) return [correction];
      if (correction.range.start >= a.range.end) return [{ ...correction, range: { start: correction.range.start + delta, end: correction.range.end + delta } }];
      return [];
    });
    seg.corrections.push({ range: { start: a.range.start, end: a.range.start + a.replacement.length }, original });
    seg.corrections.sort((x, y) => x.range.start - y.range.start);
    fake.push("transcript_subscribe", { event: { type: "segments_updated", segments: [seg] } });
    const change_id = shared.logChange(fake, world, { entity: { kind: "segment", id: seg.id, label: "Transcript line" }, field: "text", before: original, after: a.replacement, summary: `Fixed “${original}” to “${a.replacement}”` });
    return { segment: seg, change_id, glossary_term_id: a.add_to_glossary ? newId("gls") : null, proposal_queued: a.add_to_glossary };
  },
  transcript_name_speakers: (a, { world, emit }) => {
    const lists = shared.speakerLists(world, a.call_id);
    const speakers = lists[0];
    if (!speakers) throw coreError("not_found", `call ${a.call_id}`);
    const before = JSON.stringify(shared.namingState(world, a.call_id));
    const names: [string, string][] = [];
    const named = a.assignments.flatMap((as) => {
      const spk = speakers.find((s) => s.id === as.speaker_id);
      if (!spk) throw coreError("not_found", `speaker ${as.speaker_id}`);
      if (!as.person) return [];
      const p = as.person.type === "existing" ? shared.person(world, as.person.person_id) : null;
      const name = p?.display_name ?? (as.person.type === "new" ? as.person.display_name : "Unknown");
      names.push([shared.speakerName(spk.label), name]);
      const label: Bindings.SpeakerLabel = { type: "person", person: p ? shared.personRef(p) : { id: newId("per"), display_name: name, short_name: name, initials: name.slice(0, 2).toUpperCase(), is_you: false } };
      for (const speaker of lists.flat().filter((s) => s.id === as.speaker_id)) {
        speaker.label = label;
        speaker.named_by = "you";
      }
      return [spk];
    });
    emit("entity:changed", { type: "speakers", call_id: a.call_id, speakers });
    for (const section of shared.namedSections(world, a.call_id, names)) emit("entity:changed", { type: "section", call_id: a.call_id, section });
    return { speakers: named, change_id: shared.logChange(fake, world, { entity: { kind: "call", id: a.call_id, label: "Speakers" }, before, after: JSON.stringify(shared.namingState(world, a.call_id)), summary: `Named ${named.length} speakers` }) };
  },
  transcript_span: (a, { world }) => {
    const t = world.transcripts.find((x) => x.call_id === a.span.call_id);
    const c = shared.call(world, a.span.call_id);
    const all = t?.segments ?? [];
    const { t0_ms, t1_ms, channel } = a.span;
    const inSpan = (s: (typeof all)[number]) => (!channel || s.channel === channel) && s.t1_ms > t0_ms && s.t0_ms < t1_ms;
    const archived = all.some((s) => s.pass === "archive");
    const words = (pass: string) => {
      const hit = all.filter((s) => s.pass === pass && inSpan(s));
      return hit.length ? hit.map((s) => s.text).join(" ") : null;
    };
    // The archive pass replaces the live lines: a span with none left is gone, one that reads differently is upgraded.
    const before = words("live");
    const after = words("archive");
    if (archived && before !== null && after === null) throw coreError("transcript_upgraded", "the archive pass replaced the lines of this span");
    const archive_change = before !== null && after !== null && before !== after ? { before, after } : null;
    const current = archived ? "archive" : "live";
    return {
      span: a.span,
      call: shared.callRef(c),
      segments: all.filter((s) => (s.pass ?? current) === current && inSpan(s)),
      audio_available: !c.audio_deleted,
      upgraded_by_archive: archive_change !== null,
      archive_change,
    };
  },
  audio_play: (a, { world, fake, publish }) => {
    if (shared.call(world, a.call_id).audio_deleted) throw coreError("audio_deleted");
    const cap = world.app.capture;
    const env = world.app.environment;
    if (shared.live(cap)) {
      if (!world.settings.audio.exclude_own_sounds) throw coreError("own_sounds_not_excluded");
      if (env.output_route === "speakers") throw coreError("replay_needs_headphones");
      const marked = env.output_device ? world.settings.audio.output.headphones_devices.includes(env.output_device.uid) : false;
      if (env.output_route === "unknown" && !marked) throw coreError("output_route_unknown");
    }
    Object.assign(fake.playback, { playing: true, call_id: a.call_id, position_ms: a.from_ms, to_ms: a.to_ms ?? null, route: env.output_route, stopped_reason: null });
    publish("playback:state");
    const playVersion = fake.playback.version;
    fake.later(3000, () => {
      if (fake.playback.playing && fake.playback.version === playVersion) {
        Object.assign(fake.playback, { playing: false, stopped_reason: "ended" });
        publish("playback:state");
      }
    });
    return fake.playback;
  },
  audio_stop: (_a, { fake, publish }) => {
    if (fake.playback.playing) {
      Object.assign(fake.playback, { playing: false, stopped_reason: "user" });
      publish("playback:state");
    }
    return fake.playback;
  },
  audio_delete: (a, { world, emit }) => {
    const found = a.call_ids.map((id) => shared.call(world, id));
    // A capturing call keeps its audio, like the real core: nothing is removed when one is named.
    if (found.some((c) => c.status === "recording" || c.status === "paused")) throw coreError("invalid_input", "call_ids", { type: "validation", field: "call_ids", rule: "invalid_format" });
  const calls = shared.removeAudio(fake, world, found, emit);
    return { calls: calls.length, freed_mb: calls.length * 58 };
  },
  audio_delete_older: (a, { world, emit }) => {
    if (a.older_than_days < 1) throw coreError("invalid_input", "days", { type: "validation", field: "older_than_days", rule: "out_of_range" });
    const cutoff = world.now - a.older_than_days * 86_400_000;
    const candidates = world.calls.filter((c) => c.status !== "recording" && c.status !== "paused" && c.started_at < cutoff);
  const calls = shared.removeAudio(fake, world, candidates, emit);
    return { calls: calls.length, freed_mb: calls.length * 58 };
  },

  };
}
