import * as Core from "../fake-core";
import { coreError } from "../fake-core";
import * as shared from "./shared";

export function captureHandlers(fake: Core.FakeCore): Core.Handlers {
  const newId = (prefix: string) => shared.nextId(fake, prefix);
  return {
  // ── Capture ──────────────────────────────────────────────────────────
  // O1: a start is never gated on setup, permissions or the self-test.
  capture_start: (a, { world, fake, publish }) => {
    const cap = world.app.capture;
    if (shared.live(cap) || cap.phase === "stopping") throw coreError("already_recording");
    const free = world.app.environment.disk_free_mb;
    if (free < 500) throw coreError("disk_full", "under 500 MB", { type: "disk_space", free_mb: free, needed_mb: 500 });
    if (world.app.setup.models.bundles.some((b) => b.required_for_capture && b.state !== "ready")) throw coreError("model_missing");
    if (a.source === "record_prompt" && a.detection_id) {
      const d = world.app.detection.detection;
      if (d?.id !== a.detection_id || shared.now() >= d.prompt_until) throw coreError("detection_expired");
    }
    if (fake.playback.playing) {
      Object.assign(fake.playback, { playing: false, stopped_reason: "capture_started" });
      publish("playback:state");
    }
    const id = newId("call");
    const banners = world.app.banners.banners;
    if (banners.some((b) => b.type === "recording_interrupted_by_quit")) {
      world.app.banners.banners = banners.filter((b) => b.type !== "recording_interrupted_by_quit");
      publish("banners:changed");
    }
    if (world.app.detection.detection) {
      world.app.detection.detection = null;
      publish("capture:detected");
    }
    const started_at = shared.now();
    shared.createCaptureCall(world, id, "New call", started_at, a.sensitive);
    const audioNotStored = world.settings.audio.retention === "never_store";
    return shared.setCapture(fake, {
      phase: "recording",
      call_id: id,
      title: "New call",
      started_at,
      recorded_ms: 0,
      sensitive: a.sensitive,
      pause: null,
      notice: null,
      continue_until: null,
      audio_not_stored: audioNotStored,
      audio_writing: free >= 500 && !audioNotStored,
    });
  },
  capture_stop: (a, { world, fake, emit }) => {
    shared.requireLive(world.app.capture, a.call_id);
    const row = world.calls.find((c) => c.id === a.call_id);
    if (row) {
      row.status = "processing";
      row.duration_ms = world.app.capture.recorded_ms;
      emit("entity:changed", { type: "call", call: row });
    }
    fake.closeChannels("transcript_subscribe", a.call_id, "call_stopped");
    return shared.setCapture(fake, { phase: "stopped", pause: null, notice: null, continue_until: shared.now() + 5 * shared.MIN });
  },
  capture_set_paused: (a, { world, fake }) => {
    const cap = world.app.capture;
    // A stopped call is not resumed by un-pausing: that is Continue Recording.
    if (cap.call_id !== a.call_id || (cap.phase !== "recording" && cap.phase !== "paused")) throw coreError("not_recording");
    return shared.setCapture(fake, { phase: a.paused ? "paused" : "recording", pause: a.paused ? { since: shared.now(), remind_at: shared.now() + 5 * shared.MIN } : null });
  },
  capture_mark_moment: (a, { world, fake }) => {
    shared.requireLive(world.app.capture, a.call_id);
    const mark = { id: newId("mrk"), call_id: a.call_id, at_ms: world.app.capture.recorded_ms, note: a.note ?? null };
    fake.push("transcript_subscribe", { event: { type: "mark", mark } });
    return mark;
  },
  capture_answer_call_end: (a, { world, fake }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id || !cap.notice || cap.notice.type !== "call_ended") throw coreError("notice_expired");
    return a.choice === "keep_recording"
      ? shared.setCapture(fake, { notice: null })
      : shared.setCapture(fake, { phase: "stopped", notice: null, continue_until: shared.now() + 5 * shared.MIN });
  },
  capture_hold_notice: (a, { world, fake }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id || !cap.notice || cap.notice.type !== "call_ended") throw coreError("notice_expired");
    return shared.setCapture(fake, { notice: { type: "call_ended", stops_at: a.held ? null : shared.now() + 10_000 } });
  },
  capture_continue: (a, { world, fake }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id || cap.phase !== "stopped" || !cap.continue_until || cap.continue_until < shared.now()) throw coreError("continue_window_closed");
    return shared.setCapture(fake, { phase: "recording", continue_until: null, notice: null });
  },
  capture_resume_interrupted: (a, { world, fake, publish }) => {
    const cap = world.app.capture;
    if (cap.phase === "failed" && cap.call_id === a.call_id) {
      // Try Again after the engine stopped: same call, gap row engine_restart.
      world.app.degraded.states = world.app.degraded.states.filter((d) => d.type !== "capture_failed");
      publish("degraded:changed");
      const t = world.transcripts.find((x) => x.call_id === a.call_id);
      const at = t?.segments.at(-1)?.t1_ms ?? 0;
      t?.gaps.push({ call_id: a.call_id, t0_ms: at, t1_ms: at + 2_000, reason: "engine_restart" });
      return shared.setCapture(fake, { phase: "recording", notice: null });
    }
    const banner = world.app.banners.banners.find((b) => b.type === "recording_interrupted_by_quit" && b.call.id === a.call_id);
    if (!banner || banner.type !== "recording_interrupted_by_quit") throw coreError("notice_expired", "the interrupted recording can no longer be resumed");
    if (shared.live(cap)) throw coreError("already_recording");
    world.app.banners.banners = world.app.banners.banners.filter((b) => b !== banner);
    publish("banners:changed");
    const t = world.transcripts.find((x) => x.call_id === a.call_id);
    const at = t?.segments.at(-1)?.t1_ms ?? 0;
    t?.gaps.push({ call_id: a.call_id, t0_ms: at, t1_ms: at + 2_000, reason: "interrupted" });
    return shared.setCapture(fake, { phase: "recording", call_id: a.call_id, title: banner.call.title, started_at: banner.call.started_at, pause: null, notice: null, continue_until: null });
  },
  capture_answer_new_meeting: (a, { world, fake }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id || !cap.notice || cap.notice.type !== "new_meeting") throw coreError("notice_expired");
    if (a.choice === "keep_in_this_call") return shared.setCapture(fake, { notice: null });
    const title = cap.notice.event?.title ?? "New call";
    const id = newId("call");
    const started_at = cap.notice.detected_at;
    // Like the real core, a new call has its row and empty live transcript at once (D-37).
    shared.createCaptureCall(world, id, title, started_at, cap.sensitive);
    return shared.setCapture(fake, { call_id: id, title, started_at, recorded_ms: 0, notice: null });
  },
  capture_keep_recording: (a, { world, fake }) => {
    const cap = world.app.capture;
    if (cap.call_id !== a.call_id || !cap.notice || cap.notice.type !== "nothing_heard") throw coreError("notice_expired");
    return shared.setCapture(fake, { notice: null });
  },
  capture_discard: (a, { world, fake, emit }) => {
    shared.requireLive(world.app.capture, a.call_id);
    fake.closeChannels("transcript_subscribe", a.call_id, "discarded");
    world.calls = world.calls.filter((c) => c.id !== a.call_id);
    world.transcripts = world.transcripts.filter((t) => t.call_id !== a.call_id);
    world.call_details = world.call_details.filter((d) => d.call.id !== a.call_id);
    world.items = world.items.filter((item) => item.call.id !== a.call_id);
    world.outputs = world.outputs.filter((o) => o.call_id !== a.call_id);
    emit("entity:changed", { type: "removed", kind: "call", id: a.call_id });
    return shared.setCapture(fake, { phase: "idle", call_id: null, title: null, started_at: null, recorded_ms: 0, pause: null, notice: null, continue_until: null });
  },
  capture_set_sensitive: (a, { world, fake, emit }) => {
    const cap = world.app.capture;
    const capturing = cap.call_id === a.call_id && shared.live(cap);
    if (capturing && !a.sensitive) {
      throw coreError("invalid_input", "a call can only be made sensitive during capture", { type: "validation", field: "sensitive", rule: "out_of_range" });
    }
    const row = world.calls.find((c) => c.id === a.call_id);
    // The row and its details are one record in the real core: both change, and windows hear it (D-37).
    const detail = world.call_details.find((d) => d.call.id === a.call_id)?.call;
    for (const c of [row, detail]) if (c) c.privacy = a.sensitive ? "sensitive" : "normal";
    if (detail ?? row) emit("entity:changed", { type: "call", call: (detail ?? row)! });
    if (capturing || cap.call_id === a.call_id) return shared.setCapture(fake, { sensitive: a.sensitive });
    if (!row) throw coreError("not_found", `call ${a.call_id}`);
    return cap;
  },
  capture_exclude_source: (a, { world, fake, publish }) => {
    shared.requireLive(world.app.capture, a.call_id);
    world.app.degraded.states = world.app.degraded.states.filter((d) => !(d.type === "second_audio_source" && d.bundle_id === a.bundle_id));
    publish("degraded:changed");
    return fake.world.app.capture;
  },
  capture_keep_source: (a, { world, publish }) => {
    shared.requireLive(world.app.capture, a.call_id);
    const before = world.app.degraded.states.length;
    world.app.degraded.states = world.app.degraded.states.filter((d) => !(d.type === "second_audio_source" && d.bundle_id === a.bundle_id));
    if (world.app.degraded.states.length === before) throw coreError("notice_expired", `no second source ${a.bundle_id}`);
    publish("degraded:changed");
    return world.app.capture;
  },
  capture_dismiss_detection: (a, { world, publish }) => {
    const detection = world.app.detection.detection;
    if (detection?.id !== a.detection_id) throw coreError("detection_expired");
    // The prompt closes; the detection stays for the menu bar while the app holds audio (D-38).
    detection.prompt_until = shared.now();
    publish("capture:detected");
    return shared.ack;
  },
  capture_ignore_app: (a, { world, publish }) => {
    world.settings.general.ignored_apps.push({ bundle_id: a.bundle_id, app_name: a.app_name });
    world.app.detection.detection = null;
    publish("capture:detected");
    publish("settings:changed");
    return shared.ack;
  },

  };
}
