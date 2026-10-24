---
title: "Feature: Capture session manager"
description: "The capture state machine every surface drives the same way: detection and the record prompt, start, pause, stop, notices and their timers, Continue Recording, resume after a quit or crash, the back-to-back split, the sensitive flag and when notifications go out."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M1
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Capture session manager

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Record a detected call](#record-a-detected-call)
  - [Start capture](#start-capture)
  - [Pause, resume and mark](#pause-resume-and-mark)
  - [Stop at call end](#stop-at-call-end)
  - [Stop, continue and discard](#stop-continue-and-discard)
  - [Answer notices during a call](#answer-notices-during-a-call)
  - [Resume after a quit, a crash or an engine failure](#resume-after-a-quit-a-crash-or-an-engine-failure)
  - [Make a call sensitive](#make-a-call-sensitive)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Start guard](#start-guard)
  - [Detection decision](#detection-decision)
  - [Notice timers](#notice-timers)
  - [Notification rule](#notification-rule)
  - [Capture degraded states and disk](#capture-degraded-states-and-disk)
- [4. States (CDSL)](#4-states-cdsl)
  - [Capture phase](#capture-phase)
- [5. Definitions of Done](#5-definitions-of-done)
  - [The capture machine](#the-capture-machine)
  - [Detection and the record prompt](#detection-and-the-record-prompt)
  - [Notices and their timers](#notices-and-their-timers)
  - [Recovery and degraded states](#recovery-and-degraded-states)
  - [Sensitive calls and notifications](#sensitive-calls-and-notifications)
  - [Same function from every surface](#same-function-from-every-surface)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p2` - **ID**: `cpt-noter-featstatus-core-capture-session`

- [ ] `p2` - `cpt-noter-feature-core-capture-session`

## 1. Feature Context

### 1.1 Overview

The session manager in `noter-core` owns `CaptureState` and `CallDetection` and every capture transition of DESIGN-core 3.1. It turns engine facts and calendar facts into notices with timers, creates the call row, drives the engine session through the supervisor, writes marks and gaps, publishes `capture:state`, `capture:detected` and the capture rows of `degraded:changed`, and decides when notifications go out (the native layer delivers them). Every surface (record prompt, call window, main window, menu bar, hotkeys) calls the same functions; native callers come in as `Caller::Native`.

> **M1 decisions (Backend Teamlead, 21 Oct 2026).** The native-surface calls the session needs (show or close the record prompt, notify, announce) go through a `Surfaces` trait on `CoreDeps`; the first slice defines it minimally and the harness supplies a scripted implementation that records the calls (TL-2). Timers (start-guard waits, notice timers, the 5-minute silence timer) use tokio time, and tests drive them with `tokio::time::pause()` and `advance`; `Clock` stays the source of timestamps (TL-4). Detection matches by bundle identifier against two constant lists in noter-core: meeting apps (Zoom, Microsoft Teams with its old and new ids, Webex, Slack, Discord, FaceTime) and browsers (Safari, Chrome, Chromium, Edge, Firefox, Arc, Brave, Opera, Vivaldi). A listed meeting app counts when it plays audio while the microphone is in use; a browser counts only when it both plays audio and holds the microphone itself; `Settings.ignored_apps` is subtracted from both lists. A browser outside the list is not detected in M1 (TL-5, D-24). Capture rows (segments, live speakers, gaps, marks) are written with `insert_batch` and no change row; deleting a call writes one non-undoable, content-free row (TL-1).

### 1.2 Purpose

Capture is the release-blocking function, and its rules must live in one machine that never stops or refuses a recording because something else failed or setup is unfinished (owner decision O1).

**Requirements**: PRD › Feature specification › 1. Capture; PRD › Success metrics › Capture (release blocker); PRD › Live copilot › Surfaces (notifications during calls).

**Principles**: `cpt-noter-principle-core-degrade`, `cpt-noter-principle-core-intent-commands`

**Delivers**:
- Frozen commands (M1): `capture_start`, `capture_stop`, `capture_set_paused`, `capture_mark_moment`, `capture_answer_call_end`, `capture_continue`, `capture_answer_new_meeting`, `capture_discard`, `capture_set_sensitive`, `capture_exclude_source`, `capture_dismiss_detection`, `capture_ignore_app`, `capture_hold_notice`, `capture_keep_recording`, `capture_keep_source`, `capture_resume_interrupted`.
- Events: `capture:state`, `capture:detected`, the capture rows of `degraded:changed`, the `RecordingInterruptedByQuit` banner on `banners:changed`.
- DESIGN.md stories (M1): `cpt-noter-seq-record-prompt-start-recording`, `cpt-noter-seq-record-prompt-record-after-missed-prompt`, `cpt-noter-seq-call-screen-recover-capture`, `cpt-noter-seq-call-screen-stop-at-call-end`, `cpt-noter-seq-menu-bar-control-recording` (the menu bar half is `cpt-noter-feature-core-native-surfaces`).
- DESIGN-core sequences: `cpt-noter-seq-core-record-detected-call`, and the stop half of `cpt-noter-seq-core-call-end-outputs` (the outputs half is M2).

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Primary user | Records, pauses, marks, stops, answers notices, from any surface |
| UI window (record prompt, call window, main) | Calls capture commands with its label |
| Native surface (menu bar, hotkey, notification) | Calls the same functions as `Caller::Native` |
| Engine supervisor | Delivers detection, audio-released, silence, second-source and session facts; `CaptureFailed` |
| Calendar (EventKit, read by the native layer) | Matches a detection to an event; signals the next meeting |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-capture-session`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-session`, 3.1 Capture transitions, `cpt-noter-seq-core-record-detected-call`, `cpt-noter-seq-core-call-end-outputs`, `cpt-noter-dbtable-calls`, `cpt-noter-dbtable-marks`, `cpt-noter-dbtable-gaps`
- **Dependencies**: `cpt-noter-feature-core-engine-capture`, `cpt-noter-feature-core-first-run`, `cpt-noter-feature-core-settings`

## 2. Actor Flows (CDSL)

### Record a detected call

- [x] `p1` - **ID**: `cpt-noter-flow-core-capture-session-record-detected`

**Actor**: Primary user (record prompt), after the engine reported a meeting app

**Success Scenarios**:
- A meeting app starts; the prompt shows for 15 s without taking focus, matched to the calendar event when there is one; **Record** starts capture, the call window opens on the call display without focus.
- The start hotkey answers the prompt the same way.

**Error Scenarios**:
- Below 500 MB free or without the live model: the prompt shows `blocked: disk_full` or `model_missing` with a dimmed **Record**; `capture_start` answers the same code.
- The prompt timed out before the click: `detection_expired`.
- The user chose **Not Now**, closed it, or let it time out: the prompt closes and is not shown again for this call, but the detection stays while the meeting app holds audio, so the menu bar and the start hotkey still offer **Call Detected · Start Recording** (`cpt-noter-seq-record-prompt-record-after-missed-prompt`).
- The user picked **Don't Ask for <app>…**: the detection goes away and the app is ignored from then on.

**Steps**:
1. [x] - `p1` - Supervisor delivers `call_detected { bundle_id, app_name, pid }` - `inst-detected-fact`
2. [x] - `p1` - Run `cpt-noter-algo-core-capture-session-detection` - `inst-run-detection`
3. [x] - `p1` - **IF** the rule says prompt - `inst-if-prompt`
   1. [x] - `p1` - Ask the native layer to show the record prompt (non-activating) and emit `capture:detected { detection, version }` with `prompt_until` = now + 15 s - `inst-show-prompt`
4. [x] - `p1` - API: `capture_start { source: record_prompt, detection_id, sensitive }` from the record prompt - `inst-start-from-prompt`
5. [x] - `p1` - **IF** the detection's `prompt_until` passed **RETURN** `detection_expired` - `inst-if-expired`
6. [x] - `p1` - Run `cpt-noter-flow-core-capture-session-start` - `inst-run-start`
7. [x] - `p1` - **IF** instead `capture_dismiss_detection` arrives (not now, close or timeout), close the prompt only: set the detection's `prompt_until` to now, never prompt again for this call, keep the detection until `call_audio_released` for its app, and emit `capture:detected` with the kept detection; a start from the menu bar or the start hotkey still succeeds - `inst-dismiss`
8. [x] - `p1` - **IF** `capture_ignore_app` arrives, clear the detection, add the app to the ignored apps and emit `capture:detected` with no detection - `inst-ignore`
9. [x] - `p1` - **IF** `call_audio_released` arrives for a detection that was never recorded, clear it and emit `capture:detected` with no detection - `inst-detection-ends`

### Start capture

- [x] `p1` - **ID**: `cpt-noter-flow-core-capture-session-start`

**Actor**: Primary user (record prompt, start hotkey, menu bar, Today, call window)

**Success Scenarios**:
- Capture starts from any source; `CaptureState { phase: recording }` comes back and every window gets `capture:state`.
- Started while the previous call is `stopped`: that call's Continue window closes and a new call starts.
- macOS has not asked for an audio permission yet: the first capture triggers the prompt and recording goes on.

**Error Scenarios**:
- A capture runs: `already_recording` (Today shows **Open Call Screen**).
- Below 500 MB free: `disk_full` with `detail.needed_mb`.
- The live model is not downloaded: `model_missing`.
- Never refused for setup state, audio permissions or the self-test (O1).

**Steps**:
1. [x] - `p1` - API: `capture_start { source, sensitive, detection_id?, calendar_event_id? }` - `inst-start-call`
2. [x] - `p1` - Run `cpt-noter-algo-core-capture-session-start-guard`; **RETURN** its error if any - `inst-start-guard`
3. [x] - `p1` - **IF** the phase is `stopped`, close that call's Continue window (it goes to `idle` for it) - `inst-close-continue`
4. [x] - `p1` - DB: INSERT `calls` (status `recording`, sensitive, title from the matched event or the app, `started_at`) through the change-log write path - `inst-insert-call`
5. [x] - `p1` - Phase `starting`; emit `capture:state` - `inst-phase-starting`
6. [x] - `p1` - Ask the supervisor to start the engine session (`cpt-noter-flow-core-engine-capture-session`) with audio storage from settings and the glossary - `inst-start-engine`
7. [x] - `p1` - On `session_started`, phase `recording`; ask the native layer to open the call window on the call display without focus - `inst-phase-recording`
8. [x] - `p1` - While the phase is `recording` or `paused`, subscribe to settings' glossary-changed hook and send `set_glossary` to the engine on each change, so a glossary edit reaches the live call (this meets the settings glossary DoD in M1); unsubscribe when the call stops - `inst-live-glossary`
9. [x] - `p1` - **RETURN** `CaptureState` with its `version` - `inst-return-started`

### Pause, resume and mark

- [x] `p1` - **ID**: `cpt-noter-flow-core-capture-session-pause-mark`

**Actor**: Primary user (call window, main window, menu bar, hotkey)

**Success Scenarios**:
- Pause stops both streams and records a `paused` gap; resume continues the same call; a mark records a moment at the current offset with an optional note.

**Error Scenarios**:
- Resume of a stopped call: `not_recording`.
- Pause while already paused (wanted state): the current state is returned, nothing changes.

**Steps**:
1. [x] - `p1` - API: `capture_set_paused { call_id, paused }` or `capture_mark_moment { call_id, note }` - `inst-pause-call`
2. [x] - `p1` - **IF** the call is not the live one or is stopped **RETURN** `not_recording` - `inst-if-not-live`
3. [x] - `p1` - **IF** `paused` is the current state, **RETURN** `CaptureState` unchanged - `inst-if-same`
4. [x] - `p1` - For pause: tell the engine `pause`, open a `paused` gap, phase `paused`; for resume: tell the engine `resume`, close the gap, phase `recording` - `inst-apply-pause`
5. [x] - `p1` - For a mark: DB: INSERT `marks { call_id, at_ms, note }`; publish a `mark` message on the transcript stream - `inst-insert-mark`
6. [x] - `p1` - **RETURN** `CaptureState` (or `MarkView` for a mark); emit `capture:state` - `inst-return-pause`

### Stop at call end

- [x] `p1` - **ID**: `cpt-noter-flow-core-capture-session-call-end`

**Actor**: Primary user (call window or record prompt), after the meeting app released the audio

**Success Scenarios**:
- 20 s after the meeting app let go of the audio and the microphone, the call-ended notice shows a 10 s countdown; it stops by itself, or the user stops now or keeps recording.
- While the pointer or focus is on the notice, the countdown is held (`stops_at: null`); on release it starts again at 10 s.
- While hidden for presenting, the notice is `CallSeemsEnded` and stops after 10 minutes.

**Error Scenarios**:
- The notice is gone when the answer arrives: `notice_expired`.

**Steps**:
1. [x] - `p1` - Supervisor delivers `call_audio_released` for the call's app - `inst-released-fact`
2. [x] - `p1` - Start the notice timer (`cpt-noter-algo-core-capture-session-notice-timers`): after 20 s set `CallEnded { stops_at: now + 10 s }` (or `CallSeemsEnded` with 10 minutes while hidden) - `inst-start-notice`
3. [x] - `p1` - API: `capture_hold_notice { held }` sets `stops_at` to null while held and to now + 10 s on release - `inst-hold`
4. [x] - `p1` - API: `capture_answer_call_end { choice }`: `keep_recording` clears the notice; `stop_now` runs `cpt-noter-flow-core-capture-session-stop` - `inst-answer`
5. [x] - `p1` - **IF** `stops_at` passes, run `cpt-noter-flow-core-capture-session-stop` - `inst-auto-stop`
6. [x] - `p1` - **RETURN** `CaptureState`; emit `capture:state` - `inst-return-call-end`

### Stop, continue and discard

- [x] `p1` - **ID**: `cpt-noter-flow-core-capture-session-stop`

**Actor**: Primary user (Stop, the countdown, the menu bar, a hotkey)

**Success Scenarios**:
- Stop ends the call at the last audio, phase `stopped`, `continue_until` = now + 5 minutes; the call is handed to the post-call queue (a no-op hand-off in M1, the `PostCall` job in M2).
- **Continue Recording** within 5 minutes appends to the same call with a `continued` gap and cancels the queued post-call work.
- **Discard Recording** after the nothing-heard notice ends capture with nothing kept.

**Error Scenarios**:
- Continue after `continue_until`: `continue_window_closed`.
- Discard without the nothing-heard notice: `notice_expired`.

**Steps**:
1. [x] - `p1` - API: `capture_stop { call_id }` (or the countdown, or a native caller) - `inst-stop-call`
2. [x] - `p1` - Phase `stopping`; tell the engine `stop`; on `session_stopped` store the file paths and `ended_at` - `inst-engine-stop`
3. [x] - `p1` - DB: UPDATE `calls` status `processing` through the change-log write path; end the transcript and levels streams with `call_stopped` - `inst-update-call`
4. [x] - `p1` - Phase `stopped`, `continue_until` = now + 5 minutes; hand the call to the post-call queue - `inst-phase-stopped`
5. [x] - `p1` - API: `capture_continue { call_id }` before `continue_until`: cancel the queued post-call work, start the engine session for the same call with a `continued` gap, phase `recording` - `inst-continue`
6. [x] - `p1` - API: `capture_discard { call_id }` while `NothingHeard` shows: stop the engine, delete the call's rows and files (logged, not undoable), end streams with `discarded`, phase `idle` - `inst-discard`
7. [x] - `p1` - **RETURN** `CaptureState`; emit `capture:state` - `inst-return-stop`

### Answer notices during a call

- [x] `p1` - **ID**: `cpt-noter-flow-core-capture-session-notices`

**Actor**: Primary user (call window or record prompt)

**Success Scenarios**:
- A new meeting is about to start (next calendar event, or the meeting app reports a new meeting): **Start as New Call** (the default, applied at 60 s) splits the call at `detected_at` and offers the saved call Continue for 5 minutes; **Keep in This Call** keeps one call.
- Nothing heard for 5 minutes: **Keep Recording** resets the timer; **Discard Recording** discards.
- A second audio source appears: **Keep** hides the banner for that app in this call; **Exclude** removes it from the tap.

**Error Scenarios**:
- An answer for a notice that has gone: `notice_expired`.

**Steps**:
1. [x] - `p1` - Notices are raised by `cpt-noter-algo-core-capture-session-notice-timers` and carried in `CaptureState.notice` - `inst-raise-notice`
2. [x] - `p1` - API: `capture_answer_new_meeting { choice }`: for `start_as_new_call` stop the current call at `detected_at` and start a new call from that offset; for `keep_in_this_call` clear the notice - `inst-new-meeting`
3. [x] - `p1` - API: `capture_keep_recording` resets the 5-minute nothing-heard timer - `inst-keep-recording`
4. [x] - `p1` - API: `capture_keep_source { bundle_id }` remembers the app for this call; `capture_exclude_source { bundle_id }` sends `exclude_process` to the engine - `inst-second-source`
5. [x] - `p1` - **RETURN** `CaptureState`; emit `capture:state` - `inst-return-notices`

### Resume after a quit, a crash or an engine failure

- [x] `p1` - **ID**: `cpt-noter-flow-core-capture-session-resume`

**Actor**: Primary user (main window banner, call window **Try Again**)

**Success Scenarios**:
- Noter quit or crashed during a recording: at the next start the `RecordingInterruptedByQuit` banner offers **Resume Recording**, which continues the same call with an `interrupted` gap.
- The engine could not be restarted (phase `failed`, "Not recording · engine stopped"): **Try Again** restarts it and continues the same call with an `engine_restart` gap.

**Error Scenarios**:
- The banner was dismissed or another capture started: `notice_expired`.
- The engine still cannot start: phase stays `failed`, `engine_unavailable`.

**Steps**:
1. [x] - `p1` - At core start, find calls left with status `recording` or `paused`; mark them interrupted and show the banner (`banners:changed`) - `inst-find-interrupted`
2. [x] - `p1` - API: `capture_resume_interrupted { call_id }` - `inst-resume-call`
3. [x] - `p1` - **IF** the call is interrupted and the banner still shows, start the engine session for the same call with an `interrupted` gap - `inst-resume-interrupted`
4. [x] - `p1` - **ELSE IF** the phase is `failed` for this call, restart the engine and resume with an `engine_restart` gap - `inst-try-again`
5. [x] - `p1` - **ELSE RETURN** `notice_expired` - `inst-else-expired`
6. [x] - `p1` - **RETURN** `CaptureState` with phase `recording` - `inst-return-resume`

### Make a call sensitive

- [x] `p2` - **ID**: `cpt-noter-flow-core-capture-session-sensitive`

**Actor**: Primary user (call window during capture; Call info afterwards)

**Success Scenarios**:
- **Make This Call Sensitive** marks the live call; nothing of it may go to a cloud runtime (enforced by the egress gate from M2); the copilot stays off for it without a local model (M4).
- After the call, Call info can turn it on or off.

**Error Scenarios**:
- Turning it off during capture: `invalid_input`.

**Steps**:
1. [x] - `p1` - API: `capture_set_sensitive { call_id, sensitive }` - `inst-sensitive-call`
2. [x] - `p1` - **IF** the call is live and `sensitive` is false **RETURN** `invalid_input` - `inst-if-off-live`
3. [x] - `p1` - DB: UPDATE `calls.sensitive` through the change-log write path - `inst-write-sensitive`
4. [x] - `p1` - **RETURN** `CaptureState`; emit `capture:state` and `entity:changed` for the call - `inst-return-sensitive`

## 3. Processes / Business Logic (CDSL)

### Start guard

- [x] `p1` - **ID**: `cpt-noter-algo-core-capture-session-start-guard`

**Input**: Current phase, free disk, live-model state.

**Output**: Ok, or `already_recording`, `disk_full` or `model_missing`.

**Steps**:
1. [x] - `p1` - **IF** the phase is `starting`, `recording`, `paused`, `stopping` or `failed` **RETURN** `already_recording` - `inst-guard-recording`
2. [x] - `p1` - **IF** free disk is below 500 MB **RETURN** `disk_full` with `detail.needed_mb` - `inst-guard-disk`
3. [x] - `p1` - **IF** the live model is not downloaded **RETURN** `model_missing` - `inst-guard-model`
4. [x] - `p1` - **RETURN** ok; setup state, permissions and the self-test are never read here - `inst-guard-ok`

### Detection decision

- [x] `p1` - **ID**: `cpt-noter-algo-core-capture-session-detection`

**Input**: A detection fact, settings, the self-test state, the ignored apps, the calendar, the phase.

**Output**: Prompt (with `blocked` when a start would be refused), or ignore.

**Steps**:
1. [x] - `p1` - **IF** detection is off (`offer_to_record` off or self-test not passed) or the app is ignored or a capture runs, **RETURN** ignore - `inst-detect-ignore`
2. [x] - `p1` - Match the detection to a calendar event that is running or starts within 10 minutes, if calendar access is granted - `inst-detect-match`
3. [x] - `p1` - Set `blocked` to `disk_full` or `model_missing` when the start guard would refuse - `inst-detect-blocked`
4. [x] - `p1` - **RETURN** prompt with `prompt_until` = now + 15 s - `inst-detect-prompt`

### Notice timers

- [x] `p1` - **ID**: `cpt-noter-algo-core-capture-session-notice-timers`

**Input**: Engine facts (`call_audio_released`, `silence`, `audio_source_added`), calendar facts, presenting state, an injected clock.

**Output**: `CaptureState.notice` changes and automatic actions at their deadlines.

**Steps**:
1. [x] - `p1` - Audio released for 20 s → `CallEnded { stops_at: now + 10 s }`; while hidden for presenting → `CallSeemsEnded { stops_at: now + 10 min }` - `inst-timer-call-end`
2. [x] - `p1` - While the notice is held, clear `stops_at`; on release set it to now plus 10 s - `inst-timer-hold`
3. [x] - `p1` - Silence for 5 minutes → `NothingHeard { since }`; **Keep Recording** restarts the 5 minutes - `inst-timer-nothing-heard`
4. [x] - `p1` - Next calendar event starting, or the meeting app reporting a new meeting → `NewMeeting { detected_at, expires_at: +60 s, default_choice: start_as_new_call }`; at `expires_at` apply the default - `inst-timer-new-meeting`
5. [x] - `p1` - A second source → the `SecondAudioSource` degraded state until kept or excluded - `inst-timer-second-source`
6. [x] - `p1` - `continue_until` passes or another capture starts → the stopped call leaves Continue, phase `idle` - `inst-timer-continue`
7. [x] - `p1` - **RETURN** the new state; each change emits `capture:state` - `inst-timer-return`

### Notification rule

- [x] `p1` - **ID**: `cpt-noter-algo-core-capture-session-notify`

**Input**: A notification request (NT-3 capture problem now; summary ready from M2), phase, presenting state, visible call surfaces, the call the frontmost main window reports (`window_report_view`).

**Output**: Send now, hold, or drop.

**Steps**:
1. [x] - `p1` - **IF** it is NT-3 (system audio silent, microphone off, capture failed) - `inst-if-nt3`
   1. [x] - `p1` - **IF** hidden for presenting, show it only on the menu bar icon; **ELSE IF** a call surface is visible, show it there; **ELSE** send now - `inst-nt3-route`
2. [x] - `p1` - **IF** a capture runs or Noter is hidden for presenting, hold it; release held notifications one per call after the call ends - `inst-hold-rule`
3. [x] - `p1` - **IF** the frontmost main window shows that call, drop it - `inst-drop-visible`
4. [x] - `p1` - **RETURN** the decision; delivery is the native layer's (`cpt-noter-feature-core-native-surfaces`) - `inst-notify-return`

### Capture degraded states and disk

- [x] `p1` - **ID**: `cpt-noter-algo-core-capture-session-degraded`

**Input**: Degraded states from the supervisor (`cpt-noter-algo-core-engine-capture-degraded`), free disk samples.

**Output**: The capture rows of `degraded:changed`, `CaptureState.audio_writing`, gap rows.

**Steps**:
1. [x] - `p1` - Publish engine-derived states for the live call (`MicrophoneOff`, `SystemAudioSilent`, `TranscriptionStalled`, `DeviceChanged`, `SecondAudioSource`, `CaptureFailed`) - `inst-publish-engine-states`
2. [x] - `p1` - Free disk under 2 GB → `DiskLow` (never a refusal); disk full → `DiskFull`, stop audio writing (`audio_writing: false`), keep the transcript - `inst-disk`
3. [x] - `p1` - DB: write a `gaps` row for every gap reason the engine or the session produces - `inst-write-gaps`
4. [x] - `p1` - **RETURN** the new `DegradedSet` with a new version - `inst-degraded-return`

## 4. States (CDSL)

### Capture phase

- [x] `p1` - **ID**: `cpt-noter-state-core-capture-session-phase`

**States**: idle, starting, recording, paused, stopping, stopped, failed

**Initial State**: idle

**Transitions**:
1. [x] - `p1` - **FROM** idle **TO** starting **WHEN** `capture_start` passes the start guard - `inst-st-start`
2. [x] - `p1` - **FROM** stopped **TO** starting **WHEN** `capture_start` passes the guard (the stopped call's Continue window closes) - `inst-st-start-from-stopped`
3. [x] - `p1` - **FROM** starting **TO** recording **WHEN** the engine session started - `inst-st-recording`
4. [x] - `p1` - **FROM** recording **TO** paused **WHEN** `capture_set_paused(true)` - `inst-st-pause`
5. [x] - `p1` - **FROM** paused **TO** recording **WHEN** `capture_set_paused(false)` - `inst-st-resume`
6. [x] - `p1` - **FROM** recording **TO** stopping **WHEN** `capture_stop`, Stop Now or the countdown (also from paused) - `inst-st-stopping`
7. [x] - `p1` - **FROM** stopping **TO** stopped **WHEN** the engine session stopped - `inst-st-stopped`
8. [x] - `p1` - **FROM** recording **TO** idle **WHEN** `capture_discard` after the nothing-heard notice (through stopping) - `inst-st-discard`
9. [x] - `p1` - **FROM** stopped **TO** recording **WHEN** `capture_continue` before `continue_until` - `inst-st-continue`
10. [x] - `p1` - **FROM** stopped **TO** idle **WHEN** `continue_until` passes or another capture starts - `inst-st-idle`
11. [x] - `p1` - **FROM** idle **TO** recording **WHEN** `capture_resume_interrupted` while the interrupted banner shows - `inst-st-resume-interrupted`
12. [x] - `p1` - **FROM** recording **TO** failed **WHEN** the engine cannot be restarted - `inst-st-failed`
13. [x] - `p1` - **FROM** failed **TO** recording **WHEN** **Try Again** (`capture_resume_interrupted`) restarts the engine - `inst-st-try-again`
14. [x] - `p1` - **FROM** failed **TO** stopped **WHEN** `capture_stop` (the call ends at the last audio) - `inst-st-failed-stop`
15. [x] - `p1` - **FROM** recording **TO** recording **WHEN** a new meeting is answered or expires (Start as New Call splits into a new call; Keep in This Call keeps one) - `inst-st-split`

## 5. Definitions of Done

### The capture machine

- [x] `p1` - **ID**: `cpt-noter-dod-core-capture-session-machine`

The system **MUST** implement every transition of DESIGN-core 3.1 Capture transitions with table-driven tests on an injected clock, refuse a start only with `already_recording`, `disk_full` or `model_missing`, and never stop or refuse a capture because another component failed or setup is unfinished.

**Implements**:
- `cpt-noter-flow-core-capture-session-start`
- `cpt-noter-flow-core-capture-session-pause-mark`
- `cpt-noter-flow-core-capture-session-stop`
- `cpt-noter-algo-core-capture-session-start-guard`
- `cpt-noter-state-core-capture-session-phase`

**Touches**:
- API: `capture_start`, `capture_stop`, `capture_set_paused`, `capture_mark_moment`, `capture_continue`, `capture_discard`, `capture:state`
- DB: `calls`, `marks`, `gaps`, `changes`
- Entities: `CaptureState`, `MarkView`

### Detection and the record prompt

- [x] `p1` - **ID**: `cpt-noter-dod-core-capture-session-detection`

The system **MUST** prompt only when detection is on, the app is not ignored and no capture runs; show the prompt for 15 s with its calendar match and `blocked` reason; and handle **Not Now**, close, timeout and **Don't Ask for <app>…**.

**Implements**:
- `cpt-noter-flow-core-capture-session-record-detected`
- `cpt-noter-algo-core-capture-session-detection`

**Touches**:
- API: `capture_dismiss_detection`, `capture_ignore_app`, `capture:detected`
- Entities: `CallDetection`, `DetectionChanged`

### Notices and their timers

- [x] `p1` - **ID**: `cpt-noter-dod-core-capture-session-notices`

The system **MUST** raise and resolve the call-ended (with hold), call-seems-ended, new-meeting (with the 60 s default split at `detected_at`), nothing-heard and second-source notices with the timers of DESIGN-core 3.2, answering stale answers with `notice_expired`.

**Implements**:
- `cpt-noter-flow-core-capture-session-call-end`
- `cpt-noter-flow-core-capture-session-notices`
- `cpt-noter-algo-core-capture-session-notice-timers`

**Touches**:
- API: `capture_answer_call_end`, `capture_hold_notice`, `capture_answer_new_meeting`, `capture_keep_recording`, `capture_keep_source`, `capture_exclude_source`

### Recovery and degraded states

- [x] `p1` - **ID**: `cpt-noter-dod-core-capture-session-recovery`

The system **MUST** offer **Resume Recording** after a quit or crash until the banner is dismissed or another capture starts, offer **Try Again** in phase `failed`, record every gap with its reason, publish the capture degraded states, and stop audio writing (not the transcript) when the disk fills.

**Implements**:
- `cpt-noter-flow-core-capture-session-resume`
- `cpt-noter-algo-core-capture-session-degraded`

**Touches**:
- API: `capture_resume_interrupted`, `banner_dismiss`, `degraded:changed`, `banners:changed`
- DB: `gaps`, `calls`

### Sensitive calls and notifications

- [ ] `p2` - **ID**: `cpt-noter-dod-core-capture-session-sensitive-notify`

The system **MUST** keep the sensitive flag on the call (refusing to turn it off during capture) and decide every notification by the hold rule of DESIGN-core 3.2: NT-3 at once unless hidden for presenting or a call surface is visible, everything else held while recording or hidden and released one per call afterwards, nothing for the call the frontmost main window shows.

**Implements**:
- `cpt-noter-flow-core-capture-session-sensitive`
- `cpt-noter-algo-core-capture-session-notify`

**Touches**:
- API: `capture_set_sensitive`, `window_report_view`
- DB: `calls`

### Same function from every surface

- [x] `p1` - **ID**: `cpt-noter-dod-core-capture-session-native-callers`

The system **MUST** expose start, pause, mark and stop to menu items and hotkeys as the same core functions, called as `Caller::Native { surface }`, taking effect within a second without a WebView round trip; a core test calls each as a native caller.

**Implements**:
- `cpt-noter-flow-core-capture-session-start`
- `cpt-noter-flow-core-capture-session-pause-mark`

**Touches**:
- API: `capture_start`, `capture_set_paused`, `capture_mark_moment`, `capture_stop`

## 6. Acceptance Criteria

- [ ] E2E against the real core with the scripted engine, story `cpt-noter-seq-record-prompt-start-recording`: a detection shows the prompt, `capture_start` from the record prompt starts recording, `capture:state` reaches every window.
- [ ] Story `cpt-noter-seq-record-prompt-record-after-missed-prompt`: after the prompt timed out or was dismissed (`capture_dismiss_detection` with reason timeout), the snapshot and `capture:detected` still carry the detection, no second prompt appears, and the start hotkey or **Call Detected · Start Recording** in the menu starts the call.
- [ ] Story `cpt-noter-seq-call-screen-recover-capture`: silent system audio, a microphone turned off and an engine restart each show their degraded state while the recording continues; a failed engine offers **Try Again**.
- [ ] Story `cpt-noter-seq-call-screen-stop-at-call-end`: audio released → notice with countdown; hold pauses it; Keep Recording, Stop Now and Start as New Call behave as specified; Continue Recording works for 5 minutes.
- [ ] Story `cpt-noter-seq-menu-bar-control-recording` (core half): mark, pause and stop called as `Caller::Native { surface: menu_bar }` take effect at once.
- [ ] `capture_start` is never refused with nothing set up except for a missing live model; `disk_full` carries `detail.needed_mb`.
- [ ] Every one of the 16 capture commands succeeds at least once in E2E runs against the real core.
- [ ] `just gate` passes.
