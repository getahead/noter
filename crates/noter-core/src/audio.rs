//! FEATURE cpt-noter-feature-core-speakers-audio (slice 3): permanent audio deletion, by call or
//! by age. The transcript, outputs and evidence stay; one change row per call says it happened and
//! cannot be undone. Nightly retention (M5) calls the same path.

use std::collections::HashSet;

use noter_db::rusqlite::OptionalExtension;
use noter_db::Mutation;
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::CommandCtx;
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::json;

use crate::settings::invalid;
use crate::{internal, Core};

const DAY_MS: i64 = 86_400_000;
const MIB: u64 = 1_048_576;
/// The stored audio of a call: its AAC parts and the capture ring. Everything else in the call's
/// folder (transcript, constraints, item files) is text and stays.
const AUDIO_EXTENSIONS: [&str; 5] = ["aac", "caf", "wav", "pcm", "ring"];

impl Core {
    // @cpt-flow:cpt-noter-flow-core-speakers-audio-delete:p1
    // @cpt-dod:cpt-noter-dod-core-speakers-audio-deletion:p1
    pub(crate) fn delete_audio(
        &self,
        ctx: &CommandCtx,
        args: DeleteAudioArgs,
    ) -> Result<DeleteAudioResult, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-request
        self.ready()?;
        // @cpt-end:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-request
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-select
        let mut seen = HashSet::new();
        let ids: Vec<String> = args
            .call_ids
            .iter()
            .map(|id| id.as_str().to_string())
            .filter(|id| seen.insert(id.clone()))
            .collect();
        let picked = ids.clone();
        let found = self.store().read(move |c| {
            picked
                .iter()
                .map(|id| {
                    c.query_row(
                        "SELECT status IN ('recording', 'paused'),
                                audio_deleted = 0 AND audio_not_stored = 0
                         FROM calls WHERE id = ?1",
                        [id],
                        |r| Ok((r.get::<_, bool>(0)?, r.get::<_, bool>(1)?)),
                    )
                    .optional()
                })
                .collect::<Result<Vec<_>, _>>()
        })?;
        let mut targets = vec![];
        for (id, state) in ids.into_iter().zip(found) {
            match state {
                None => return Err(CoreError::new(ErrorCode::NotFound, "no such call")),
                Some((true, _)) => {
                    return Err(invalid("call_ids", ValidationRule::OutOfRange));
                }
                // @cpt-begin:cpt-noter-state-core-speakers-audio-availability:p1:inst-st-repeat
                // @cpt-begin:cpt-noter-state-core-speakers-audio-availability:p1:inst-st-not-stored
                // Already deleted or never stored: nothing to remove, nothing counted.
                Some((false, false)) => {}
                // @cpt-end:cpt-noter-state-core-speakers-audio-availability:p1:inst-st-not-stored
                // @cpt-end:cpt-noter-state-core-speakers-audio-availability:p1:inst-st-repeat
                Some((false, true)) => targets.push(id),
            }
        }
        // @cpt-end:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-select
        self.remove_audio(ctx, targets)
    }

    pub(crate) fn delete_audio_older(
        &self,
        ctx: &CommandCtx,
        args: DeleteOldAudioArgs,
    ) -> Result<DeleteAudioResult, CoreError> {
        self.ready()?;
        if args.older_than_days == 0 {
            return Err(invalid("older_than_days", ValidationRule::OutOfRange));
        }
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-select
        // A call that still captures keeps its audio whatever its age.
        let cutoff = self.deps.clock.now().0 - i64::from(args.older_than_days) * DAY_MS;
        let ids = self.store().read(move |c| {
            let mut stmt = c.prepare(
                "SELECT id FROM calls
                 WHERE started_at < ?1 AND audio_deleted = 0 AND audio_not_stored = 0
                   AND status NOT IN ('recording', 'paused')
                 ORDER BY started_at, id",
            )?;
            let rows = stmt.query_map([cutoff], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()
        })?;
        // @cpt-end:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-select
        self.remove_audio(ctx, ids)
    }

    /// The one deletion path. A call whose files cannot all be removed stays "kept" and the
    /// error is returned; calls before it are done, and a retry skips what is already gone.
    fn remove_audio(
        &self,
        ctx: &CommandCtx,
        ids: Vec<String>,
    ) -> Result<DeleteAudioResult, CoreError> {
        let (mut calls, mut bytes) = (0u32, 0u64);
        for id in ids {
            let call_id = CallId::new(id.clone());
            // @cpt-begin:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-lock
            self.stop_playback_of(&call_id);
            // @cpt-end:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-lock
            // @cpt-begin:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-files
            // @cpt-begin:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-failure
            bytes += self.remove_audio_files(&call_id)?;
            // @cpt-end:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-failure
            // @cpt-end:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-files
            // @cpt-begin:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-log
            // @cpt-begin:cpt-noter-state-core-speakers-audio-availability:p1:inst-st-delete
            let mut meta =
                self.change_meta(ctx, "Deleted the audio of a call".into(), "audio_delete");
            meta.undoable = false;
            self.store().write(
                Mutation {
                    entity_type: "call",
                    table: "calls",
                    id: id.clone(),
                    base_rev: None,
                    bump_rev: true,
                    values: vec![
                        ("audio_deleted", json!(true)),
                        ("audio_deleted_at", json!(self.deps.clock.now().0)),
                        ("audio_retention_until", json!(null)),
                    ],
                },
                meta,
            )?;
            // @cpt-end:cpt-noter-state-core-speakers-audio-availability:p1:inst-st-delete
            if let Some(call) = self.call_row(&id)? {
                self.emit_entity_changed(&EntityChanged::Call { call });
            }
            // @cpt-end:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-log
            calls += 1;
        }
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-return
        Ok(DeleteAudioResult {
            calls,
            freed_mb: ((bytes + MIB / 2) / MIB) as u32,
        })
        // @cpt-end:cpt-noter-flow-core-speakers-audio-delete:p1:inst-delete-return
    }

    /// Removes the audio files of one call and returns the bytes they held. A file already gone
    /// is skipped (a retry); any other failure stops with the typed error and counts nothing.
    fn remove_audio_files(&self, call_id: &CallId) -> Result<u64, CoreError> {
        let dir = self.call_dir(call_id);
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(internal(e)),
        };
        let mut audio = vec![];
        for entry in entries {
            let path = entry.map_err(internal)?.path();
            let is_audio = path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| AUDIO_EXTENSIONS.contains(&e));
            if is_audio {
                audio.push(path);
            }
        }
        audio.sort();
        let mut freed = 0;
        for path in audio {
            let len = std::fs::metadata(&path)
                .ok()
                .filter(|m| m.is_file())
                .map_or(0, |m| m.len());
            match std::fs::remove_file(&path) {
                Ok(()) => freed += len,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(internal(e)),
            }
        }
        Ok(freed)
    }
}
