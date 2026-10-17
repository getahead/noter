---
title: "Feature: Engine capture, live ASR and capture-first restart"
description: "Both channels on one clock into a crash-safe ring, live transcription with language ID and filters, the facts the session manager needs, replay playback, and a capture-first restart with at most a 2 s gap."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M1
lane: engine
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Engine capture, live ASR and capture-first restart

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Capture a session](#capture-a-session)
  - [Detect a call](#detect-a-call)
  - [Recover from an engine crash during capture](#recover-from-an-engine-crash-during-capture)
  - [Replay a span](#replay-a-span)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Live ASR loop](#live-asr-loop)
  - [System audio silence detection](#system-audio-silence-detection)
  - [Translate engine facts into degraded states](#translate-engine-facts-into-degraded-states)
- [4. States (CDSL)](#4-states-cdsl)
  - [Engine session](#engine-session)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Capture pipeline](#capture-pipeline)
  - [Live transcription on budget](#live-transcription-on-budget)
  - [Detection facts](#detection-facts)
  - [Capture-first restart](#capture-first-restart)
  - [Silence, stall and device facts](#silence-stall-and-device-facts)
  - [Replay and footprint](#replay-and-footprint)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p2` - **ID**: `cpt-noter-featstatus-core-engine-capture`

- [ ] `p2` - `cpt-noter-feature-core-engine-capture`

## 1. Feature Context

### 1.1 Overview

The engine gains its main job: a global Core Audio process tap (excluding the engine's and the app's PIDs) and the microphone on one clock, written into a capture ring that is a memory-mapped file in the App Group container, and to AAC-LC files unless the call stores no audio. VAD, per-utterance language ID and Noter's streaming decode loop on WhisperKit produce hypotheses about once a second and confirmed segments with live speaker labels. Detection listeners report meeting apps. Replay plays a span natively. On the Rust side, the supervisor restarts a crashed engine in capture-first mode and translates engine facts into degraded states.

### 1.2 Purpose

Capture is the release blocker: 99 % of calls recorded end to end without dropouts, 0 bytes of audio off the Mac, hypothesis lag ≤ 2 s and confirmed lag ≤ 4 s (provisional). Everything the session manager and the transcript do in M1 stands on these facts arriving on time and the engine coming back after a crash.

**Requirements**: PRD › Audio capture on macOS; PRD › Transcription pipeline; PRD › Success metrics › Capture (release blocker) and Live.

**Principles**: `cpt-noter-principle-core-degrade`

**Delivers**: no IPC command directly. It is the engine half of every M1 capture command and story; it provides the engine side of `cpt-noter-seq-call-screen-recover-capture` (crash, silent system audio, stalled transcription, device change), a story owned by `cpt-noter-feature-core-capture-session` and the M1 performance scenarios `live-hypothesis-lag`, `live-confirmed-lag` and `call-memory-footprint`.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Engine supervisor (core) | Starts, pauses, stops sessions; restarts the engine; turns facts into degraded states |
| Engine sidecar | Captures, transcribes, detects, plays; reports facts |
| Meeting app (Teams, Zoom, Meet in a browser, …) | Holds the microphone and plays call audio; detected by its bundle id |
| macOS audio system | Changes devices (AirPods, dock), reports routes |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-engine-capture`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-engine`, `cpt-noter-component-core-engine-supervisor`, `cpt-noter-interface-engine-stdio`; 3.1 Capture transitions (engine crash rows); open question Q7
- **Dependencies**: `cpt-noter-feature-core-engine-foundation`

## 2. Actor Flows (CDSL)

### Capture a session

- [ ] `p1` - **ID**: `cpt-noter-flow-core-engine-capture-session`

**Actor**: Engine supervisor (on behalf of the session manager)

**Success Scenarios**:
- `start_session` opens both streams, `session_started` names the devices, segments and levels flow; `pause` stops both streams; `resume` reopens them; `stop` flushes, writes `timeline.json` and reports `session_stopped` with the file paths.
- A call that stores no audio runs the same pipeline without AAC writers.

**Error Scenarios**:
- The microphone is unavailable or access is off: the session still starts with the system channel; `error { device_unavailable }` or silent buffers let the core raise `MicrophoneOff`.
- The disk fills: AAC writing stops (`disk_full` error event), transcription goes on.
- The live model fails to load: `error { model_load_failed }`; the supervisor reports `engine_unavailable`.

**Steps**:
1. [ ] - `p1` - Supervisor sends `start_session { call_id, session_dir, store_audio, mic_device_uid, exclude_bundle_ids, languages, backend, glossary, speaker_priors, resume_from_ms }` - `inst-start-session`
2. [ ] - `p1` - Engine opens the global tap (excluding its own and the app's PIDs and excluded bundles) and the microphone on one clock - `inst-open-streams`
3. [ ] - `p1` - Engine writes both channels into the capture ring and, if `store_audio`, into `audio/<call_id>/mic.m4a` and `sys.m4a` - `inst-write-ring`
4. [ ] - `p1` - Engine emits `session_started { call_id, mic_device, output_device }` - `inst-session-started`
5. [ ] - `p1` - Engine runs `cpt-noter-algo-core-engine-capture-live-asr` on both channels and emits `levels` about every 100 ms - `inst-run-asr`
6. [ ] - `p1` - **IF** the supervisor sends `pause` - `inst-if-pause`
   1. [ ] - `p1` - Engine stops both streams (no audio kept while paused) until `resume` - `inst-pause-streams`
7. [ ] - `p1` - **IF** the supervisor sends `stop` - `inst-if-stop`
   1. [ ] - `p1` - Engine flushes the decoder and writers, writes `timeline.json`, emits `session_stopped { call_id, timeline_path, mic_path, sys_path }` - `inst-stop`
8. [ ] - `p1` - **RETURN** - `inst-return-session`

### Detect a call

- [ ] `p1` - **ID**: `cpt-noter-flow-core-engine-capture-detect`

**Actor**: Meeting app

**Success Scenarios**:
- A known meeting app starts playing call audio while holding the microphone: `call_detected { bundle_id, app_name, pid }`. It lets go of both: `call_audio_released { bundle_id }`. A second app starts sending audio during a session: `audio_source_added`.

**Error Scenarios**:
- Detection is off (`set_detection { enabled: false }`): no detection events; capture started by hand still works.

**Steps**:
1. [ ] - `p1` - Supervisor sends `set_detection { enabled, known_bundle_ids }` whenever the detection rule changes - `inst-set-detection`
2. [ ] - `p1` - **IF** enabled, engine listens for audio-process and microphone-use changes of known bundles - `inst-listen`
3. [ ] - `p1` - Engine emits `call_detected`, `call_audio_released` or `audio_source_added` as facts; it never decides to record - `inst-emit-facts`
4. [ ] - `p1` - **RETURN** - `inst-return-detect`

### Recover from an engine crash during capture

- [ ] `p1` - **ID**: `cpt-noter-flow-core-engine-capture-recover`

**Actor**: Engine supervisor

**Success Scenarios**:
- The engine dies mid-call; the supervisor restarts it in capture-first mode, the taps open before the models load, capture resumes from the ring's write position, and the call gets one `engine_restart` gap of at most 2 s.

**Error Scenarios**:
- The engine cannot be restarted: `CaptureFailed { call_id, since }` for the session manager (phase `failed`, NT-3); nothing more is recorded, the call is not ended.

**Steps**:
1. [ ] - `p1` - Supervisor sees the process exit or miss `ping` while a session runs - `inst-see-crash`
2. [ ] - `p1` - Supervisor respawns the engine and sends `start_session` with the same `call_id` and `resume_from_ms` = the ring's last written offset - `inst-respawn`
3. [ ] - `p1` - Engine opens the taps first, then loads the models, then resumes decoding from the ring - `inst-capture-first`
4. [ ] - `p1` - Supervisor reports a gap `engine_restart` from the last confirmed audio to the resumed offset - `inst-report-gap`
5. [ ] - `p1` - **IF** the restart fails three times within 30 s - `inst-if-restart-fails`
   1. [ ] - `p1` - **RETURN** `CaptureFailed { call_id, since }` to the session manager - `inst-return-failed`
6. [ ] - `p1` - **RETURN** session running again - `inst-return-recovered`

### Replay a span

- [ ] `p2` - **ID**: `cpt-noter-flow-core-engine-capture-replay`

**Actor**: Engine supervisor (on behalf of the transcript)

**Success Scenarios**:
- `play { call_id, from_ms, to_ms, channel }` plays from the stored files on the current output; `playback_position` reports progress; `stop_playback` or the end stops it.

**Error Scenarios**:
- The audio was not stored or was deleted: `error` for the command; the core maps it to `audio_deleted`.

**Steps**:
1. [ ] - `p1` - Supervisor sends `play` - `inst-play`
2. [ ] - `p1` - Engine plays the span; its own PID is excluded from the tap, so replay never enters the recording - `inst-play-excluded`
3. [ ] - `p1` - Engine emits `playback_position { at_ms, playing }` while playing and once when it stops - `inst-position`
4. [ ] - `p1` - **RETURN** - `inst-return-replay`

## 3. Processes / Business Logic (CDSL)

### Live ASR loop

- [ ] `p1` - **ID**: `cpt-noter-algo-core-engine-capture-live-asr`

**Input**: Audio frames per channel from the ring, the glossary, languages and speaker priors of the session.

**Output**: `segment` events (hypothesis, then confirmed) with channel, times, language, text and live speaker label; `speaker_turn`, `no_segments` and `silence` facts.

**Steps**:
1. [ ] - `p1` - Run VAD per channel; outside speech, emit nothing but levels - `inst-vad`
2. [ ] - `p1` - Identify the language per utterance among the session languages - `inst-lang-id`
3. [ ] - `p1` - Decode in streaming mode; emit a hypothesis about once a second per active channel - `inst-hypothesis`
4. [ ] - `p1` - When an utterance is stable, apply the hallucination and term filters and the glossary, then emit it as confirmed with a live speaker label - `inst-confirm`
5. [ ] - `p1` - **IF** speech flows on a channel but no segment was produced for 10 s, emit `no_segments { since_ms }` - `inst-no-segments`
6. [ ] - `p1` - **IF** both channels carry no speech for the silence window, emit `silence { since_ms }` - `inst-silence`
7. [ ] - `p1` - **RETURN** per frame batch - `inst-return-asr`

### System audio silence detection

- [ ] `p1` - **ID**: `cpt-noter-algo-core-engine-capture-zero-detect`

**Input**: System-channel buffers.

**Output**: `system_audio_silent { call_id, since_ms, confidence }` when the permission is likely off.

**Steps**:
1. [ ] - `p1` - Count consecutive buffers made of exact digital zeros (a real quiet room is never exact zero) - `inst-count-zeros`
2. [ ] - `p1` - **IF** zeros persist past the threshold while the meeting app is detected, emit the fact with a confidence that grows with the duration - `inst-emit-silent`
3. [ ] - `p1` - **RETURN** - `inst-return-zero`

### Translate engine facts into degraded states

- [ ] `p1` - **ID**: `cpt-noter-algo-core-engine-capture-degraded`

**Input**: Engine events during a session.

**Output**: Degraded states for the session manager to publish.

**Steps**:
1. [ ] - `p1` - `no_segments` for 10 s while levels show audio → `TranscriptionStalled`; a `stalled` gap if it lasts - `inst-stalled`
2. [ ] - `p1` - `system_audio_silent` → `SystemAudioSilent { call_id, since, confidence }` - `inst-silent`
3. [ ] - `p1` - Microphone `device_unavailable` or silent microphone while the system channel speaks → `MicrophoneOff { call_id }` - `inst-mic-off`
4. [ ] - `p1` - `device_changed` → `DeviceChanged` and a `device_changed` gap from `gap_from_ms` to `gap_to_ms` - `inst-device`
5. [ ] - `p1` - Engine restart → an `engine_restart` gap; failure → `CaptureFailed` - `inst-restart-states`
6. [ ] - `p1` - **RETURN** the states; clearing a state is the same rule in reverse - `inst-return-degraded`

## 4. States (CDSL)

### Engine session

- [ ] `p1` - **ID**: `cpt-noter-state-core-engine-capture-session`

**States**: idle, starting, capturing, paused, restarting, stopping, stopped, failed

**Initial State**: idle

**Transitions**:
1. [ ] - `p1` - **FROM** idle **TO** starting **WHEN** `start_session` is sent - `inst-st-starting`
2. [ ] - `p1` - **FROM** starting **TO** capturing **WHEN** `session_started` arrives - `inst-st-capturing`
3. [ ] - `p1` - **FROM** capturing **TO** paused **WHEN** `pause` is acknowledged - `inst-st-paused`
4. [ ] - `p1` - **FROM** paused **TO** capturing **WHEN** `resume` is acknowledged - `inst-st-resumed`
5. [ ] - `p1` - **FROM** capturing **TO** restarting **WHEN** the engine process dies - `inst-st-restarting`
6. [ ] - `p1` - **FROM** restarting **TO** capturing **WHEN** the capture-first restart resumed from the ring - `inst-st-recovered`
7. [ ] - `p1` - **FROM** restarting **TO** failed **WHEN** the engine cannot be restarted - `inst-st-failed`
8. [ ] - `p1` - **FROM** failed **TO** restarting **WHEN** the user presses **Try Again** - `inst-st-try-again`
9. [ ] - `p1` - **FROM** capturing **TO** stopping **WHEN** `stop` is sent - `inst-st-stopping`
10. [ ] - `p1` - **FROM** stopping **TO** stopped **WHEN** `session_stopped` arrives - `inst-st-stopped`

## 5. Definitions of Done

### Capture pipeline

- [ ] `p1` - **ID**: `cpt-noter-dod-core-engine-capture-pipeline`

The system **MUST** capture the tap (excluding the engine and app PIDs) and the microphone on one clock into a memory-mapped capture ring in the App Group container, write AAC-LC files only when audio is stored, pause both streams on `pause`, and write `timeline.json` on stop.

**Implements**:
- `cpt-noter-flow-core-engine-capture-session`
- `cpt-noter-state-core-engine-capture-session`

**Constraints**: `cpt-noter-constraint-core-macos`, `cpt-noter-constraint-core-engine-offline`

**Touches**:
- Entities: capture ring, `audio/<call_id>/` files, `timeline.json`

### Live transcription on budget

- [ ] `p1` - **ID**: `cpt-noter-dod-core-engine-capture-asr`

The system **MUST** emit hypotheses about once a second and confirmed segments with language and live speaker label, with hypothesis lag ≤ 2 s and confirmed lag ≤ 4 s on the golden set replayed through file mode; the `live-hypothesis-lag` and `live-confirmed-lag` scenarios report wall time on the Mac runner.

**Implements**:
- `cpt-noter-algo-core-engine-capture-live-asr`

**Touches**:
- Entities: `EngineSegment`

### Detection facts

- [ ] `p1` - **ID**: `cpt-noter-dod-core-engine-capture-detection`

The system **MUST** report `call_detected`, `call_audio_released` and `audio_source_added` only while detection is enabled (or, for a second source, while a session runs) and never act on them itself.

**Implements**:
- `cpt-noter-flow-core-engine-capture-detect`

**Touches**:
- Entities: detection facts

### Capture-first restart

- [ ] `p1` - **ID**: `cpt-noter-dod-core-engine-capture-restart`

The system **MUST** restart a crashed engine with taps before models, resume from the ring's write position with one `engine_restart` gap of at most 2 s per restart, and raise `CaptureFailed` when it cannot; an engine-kill drill during a replayed call proves the gap bound (the Q7 test).

**Implements**:
- `cpt-noter-flow-core-engine-capture-recover`
- `cpt-noter-algo-core-engine-capture-degraded`

**Touches**:
- Entities: `GapView` (`engine_restart`), `DegradedState::CaptureFailed`

### Silence, stall and device facts

- [ ] `p1` - **ID**: `cpt-noter-dod-core-engine-capture-facts`

The system **MUST** detect exact digital zeros on the system channel as `system_audio_silent` with a confidence, report stalls after 10 s without segments while audio flows, and report device changes with their gap bounds, so the session manager can show `SystemAudioSilent`, `TranscriptionStalled`, `MicrophoneOff` and `DeviceChanged`.

**Implements**:
- `cpt-noter-algo-core-engine-capture-zero-detect`
- `cpt-noter-algo-core-engine-capture-degraded`

**Touches**:
- Entities: `DegradedState`

### Replay and footprint

- [ ] `p2` - **ID**: `cpt-noter-dod-core-engine-capture-replay`

The system **MUST** play spans natively on `play` with positions reported and its own process excluded from the tap, and keep extra memory during a 60-minute replayed call within 4 GB (`call-memory-footprint`, reported on the Mac runner).

**Implements**:
- `cpt-noter-flow-core-engine-capture-replay`

**Touches**:
- Entities: `PlaybackState` (engine half)

## 6. Acceptance Criteria

- [ ] A golden-set call replayed through file mode produces confirmed segments within the lag budget, on the Mac runner.
- [ ] Killing the engine during a replayed capture yields one `engine_restart` gap of at most 2 s and the call goes on; making restarts fail yields `CaptureFailed`.
- [ ] Muting the system channel to exact zeros yields `system_audio_silent`; unplugging the microphone yields `device_changed` and a gap.
- [ ] Replay never appears in the recording (the tap excludes the engine and app PIDs).
- [ ] Engine tests pass on the macOS runner; `just gate` passes.
