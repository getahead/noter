---
title: "Feature: Engine offline pass and embeddings"
description: "Large v3 and constrained VBx archive processing, speaker embeddings and local text embeddings over engine stdio."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M2
lane: engine
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Engine offline pass and embeddings

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Run an archive pass](#run-an-archive-pass)
  - [Request speaker or text embeddings](#request-speaker-or-text-embeddings)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Decode and cluster with corrections](#decode-and-cluster-with-corrections)
  - [Produce local vectors](#produce-local-vectors)
- [4. States (CDSL)](#4-states-cdsl)
  - [Offline request](#offline-request)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Constrained archive results](#constrained-archive-results)
  - [Embedding requests](#embedding-requests)
  - [Tests and gate](#tests-and-gate)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p3` - **ID**: `cpt-noter-featstatus-core-engine-offline`

- [ ] `p3` - `cpt-noter-feature-core-engine-offline`

## 1. Feature Context

### 1.1 Overview

The Swift engine and Rust supervisor gain the offline Large v3 pass with VBx clustering, 256-dimensional speaker embeddings and 1024-dimensional bge-m3 text embeddings. Large results travel by file inside the App Group container. The engine returns facts and files; installing archive results, identifying people and querying vectors belong to their consuming features.

> **M2 decisions (Backend Teamlead, 1 Nov 2026).** The constraints file is `OfflineConstraints` (`contracts/engine.schema.json#offline_constraints`): `{languages, glossary, speaker_priors, must_link: [{a: {t0_ms, t1_ms}, b: {...}}], cannot_link, speaker_names: {live_label: name}}`, every key required, spans in call milliseconds on the system channel; 2.13 writes it (TL-16). Large v3 runs on WhisperKit, which has no beam search, so the decode is greedy with a temperature fallback over the top five tokens, not beam 5; a voice with under 3 s of speech gets the label `''` (TL-16). Clustering follows the owner's D-32 answer (1 Nov): pinned pyannote community-1 segmentation and WeSpeaker CoreML models with VBx in the engine, no FluidAudio binary (licences: `.plans/backend/m2-diarization-licences.md`); the golden set is the owner's item (TL-17). Crosstalk: the engine only reports overlap; `segments.crosstalk_with` storage and both transcript readers land with the archive install in 2.17 and are cross-referenced from the crosstalk acceptance criterion below (TL-21, D-40).

### 1.2 Purpose

The live transcript can improve after the call without losing the user's speaker corrections. Embeddings stay on the Mac and use the same engine protocol as capture.

**Requirements**: PRD › Transcription pipeline; PRD › Diarization and speaker identity; PRD › LLM orchestration › Routing policy (embeddings).

**Principles**: No additional principle assigned in the decomposition; the offline engine boundary applies throughout.

**Delivers**:
- Frozen IPC commands (M2): none.
- DESIGN.md stories (M2): none owned here; supplies the archive and embedding work for post-call outputs.
- Engine commands: `offline_pass`, `speaker_embedding`, `embed_texts`; events `offline_progress`, `offline_done`, `offline_failed`, `speaker_embedding_done`, `embeddings`.

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Rust engine supervisor | Correlates requests, validates paths and consumes result events |
| Post-call scheduler | Starts the archive pass only outside live capture |
| Swift engine | Runs ASR, diarization and embedding models locally |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-engine-offline`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-engine`, `cpt-noter-component-core-engine-supervisor`, `cpt-noter-interface-engine-stdio`, 3.1 transcript relationships
- **PRD**: [PRD.md](../../PRD.md) › Transcription pipeline › Offline pass; Diarization and speaker identity
- **Contract**: `crates/noter-protocol/src/engine.rs`; `contracts/engine.schema.json`
- **Dependencies**: `cpt-noter-feature-core-engine-capture`

## 2. Actor Flows (CDSL)

### Run an archive pass

- [x] `p1` - **ID**: `cpt-noter-flow-core-engine-offline-archive`

**Actor**: Engine supervisor, for the archive job

**Success Scenarios**:
- A stopped call with stored audio is processed with user constraints; progress arrives and the finished result file is returned once complete.

**Error Scenarios**:
- Missing audio or model, malformed constraints, failed decode or disk failure returns the protocol's correlated error or `offline_failed`; the live transcript remains usable.

**Steps**:
1. [x] - `p1` - Supervisor verifies the scheduler permits archive work and sends `offline_pass { call_id, session_dir, result_path, constraints_path, backend }` - `inst-archive-request`
2. [x] - `p1` - Engine validates container-relative input and output paths and constraints before opening files; reject traversal or paths outside the App Group - `inst-archive-paths`
3. [x] - `p1` - Acknowledge the command id, then run `cpt-noter-algo-core-engine-offline-decode` at low priority with the requested archive backend - `inst-archive-start`
4. [x] - `p1` - Emit `offline_progress { call_id, progress }` as work advances; capture work takes priority if it starts - `inst-archive-progress`
5. [x] - `p1` - Write the completed archive result and referenced word timings before emitting `offline_done { call_id, result_path }` - `inst-archive-complete`
6. [x] - `p1` - **IF** asynchronous processing fails, emit `offline_failed { call_id, code }`; never report an incomplete file as done - `inst-archive-fail`
7. [x] - `p1` - Supervisor correlates the result with the current call job, discards stale completions from cancelled or superseded work and returns it to the pipeline - `inst-archive-correlate`
8. [x] - `p1` - **RETURN** the result path or failure; no database writes occur in the engine - `inst-archive-return`

### Request speaker or text embeddings

- [x] `p1` - **ID**: `cpt-noter-flow-core-engine-offline-embeddings`

**Actor**: Engine supervisor, for a core service

**Success Scenarios**:
- Speaker spans produce a WeSpeaker file; one text query returns an inline bge-m3 vector; a text batch returns a file and its count in input order.

**Error Scenarios**:
- Unknown call, invalid spans or paths, unavailable model and engine exit complete the pending request with an error rather than waiting forever.

**Steps**:
1. [x] - `p1` - Send `speaker_embedding { request_id, call_id, channel, spans, out_path }` or `embed_texts { request_id, texts, out_path }` with a unique request id - `inst-embed-request`
2. [x] - `p1` - Validate span bounds and file paths; acknowledge the command or return a correlated `error` - `inst-embed-validate`
3. [x] - `p1` - Run `cpt-noter-algo-core-engine-offline-vectors` and finish every output file before announcing it - `inst-embed-run`
4. [x] - `p1` - Emit `speaker_embedding_done` with the output path or `embeddings` with inline data or a batch path and count, preserving `request_id` - `inst-embed-event`
5. [x] - `p1` - Supervisor validates vector dimensions, finite values and count, then resolves the pending request; process exit or an error rejects it - `inst-embed-resolve`
6. [x] - `p1` - Release scratch files after consumption; the core encrypts retained speaker embeddings, and this feature never enrolls a person - `inst-embed-clean`
7. [x] - `p1` - **RETURN** the vectors to the caller - `inst-embed-return`

## 3. Processes / Business Logic (CDSL)

### Decode and cluster with corrections

- [x] `p1` - **ID**: `cpt-noter-algo-core-engine-offline-decode`

**Input**: Stopped-call mic and system audio, timeline, glossary and persisted must-link and cannot-link constraints.

**Output**: Archive segments with channels, times, words, language, confidence, correction metadata and final cluster labels.

**Steps**:
1. [x] - `p1` - Read both stored channels against the timeline, keeping pauses and gaps in call-relative time - `inst-decode-timeline`
2. [x] - `p1` - Split speech with VAD and identify language per utterance using the configured languages and speaker priors - `inst-decode-language`
3. [x] - `p1` - Run full Large v3 with beam size 5 and temperature fallback, then apply glossary and hallucination filters - `inst-decode-asr`
4. [x] - `p1` - Re-decode low-probability mixed-language utterances with the alternative language and keep the better-scoring result - `inst-decode-alternative`
5. [x] - `p1` - Run offline pyannote segmentation, WeSpeaker embeddings and VBx across the system channel, enforcing must-link and cannot-link time-span constraints from user corrections - `inst-decode-cluster`
6. [x] - `p1` - Mark overlapping spans with both candidate labels and low ASR confidence; leave voices with under three seconds of speech unnamed - `inst-decode-overlap`
7. [x] - `p1` - Preserve the microphone channel's user or guest attribution and the two-channel split; do not infer cross-call person identity here - `inst-decode-channel`
8. [x] - `p1` - **RETURN** the complete result; the core maps archive clusters to live labels by time overlap and applies corrections when installing it - `inst-decode-return`

> **Clustering (D-32 option 2, 1 Nov 2026).** As pyannote community-1 runs it: segmentation finds each 10 s window's speakers on the system channel, WeSpeaker embeds each over the window with the frames they speak alone, VBx (agglomerative start 0.6, PLDA, Fa 0.07, Fb 0.8) learns the voices from speakers with 2 s of such speech, and each speaker joins its closest voice that no cannot-link forbids (two speakers of one window are two people). Must-links and shared names then join voices unless a cannot-link stands between them; a voice with under three seconds of speech gets the empty label. Without the segmentation model (a bundle installed before it was pinned) the system channel keeps its live label (`spk_1`). Large v3 runs on WhisperKit, which has no beam search: a failed greedy decode falls back through temperatures sampling the top five tokens.

### Produce local vectors

- [x] `p1` - **ID**: `cpt-noter-algo-core-engine-offline-vectors`

**Input**: Audio spans for one speaker request, or an ordered list of texts with an optional output path.

**Output**: 256-dimensional WeSpeaker embedding or 1024-dimensional bge-m3 rows.

**Steps**:
1. [x] - `p1` - **IF** the request is for a speaker, load only the requested channel and spans and extract the WeSpeaker vector - `inst-vector-speaker`
2. [x] - `p1` - **ELSE** embed each text locally with bge-m3, preserving input order; an empty list produces zero rows - `inst-vector-text`
3. [x] - `p1` - Validate dimensions and finite numbers before writing or returning any vector - `inst-vector-check`
4. [x] - `p1` - Use an inline vector for a single query without `out_path`; write batches as float32 little-endian rows at the requested path - `inst-vector-file`
5. [x] - `p1` - **RETURN** vector or path and count; never access the network or the database - `inst-vector-return`

## 4. States (CDSL)

### Offline request

- [x] `p1` - **ID**: `cpt-noter-state-core-engine-offline-request`

**States**: pending, running, complete, failed, abandoned

**Initial State**: pending when the supervisor registers the request

**Transitions**:
1. [x] - `p1` - **FROM** pending **TO** running **WHEN** the engine acknowledges a valid request - `inst-st-running`
2. [x] - `p1` - **FROM** pending **TO** failed **WHEN** validation or model loading is refused - `inst-st-refused`
3. [x] - `p1` - **FROM** running **TO** complete **WHEN** the matching result file or inline vector is complete and validated - `inst-st-complete`
4. [x] - `p1` - **FROM** running **TO** failed **WHEN** offline failure, a correlated error or engine exit arrives - `inst-st-failed`
5. [x] - `p1` - **FROM** pending **TO** abandoned **WHEN** the caller cancels before completion; the same applies while running - `inst-st-abandoned`

Abandoning a request invalidates its completion at the supervisor; it adds no engine cancel command. Scheduler pause and restart use the existing protocol and job checkpoint boundaries, preserving capture-first restart. Pending requests are process-local; the job record owns durable retries.

## 5. Definitions of Done

### Constrained archive results

- [x] `p1` - **ID**: `cpt-noter-dod-core-engine-offline-archive`

The system **MUST** implement the offline pass through the existing stdio protocol, decode both channels with full Large v3 and constrained VBx, preserve timing and gaps, and publish progress and complete result files without replacing the core's live rows itself.

**Implements**:
- `cpt-noter-flow-core-engine-offline-archive`
- `cpt-noter-algo-core-engine-offline-decode`
- `cpt-noter-state-core-engine-offline-request`

**Constraints**: `cpt-noter-constraint-core-engine-offline`

**Touches**:
- API: `offline_pass`, `offline_progress`, `offline_done`, `offline_failed`
- Entities: `EngineSegment`, archive result files and correction constraints

### Embedding requests

- [x] `p1` - **ID**: `cpt-noter-dod-core-engine-offline-embeddings`

The system **MUST** correlate speaker and text embeddings, validate their dimensions and counts, reject unsafe paths, use files for bulk results and keep extraction local. The core encrypts speaker embeddings before retaining them; person matching is M3.

**Implements**:
- `cpt-noter-flow-core-engine-offline-embeddings`
- `cpt-noter-algo-core-engine-offline-vectors`

**Constraints**: `cpt-noter-constraint-core-engine-offline`

**Touches**:
- API: `speaker_embedding`, `embed_texts`, `speaker_embedding_done`, `embeddings`
- Entities: container-relative scratch files, vectors

### Tests and gate

- [x] `p1` - **ID**: `cpt-noter-dod-core-engine-offline-tests`

The system **MUST** pass Swift unit and file-mode golden-call tests, Rust supervisor tests for correlation, unsafe paths, malformed vectors, engine exit and late completions, and engine-schema conformance tests. Real-core post-call E2E covers consumption; this feature owns no IPC command or story denominator. `just gate` passes.

**Implements**:
- `cpt-noter-flow-core-engine-offline-archive`
- `cpt-noter-flow-core-engine-offline-embeddings`

**Touches**:
- API: `cpt-noter-interface-engine-stdio`

Open: the file-mode golden-call tests in English, Russian and German need `evals/golden`, and the archive quality run on the Mac runner needs the DER threshold the owner picks from #279's three options (absolute per language, relative to pyannote's pipeline, or product-facing); both are the owner's items (TL-17). The Swift unit tests (`engine/Tests/NoterEngineKitTests`: `OfflineTests`, `ArchiveTests`, `DiarizationTests`, `VectorTests`) drive the archive, VBx clustering and vector code on synthetic calls with scripted models, and `RoundTripTests` checks the engine schema against `contracts/fixtures/engine-lines.json`; the Rust supervisor tests are `crates/noter-engine-client/tests/offline.rs`.

## 6. Acceptance Criteria

- [ ] File-mode golden calls in English, Russian and German produce a complete archive with word timings, channel separation, crosstalk and enforced user constraints.
- [x] Speaker vectors have 256 finite dimensions; text vectors have 1024; batch order and count match the request, including an empty batch.
- [x] Unsafe paths and missing audio or models fail through the existing protocol without publishing partial files.
- [x] Engine exit and abandoned requests do not leave unresolved callers or install stale results; capture still restarts before archive work.
- [ ] Engine-schema conformance and the consuming post-call story E2E pass; archive quality is measured on the golden set on the Mac runner.
- [x] `just gate` passes.

> **Open (TL-17).** The first and fifth criteria are measured on `evals/golden` on the Mac runner, the owner's item (diarization DER thresholds proposed to the owner, none set); the conformance half of the fifth is in.
