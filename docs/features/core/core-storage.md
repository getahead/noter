---
title: "Feature: Storage and the change-log write path"
description: "noter-db: one SQLite file with one writer, a read pool, numbered migrations, revisions and the write API that commits every mutation together with its change-log row."
status: PROPOSED
version: "0.1"
date: "2026-10-18"
milestone: M0
lane: core
decomposition: docs/DECOMPOSITION-core.md
design: docs/DESIGN-core.md
---

# Feature: Storage and the change-log write path

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Open the database at start](#open-the-database-at-start)
  - [Write a record with its change row](#write-a-record-with-its-change-row)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Run migrations](#run-migrations)
  - [Commit a mutation with its change row](#commit-a-mutation-with-its-change-row)
  - [Read for a snapshot](#read-for-a-snapshot)
- [4. States (CDSL)](#4-states-cdsl)
  - [Store lifecycle](#store-lifecycle)
- [5. Definitions of Done](#5-definitions-of-done)
  - [One writer, one crate](#one-writer-one-crate)
  - [Migrations](#migrations)
  - [Every write has its change row](#every-write-has-its-change-row)
  - [Cold start measured](#cold-start-measured)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-noter-featstatus-core-storage`

- [ ] `p1` - `cpt-noter-feature-core-storage`

## 1. Feature Context

### 1.1 Overview

Crate `noter-db` opens `noter.db` under Application Support, owns the only read-write connection in a writer task, runs numbered migrations and gives every service one write API: the mutation and its `changes` row commit in one transaction. Read models use a small pool of read-only connections. Undo, redo and History are M2; backups, integrity repair and recovery are M5.

### 1.2 Purpose

Every later feature writes records. If each wrote its own way, "every write is a change-log row" and "one writer" would be promises, not properties. This feature makes them properties of the only write path there is.

**Requirements**: PRD › Data model and storage; PRD › Feature specification › 11. History and change log (the write half).

**Principles**: `cpt-noter-principle-core-single-writer`

**Delivers**: no IPC command of its own. It is the storage under every M0 and M1 command, and it delivers the M0 performance scenario `core-cold-start` (open the database, run migrations) together with `cpt-noter-feature-core-ipc-host`, and the M0 change-log test the harness plan names (docs/HARNESS.md › What comes next).

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| Core startup | Opens the database, runs migrations, checks integrity before anything is served |
| Core service (settings, session, transcript, …) | Writes records through the write API on behalf of the user, a job or a model run |
| Read model | Reads through the read pool, or through the writer connection under the stream hub lock for snapshots |

### 1.4 References

- **Decomposition**: [DECOMPOSITION-core.md](../../DECOMPOSITION-core.md), entry `cpt-noter-feature-core-storage`
- **Design**: [DESIGN-core.md](../../DESIGN-core.md): `cpt-noter-component-core-storage`, `cpt-noter-component-core-changelog`, `cpt-noter-db-core-library`, `cpt-noter-dbtable-changes`
- **PRD**: [PRD.md](../../PRD.md) › Data model and storage
- **Dependencies**: `cpt-noter-feature-core-contract`

## 2. Actor Flows (CDSL)

### Open the database at start

- [x] `p1` - **ID**: `cpt-noter-flow-core-storage-open`

**Actor**: Core startup

**Success Scenarios**:
- A fresh Mac: the file is created with mode 0600, every migration runs, the core answers.
- An existing file at an older schema: pending migrations run in order in one transaction each, then the core answers.

**Error Scenarios**:
- The quick check fails: nothing is written, commands answer `internal` and the failure is logged; automatic restore from a backup is `cpt-noter-feature-core-maintenance` (M5).
- A migration fails: its transaction rolls back, the database stays at the previous version, the core does not start writing.
- The file belongs to a newer app version (schema ahead of the binary): the core refuses to write rather than guess.

**Steps**:
1. [x] - `p1` - Resolve `~/Library/Application Support/Noter/noter.db`; create the folder with mode 0700 and the file with mode 0600 if missing - `inst-resolve-path`
2. [x] - `p1` - Open the read-write connection: WAL, busy timeout, foreign keys on, incremental auto-vacuum; load FTS5 and sqlite-vec - `inst-open-writer`
3. [x] - `p1` - DB: `PRAGMA quick_check` - `inst-quick-check`
4. [x] - `p1` - **IF** the check does not return ok - `inst-if-corrupt`
   1. [x] - `p1` - Log the result without any record text, mark the store failed, **RETURN** failed (no writes accepted) - `inst-return-corrupt`
5. [x] - `p1` - Run pending migrations using `cpt-noter-algo-core-storage-migrate` - `inst-run-migrations`
6. [x] - `p1` - Start the writer task with the read-write connection and open the read-only pool - `inst-start-writer`
7. [x] - `p1` - **RETURN** a ready store handle to the core's composition root - `inst-return-ready`

### Write a record with its change row

- [x] `p1` - **ID**: `cpt-noter-flow-core-storage-write`

**Actor**: Core service (on behalf of the user, a job or a model run)

**Success Scenarios**:
- A settings section, a call or a segment batch is written; the change row with actor, before, after and reason commits in the same transaction; the new `rev` is returned with the change id.

**Error Scenarios**:
- The caller sent a stale `rev`: nothing is written, the caller gets `conflict` with `detail.current_rev`.
- The transaction fails: nothing is written, no change row exists, the caller gets `internal`.

**Steps**:
1. [x] - `p1` - Service submits a mutation to the writer queue: entity, wanted state, base `rev` when the record is editable, actor, reason and optional batch id - `inst-submit`
2. [x] - `p1` - Writer runs `cpt-noter-algo-core-storage-change-tx` for the mutation - `inst-run-change-tx`
3. [x] - `p1` - **IF** the algorithm returned `conflict` - `inst-if-conflict`
   1. [x] - `p1` - **RETURN** `conflict` with `detail.current_rev` to the service - `inst-return-conflict`
4. [x] - `p1` - After commit, hand the changed entity ids to the caller so it can emit `entity:changed` or a whole-state event - `inst-after-commit`
5. [x] - `p1` - **RETURN** the stored record, its new `rev` and the change id (or batch id) - `inst-return-written`

## 3. Processes / Business Logic (CDSL)

### Run migrations

- [x] `p1` - **ID**: `cpt-noter-algo-core-storage-migrate`

**Input**: The open read-write connection and the embedded, numbered migrations of every crate that owns tables.

**Output**: The schema at the newest version, or an error with the database unchanged since the last good migration.

**Steps**:
1. [x] - `p1` - DB: read the applied migration list - `inst-read-applied`
2. [x] - `p1` - **IF** the database has a migration this binary does not know - `inst-if-ahead`
   1. [x] - `p1` - **RETURN** error schema-ahead (no writes) - `inst-return-ahead`
3. [x] - `p1` - **FOR EACH** pending migration in number order - `inst-for-pending`
   1. [x] - `p1` - **TRY** apply it and record it in one transaction - `inst-try-apply`
   2. [x] - `p1` - **CATCH** any failure: roll back, log the migration number, **RETURN** error - `inst-catch-apply`
4. [x] - `p1` - **RETURN** ok with the new schema version - `inst-return-migrated`

### Commit a mutation with its change row

- [x] `p1` - **ID**: `cpt-noter-algo-core-storage-change-tx`

**Input**: Entity type and id, wanted state, base `rev` (editable records), actor (`you`, `job:<id>`, `llm_run:<id>`), reason, summary, optional evidence ids, optional batch id, undoable flag.

**Output**: The new row and `rev`, and the change id; or `conflict`.

**Steps**:
1. [x] - `p1` - Begin an immediate transaction on the writer connection - `inst-begin`
2. [x] - `p1` - DB: SELECT the current row and its `rev` - `inst-select-current`
3. [x] - `p1` - **IF** a base `rev` was given and differs from the stored one - `inst-if-stale`
   1. [x] - `p1` - Roll back; **RETURN** `conflict` with the stored `rev` - `inst-return-stale`
4. [x] - `p1` - DB: write the row with `rev + 1` (or insert with `rev = 1`) - `inst-write-row`
5. [x] - `p1` - DB: INSERT `changes` (id `chg_` ULID, ts, actor, entity, field, before, after or delta for a batch, summary, reason, evidence ids, status `applied`, batch id, undoable) - `inst-insert-change`
6. [x] - `p1` - Commit; on failure roll back both writes and **RETURN** `internal` - `inst-commit`
7. [x] - `p1` - **RETURN** the row, its `rev` and the change id - `inst-return-tx`

### Read for a snapshot

- [x] `p2` - **ID**: `cpt-noter-algo-core-storage-snapshot-read`

**Input**: A read closure from a service, and whether the read is a stream snapshot.

**Output**: The read result, consistent with what has been published on streams.

**Steps**:
1. [x] - `p1` - **IF** the read is a stream snapshot - `inst-if-snapshot`
   1. [x] - `p1` - Run it on the writer connection between two writer jobs, while the caller holds the stream hub lock - `inst-read-writer`
2. [x] - `p1` - **ELSE** run it on a pooled read-only connection - `inst-read-pool`
3. [x] - `p1` - **RETURN** the result - `inst-return-read`

## 4. States (CDSL)

### Store lifecycle

- [x] `p1` - **ID**: `cpt-noter-state-core-storage-lifecycle`

**States**: closed, opening, migrating, ready, failed, shutting_down

**Initial State**: closed

**Transitions**:
1. [x] - `p1` - **FROM** closed **TO** opening **WHEN** the core starts - `inst-st-open`
2. [x] - `p1` - **FROM** opening **TO** migrating **WHEN** the quick check passed - `inst-st-migrate`
3. [x] - `p1` - **FROM** opening **TO** failed **WHEN** the quick check failed - `inst-st-corrupt`
4. [x] - `p1` - **FROM** migrating **TO** ready **WHEN** every pending migration applied - `inst-st-ready`
5. [x] - `p1` - **FROM** migrating **TO** failed **WHEN** a migration failed or the schema is ahead - `inst-st-migrate-fail`
6. [x] - `p1` - **FROM** ready **TO** shutting_down **WHEN** the core shuts down; the writer drains its queue and checkpoints - `inst-st-shutdown`
7. [x] - `p1` - **FROM** shutting_down **TO** closed **WHEN** the last connection closed - `inst-st-closed`

## 5. Definitions of Done

### One writer, one crate

- [x] `p1` - **ID**: `cpt-noter-dod-core-storage-single-writer`

The system **MUST** keep the only read-write SQLite connection in the `noter-db` writer task, open read-only connections for the pool, and keep every SQLite crate dependency inside `noter-db` (the architecture check fails otherwise).

**Implements**:
- `cpt-noter-flow-core-storage-open`
- `cpt-noter-algo-core-storage-snapshot-read`
- `cpt-noter-state-core-storage-lifecycle`

**Constraints**: `cpt-noter-constraint-core-local-data`

**Touches**:
- DB: `noter.db` (WAL), mode 0600
- Entities: store handle, writer queue

### Migrations

- [x] `p1` - **ID**: `cpt-noter-dod-core-storage-migrations`

The system **MUST** apply numbered migrations in order, each in its own transaction, refuse to write to a schema newer than the binary, and let each crate that owns tables add its migrations without touching others.

**Implements**:
- `cpt-noter-algo-core-storage-migrate`

**Touches**:
- DB: migration history table, `changes`

### Every write has its change row

- [ ] `p1` - **ID**: `cpt-noter-dod-core-storage-change-log`

The system **MUST** commit every mutation and its `changes` row in one transaction, with actor, before, after (or a delta for a batch), summary, reason and undoable flag, and **MUST** refuse a stale `rev` with `conflict` and `detail.current_rev`. A test writes through every write entry point of M0 and finds one change row per write; each later feature that adds a write entry point extends the same test.

**Implements**:
- `cpt-noter-flow-core-storage-write`
- `cpt-noter-algo-core-storage-change-tx`

**Touches**:
- DB: `changes`
- Entities: Change

### Cold start measured

- [ ] `p2` - **ID**: `cpt-noter-dod-core-storage-cold-start`

The system **MUST** have the `core_cold_start` scenario of `harness/perf.toml` (open the database, run migrations, answer `app_snapshot`) built and measured in CI, with `cpt-noter-feature-core-ipc-host` providing the snapshot half.

**Implements**:
- `cpt-noter-flow-core-storage-open`

**Touches**:
- API: `app_snapshot`

## 6. Acceptance Criteria

- [x] A fresh start creates `noter.db` with mode 0600 and the schema at the newest version; a second start runs no migration.
- [x] A failed migration leaves the database at the previous version and the core accepts no writes.
- [ ] Every write made through M0 commands produces exactly one `changes` row in the same transaction (each later feature extends the test with its own commands); a forced failure after the row write leaves neither.
- [x] A write with a stale `rev` returns `conflict` with `detail.current_rev` and changes nothing.
- [x] `just arch` passes: no crate other than `noter-db` depends on an SQLite crate.
- [x] `just gate` passes, with unit line coverage of `noter-db` at 80 % or more.
