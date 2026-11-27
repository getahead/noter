//! The replacement path for an already installed archive.

use super::*;
use crate::internal;
use noter_db::{rusqlite::OptionalExtension, ChangeMeta, Logged};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

type Link = (String, [i64; 4]);

pub(super) struct Artifacts {
    dir: PathBuf,
    stem: String,
    constraints: String,
    committed: bool,
}

impl Artifacts {
    pub(super) fn new(dir: PathBuf, stem: &str) -> Self {
        Self {
            dir,
            stem: stem.to_owned(),
            constraints: format!("{stem}.constraints.json"),
            committed: false,
        }
    }

    pub(super) fn constraints(&self) -> &str {
        &self.constraints
    }
}

impl Drop for Artifacts {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(self.dir.join(&self.constraints));
        let _ = std::fs::remove_file(self.dir.join(format!("{}.json", self.stem)));
        if !self.committed {
            let _ = std::fs::remove_dir_all(self.dir.join(format!("{}.words", self.stem)));
        }
    }
}

fn conflict(message: &str) -> CoreError {
    CoreError::new(ErrorCode::Conflict, message)
}

pub(super) fn check_head(head: &Audio, rev: u32) -> Result<(), CoreError> {
    if head.absent {
        return Err(CoreError::new(
            ErrorCode::AudioDeleted,
            "the original audio is unavailable",
        ));
    }
    if head.archive_status != "done" || matches!(head.status.as_str(), "recording" | "paused") {
        return Err(CoreError::new(
            ErrorCode::JobBlocked,
            "the call has no completed archive to replace",
        ));
    }
    if head.rev != rev {
        return Err(
            conflict("the call changed").with_detail(ErrorDetail::Conflict {
                current_rev: Rev(head.rev),
            }),
        );
    }
    Ok(())
}

fn missing_call() -> CoreError {
    CoreError::new(ErrorCode::NotFound, "no such call")
}

fn has_audio(dir: &Path) -> bool {
    ["mic.m4a", "sys.m4a", "mic.wav", "sys.wav"]
        .iter()
        .any(|name| dir.join(name).is_file())
        || std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .any(|entry| {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                ["mic.", "sys."].iter().any(|prefix| {
                    name.strip_prefix(prefix)
                        .and_then(|rest| rest.strip_suffix(".aac"))
                        .is_some_and(|index| index.parse::<u32>().is_ok())
                })
            })
}

pub(super) fn links_of(c: &Connection, call: &CallId) -> noter_db::rusqlite::Result<Vec<Link>> {
    let mut stmt = c.prepare(
        "SELECT kind, a_t0_ms, a_t1_ms, b_t0_ms, b_t1_ms FROM speaker_constraints
         WHERE call_id = ?1 ORDER BY id",
    )?;
    let rows = stmt.query_map([call.as_str()], |r| {
        Ok((r.get(0)?, [r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?]))
    })?;
    rows.collect()
}

fn field<'a>(row: &'a Insert, key: &str) -> &'a str {
    row.values
        .iter()
        .find(|(k, _)| *k == key)
        .and_then(|(_, value)| value.as_str())
        .unwrap_or_default()
}

fn set(row: &mut Insert, key: &'static str, value: serde_json::Value) {
    if let Some((_, current)) = row.values.iter_mut().find(|(k, _)| *k == key) {
        *current = value;
    } else {
        row.values.push((key, value));
    }
}

fn intersection(seg: &EngineSegment, line: &LiveLine) -> i64 {
    let (t0, t1) = span(seg);
    if seg.channel == line.channel {
        overlap(t0, t1, line.t0, line.t1)
    } else {
        0
    }
}

/// A protected line can keep its ID only when both intervals predominantly describe the same speech.
fn edit_target(result: &ArchiveResult, line: &LiveLine) -> Result<usize, CoreError> {
    let mut targets = result.segments.iter().enumerate().filter(|(_, seg)| {
        let (t0, t1) = span(seg);
        let n = intersection(seg, line);
        n * 2 > (t1 - t0).max(line.t1 - line.t0)
    });
    match (targets.next(), targets.next()) {
        (Some((index, _)), None) => Ok(index),
        _ => Err(conflict("a manually corrected line has no unique match")),
    }
}

/// Keep the corrected text and ranges together so the existing term-fix undo remains valid.
fn corrected_text(line: &LiveLine, candidate: &str) -> Result<(), CoreError> {
    let mut raw: Vec<u16> = line.text.encode_utf16().collect();
    let mut end = raw.len();
    for correction in line.corrections.iter().rev() {
        let start = correction.range.start as usize;
        let stop = correction.range.end as usize;
        if start >= stop || stop > end || String::from_utf16(&raw[start..stop]).is_err() {
            return Err(conflict("a saved term correction has an invalid range"));
        }
        raw.splice(start..stop, correction.original.encode_utf16());
        end = start;
    }
    if candidate == line.text || String::from_utf16(&raw).is_ok_and(|raw| raw == candidate) {
        Ok(())
    } else {
        Err(conflict(
            "a corrected term cannot be located in the new text",
        ))
    }
}

fn check_links(result: &ArchiveResult, rows: &[Insert], links: &[Link]) -> Result<(), CoreError> {
    let split: HashSet<_> = links
        .iter()
        .filter(|(kind, _)| kind == "cannot_link")
        .flat_map(|(_, [a, b, c, d])| [(*a, *b), (*c, *d)])
        .collect();
    let ids = |t0, t1| -> HashSet<&str> {
        result
            .segments
            .iter()
            .zip(rows)
            .filter(|(seg, _)| {
                let (s0, s1) = span(seg);
                seg.channel == AudioChannel::Sys && overlap(t0, t1, s0, s1) > 0
            })
            .map(|(_, row)| field(row, "speaker_id"))
            .collect()
    };
    for (kind, [a, b, c, d]) in links {
        let apart = kind == "cannot_link";
        if !apart && (split.contains(&(*a, *b)) || split.contains(&(*c, *d))) {
            continue;
        }
        let left = ids(*a, *b);
        let right = ids(*c, *d);
        let satisfied = !left.is_empty()
            && !right.is_empty()
            && if apart {
                left.is_disjoint(&right)
            } else {
                left.len() == 1 && left == right
            };
        if !satisfied {
            return Err(conflict(
                "the new speakers do not satisfy a saved speaker constraint",
            ));
        }
    }
    Ok(())
}

fn preserve_speaker(row: &mut Insert, old: &LiveSpeaker) {
    let keep_live_name = field(row, "named_by") == "you" && old.named_by.as_deref() != Some("you");
    for (key, value) in [
        ("id", json!(old.id)),
        ("label", json!(old.label)),
        ("n", json!(old.n)),
        ("name", json!(old.name)),
        ("person_id", json!(old.person_id)),
        ("named_by", json!(old.named_by)),
    ] {
        if !keep_live_name || !matches!(key, "name" | "person_id" | "named_by") {
            set(row, key, value);
        }
    }
}

// @cpt-algo:cpt-noter-algo-core-speakers-audio-correct:p1
pub(super) fn replacement_rows(
    call: &CallId,
    result: &ArchiveResult,
    (live_speakers, live): (Vec<LiveSpeaker>, Vec<LiveLine>),
    (old_speakers, old): (Vec<LiveSpeaker>, Vec<LiveLine>),
    links: &[Link],
) -> Result<Vec<Insert>, CoreError> {
    let mut installed = install_rows(call, result, &live_speakers, &live);
    let mut segments = installed.split_off(installed.len() - result.segments.len());
    let mut votes_by_old = HashMap::<&str, HashMap<String, i64>>::new();
    let mut moved = HashMap::<usize, &str>::new();
    let mut edited = HashSet::new();
    for line in &old {
        let protected = line.moved || !line.corrections.is_empty();
        let stable = if protected {
            Some(edit_target(result, line)?)
        } else {
            let mut exact =
                result.segments.iter().enumerate().filter(|(_, seg)| {
                    seg.channel == line.channel && span(seg) == (line.t0, line.t1)
                });
            match (exact.next(), exact.next()) {
                (Some((index, _)), None) => Some(index),
                _ => None,
            }
        };
        if let Some(index) = stable {
            if protected && !edited.insert(index) {
                return Err(conflict("multiple saved edits match the same line"));
            }
            if protected || !edited.contains(&index) {
                set(&mut segments[index], "id", json!(line.id));
            }
            if !line.corrections.is_empty() {
                let row = &mut segments[index];
                if corrected_text(line, field(row, "text")).is_err() {
                    corrected_text(line, &result.segments[index].text)?;
                }
                set(row, "text", json!(line.text));
                set(row, "text_norm", json!(shadow(&line.text)));
                set(
                    row,
                    "corrections",
                    json!(serde_json::to_string(&line.corrections).map_err(internal)?),
                );
            }
            if line.moved {
                moved.insert(index, &line.speaker_id);
            }
        }
        if !line.moved {
            let votes = votes_by_old.entry(&line.speaker_id).or_default();
            for (seg, row) in result.segments.iter().zip(&segments) {
                let amount = intersection(seg, line);
                if amount > 0 {
                    *votes
                        .entry(field(row, "speaker_id").to_owned())
                        .or_default() += amount;
                }
            }
        }
    }

    // A live edit that never reached the archive is still an input to the replacement.
    for line in &live {
        if !line.corrections.is_empty() {
            let index = edit_target(result, line)?;
            if !edited.contains(&index) {
                let row = &mut segments[index];
                corrected_text(line, field(row, "text"))?;
                set(row, "text", json!(line.text));
                set(row, "text_norm", json!(shadow(&line.text)));
                set(
                    row,
                    "corrections",
                    json!(serde_json::to_string(&line.corrections).map_err(internal)?),
                );
            }
        }
    }

    let mut replacements = HashMap::new();
    let mut kept = HashSet::new();
    let mut old_speakers = old_speakers;
    old_speakers.sort_by_key(|s| s.named_by.as_deref() != Some("you"));
    for speaker in &old_speakers {
        let manual = speaker.named_by.as_deref() == Some("you");
        let Some(votes) = votes_by_old.get(speaker.id.as_str()) else {
            continue;
        };
        let mut ranked: Vec<_> = votes.iter().collect();
        ranked.sort_by_key(|(id, score)| (std::cmp::Reverse(**score), *id));
        let total: i64 = old
            .iter()
            .filter(|l| l.speaker_id == speaker.id && !l.moved)
            .map(|l| l.t1 - l.t0)
            .sum();
        let choice = ranked.first().filter(|(id, score)| {
            **score * 2 > total
                && !ranked.get(1).is_some_and(|(_, other)| *other >= *score)
                && !replacements.contains_key(id.as_str())
        });
        if let Some((id, _)) = choice {
            let row = installed
                .iter_mut()
                .find(|r| field(r, "id") == id.as_str())
                .ok_or_else(|| internal("archive speaker is missing"))?;
            replacements.insert(id.to_string(), speaker.id.clone());
            kept.insert(speaker.id.as_str());
            preserve_speaker(row, speaker);
        } else if manual || moved.values().any(|id| *id == speaker.id) {
            return Err(conflict(
                "a manually named or assigned speaker has no unique match",
            ));
        }
    }

    let mut protected_labels: HashSet<_> = installed
        .iter()
        .filter(|r| kept.contains(field(r, "id")))
        .map(|r| field(r, "label").to_owned())
        .collect();
    for speaker in &old_speakers {
        if !kept.contains(speaker.id.as_str())
            && (speaker.undo_ref
                || speaker.named_by.as_deref() == Some("you")
                || moved.values().any(|id| *id == speaker.id))
        {
            let mut row = Insert {
                table: "speakers",
                values: vec![
                    ("call_id", json!(call)),
                    ("pass", json!("archive")),
                    ("channel", json!(speaker.channel)),
                ],
            };
            preserve_speaker(&mut row, speaker);
            protected_labels.insert(speaker.label.clone());
            kept.insert(speaker.id.as_str());
            installed.push(row);
        }
    }
    let mut next_number = old_speakers
        .iter()
        .chain(&live_speakers)
        .filter_map(|s| s.n)
        .max()
        .unwrap_or(0);
    for row in &mut installed {
        if !kept.contains(field(row, "id")) {
            if protected_labels.contains(field(row, "label")) {
                let label = format!("archive:{}", field(row, "id"));
                set(row, "label", json!(label));
            }
            if field(row, "channel") == "sys" {
                next_number += 1;
                set(row, "n", json!(next_number));
            }
        }
    }
    for (index, row) in segments.iter_mut().enumerate() {
        if let Some(id) = moved.get(&index).copied().or_else(|| {
            replacements
                .get(field(row, "speaker_id"))
                .map(String::as_str)
        }) {
            set(row, "speaker_id", json!(id));
        }
        let mut ids: Vec<String> =
            serde_json::from_str(field(row, "crosstalk_with")).map_err(internal)?;
        for id in &mut ids {
            if let Some(replacement) = replacements.get(id) {
                *id = replacement.clone();
            }
        }
        set(
            row,
            "crosstalk_with",
            json!(serde_json::to_string(&ids).map_err(internal)?),
        );
    }
    check_links(result, &segments, links)?;
    installed.extend(segments);
    Ok(installed)
}

impl Core {
    // @cpt-flow:cpt-noter-flow-core-postcall-regenerate:p1
    pub(crate) fn queue_archive_rerun(
        &self,
        args: ArchiveRerunArgs,
    ) -> Result<JobAccepted, CoreError> {
        self.ready()?;
        let call = &args.call_id;
        let head = self
            .store()
            .read(|c| audio(c, call.as_str()))?
            .ok_or_else(missing_call)?;
        check_head(&head, args.expected_rev.0)?;
        if !has_audio(&self.call_dir(call)) {
            return Err(CoreError::new(
                ErrorCode::AudioDeleted,
                "the original audio is unavailable",
            ));
        }
        let job_run_id = self
            .in_runtime(|| self.jobs.rerun_archive(call, args.expected_rev.0))?
            .ok_or_else(|| CoreError::new(ErrorCode::JobBlocked, "archive passes are disabled"))?;
        Ok(JobAccepted { job_run_id })
    }

    // @cpt-dod:cpt-noter-dod-core-postcall-regeneration:p1
    pub(super) async fn replace_archive(
        &self,
        ctx: &mut RunCtx,
        call: &CallId,
        rev: u32,
        links: Vec<Link>,
        result: ArchiveResult,
        artifacts: &mut Artifacts,
    ) -> Result<(), Stop> {
        if &result.call_id != call
            || result
                .segments
                .iter()
                .any(|s| &s.call_id != call || s.t0_ms.0 >= s.t1_ms.0)
        {
            return Err(internal("the archive result contains an invalid segment").into());
        }
        let id = call.clone();
        let dir = self.call_dir(call);
        let run_id = ctx.run_id().clone();
        let meta = ctx
            .change_meta("Re-ran the archive pass")
            .ok_or(Stop::Cancelled)?;
        let (live, old) = self.store().read(|c| {
            let snapshot = c.unchecked_transaction()?;
            let live = live_of(&snapshot, call.as_str())?;
            let old = pass_of(&snapshot, call.as_str(), "archive")?;
            snapshot.commit()?;
            Ok((live, old))
        })?;
        if result.segments.is_empty() && (!live.1.is_empty() || !old.1.is_empty()) {
            return Err(internal("the archive heard none of the existing speech").into());
        }
        let rows = replacement_rows(&id, &result, live.clone(), old.clone(), &links)?;
        ctx.checkpoint().await?;
        let chunks = {
            let _audio = lock(&self.archive_audio_guard);
            self.store()
                .write_with(meta, move |tx| {
                    let head = audio(tx, id.as_str())
                        .map_err(internal)?
                        .ok_or_else(missing_call)?;
                    check_head(&head, rev)?;
                    if !has_audio(&dir) {
                        return Err(CoreError::new(
                            ErrorCode::AudioDeleted,
                            "the original audio is unavailable",
                        ));
                    }
                    if links_of(tx, &id).map_err(internal)? != links {
                        return Err(conflict(
                            "speaker constraints changed during the archive pass",
                        ));
                    }
                    if live_of(tx, id.as_str()).map_err(internal)? != live
                        || pass_of(tx, id.as_str(), "archive").map_err(internal)? != old
                    {
                        return Err(conflict(
                            "the transcript was edited during archive reconciliation",
                        ));
                    }
                    tx.execute(
                        "DELETE FROM segments WHERE call_id = ?1 AND pass = 'archive'",
                        [id.as_str()],
                    )
                    .map_err(internal)?;
                    tx.execute(
                        "DELETE FROM speakers WHERE call_id = ?1 AND pass = 'archive'",
                        [id.as_str()],
                    )
                    .map_err(internal)?;
                    for row in rows {
                        row.execute(tx)?;
                    }
                    tx.execute(
                        "UPDATE calls SET rev = rev + 1, archive_file_pending = 1 WHERE id = ?1",
                        [id.as_str()],
                    )
                    .map_err(internal)?;
                    let chunks = crate::chunks::current_chunks(tx, &id).map_err(internal)?;
                    crate::chunks::replace_chunks(tx, &id, &chunks, &[]).map_err(internal)?;
                    tx.execute(
                        "UPDATE job_runs SET archive_rerun_committed = 1 WHERE id = ?1",
                        [run_id.as_str()],
                    )
                    .map_err(internal)?;
                    Ok((
                        chunks,
                        vec![Logged {
                            entity_type: "call",
                            entity_id: id.0,
                            field: Some("archive_revision".into()),
                            before: Some(rev.to_string()),
                            after: Some((rev + 1).to_string()),
                            delta: None,
                        }],
                    ))
                })?
                .value
        };
        artifacts.committed = true;

        self.publish_call_row(call);
        if let Ok(speakers) = self
            .store()
            .read(|c| crate::transcript::speaker_views(c, call))
        {
            self.emit_entity_changed(&EntityChanged::Speakers {
                call_id: call.clone(),
                speakers,
            });
        }
        if let Err(e) = self.publish_archive_file(call) {
            self.log(object(json!({"level":"error", "module":"postcall", "code":"transcript_file", "message_len":e.message.len()})));
        }
        self.embed_archive_replacement(ctx, call, rev + 1, chunks)
            .await;
        Ok(())
    }

    fn publish_archive_file(&self, call: &CallId) -> Result<(), CoreError> {
        let _audio = lock(&self.archive_audio_guard);
        let call = call.clone();
        let dir = self.call_dir(&call);
        let meta = ChangeMeta {
            actor: Actor::Job {
                job_id: JobId::new("job_archive_pass"),
                name: "Archive pass".into(),
            },
            summary: "Published the archive transcript file".into(),
            reason: "archive_transcript_file".into(),
            evidence_ids: vec![],
            batch_id: None,
            undoable: false,
            surface: None,
        };
        let done = self.store().write_with(meta, move |tx| {
            let pending: bool = tx
                .query_row(
                    "SELECT archive_file_pending FROM calls WHERE id = ?1",
                    [call.as_str()],
                    |r| r.get(0),
                )
                .optional()
                .map_err(internal)?
                .unwrap_or(false);
            if !pending {
                return Err(missing_call());
            }
            let segments = crate::transcript::segments_of(tx, &call, None).map_err(internal)?;
            crate::transcript::write_transcript_snapshot(&segments, &dir)?;
            tx.execute(
                "UPDATE calls SET archive_file_pending = 0 WHERE id = ?1",
                [call.as_str()],
            )
            .map_err(internal)?;
            Ok((
                (),
                vec![Logged {
                    entity_type: "call",
                    entity_id: call.0,
                    field: Some("archive_file_pending".into()),
                    before: None,
                    after: None,
                    delta: None,
                }],
            ))
        });
        match done {
            Err(e) if e.code == ErrorCode::NotFound => Ok(()),
            result => result.map(|_| ()),
        }
    }

    pub(crate) fn recover_archive_files(&self) -> Result<(), CoreError> {
        let pending: Vec<CallId> = self.store().read(|c| {
            let mut stmt = c.prepare("SELECT id FROM calls WHERE archive_file_pending = 1")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0).map(CallId::new))?;
            rows.collect()
        })?;
        for call in pending {
            if let Err(e) = self.publish_archive_file(&call) {
                self.log(object(json!({"level":"error", "module":"postcall", "code":"transcript_file", "message_len":e.message.len()})));
            }
        }
        Ok(())
    }

    async fn embed_archive_replacement(
        &self,
        ctx: &mut RunCtx,
        call: &CallId,
        rev: u32,
        chunks: Vec<crate::chunks::Chunk>,
    ) {
        let Ok(vectors) = self.embed(call, &chunks).await else {
            return;
        };
        let Some(meta) = ctx.change_meta("Indexed the new archive") else {
            return;
        };
        let id = call.clone();
        let outcome = self.store().write_with(meta, move |tx| {
            let head = audio(tx, id.as_str())
                .map_err(internal)?
                .ok_or_else(missing_call)?;
            if head.rev != rev
                || crate::chunks::current_chunks(tx, &id).map_err(internal)? != chunks
            {
                return Err(conflict("the transcript changed while embedding"));
            }
            crate::chunks::replace_chunks(tx, &id, &chunks, &vectors).map_err(internal)?;
            Ok((
                (),
                vec![Logged {
                    entity_type: "call",
                    entity_id: id.0,
                    field: Some("chunks".into()),
                    before: None,
                    after: Some(chunks.len().to_string()),
                    delta: None,
                }],
            ))
        });
        if let Err(e) = outcome {
            self.log(object(json!({"level":"warn", "module":"postcall", "code":"archive_embeddings", "error":e.code})));
        }
    }
}
