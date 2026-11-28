use std::path::Path;

use noter_db::{apply_mutation, rusqlite::params};
use noter_protocol::engine::EngineWord;

use super::*;

pub(crate) const REASON: &str = "segment_split";

/// Interior token starts, in byte offsets. ASR tokens are separated by whitespace.
fn boundaries(text: &str) -> impl Iterator<Item = usize> + '_ {
    let mut space = true;
    text.char_indices()
        .filter_map(move |(i, ch)| {
            let start = space && !ch.is_whitespace();
            space = ch.is_whitespace();
            start.then_some(i)
        })
        .skip(1)
}

/// Keep the same timings file when a line splits. Its time window identifies the words each part owns.
pub(crate) fn word_starts(
    dir: &Path,
    path: Option<&str>,
    text: &str,
    start: OffsetMs,
    end: OffsetMs,
) -> Option<BTreeMap<u32, OffsetMs>> {
    let root = dir.parent()?.parent()?;
    let path = root.join(path?).canonicalize().ok()?;
    if !path.starts_with(dir.canonicalize().ok()?) || !path.is_file() {
        return None;
    }
    let body = std::fs::read(path).ok()?;
    let words: Vec<EngineWord> = serde_json::from_slice(&body).ok()?;
    let words: Vec<_> = words
        .iter()
        .filter(|w| w.t0_ms.0 >= start.0 && w.t0_ms.0 < end.0)
        .collect();
    let starts: Vec<_> = boundaries(text).collect();
    if words.len() != starts.len() + 1 {
        return None;
    }
    Some(
        starts
            .into_iter()
            .zip(words.into_iter().skip(1))
            .filter(|(_, w)| w.t0_ms.0 > start.0)
            .map(|(at, w)| (units(&text[..at]), w.t0_ms))
            .collect(),
    )
}

fn stale_line() -> CoreError {
    CoreError::new(ErrorCode::Conflict, "the transcript line changed")
}

fn part(
    id: &SegmentId,
    text: &str,
    corrections: Vec<TermCorrection>,
    edge: (&'static str, OffsetMs),
    mut values: Vec<(&'static str, serde_json::Value)>,
) -> Result<Mutation, CoreError> {
    values.extend([
        (edge.0, json!(edge.1)),
        ("text", json!(text)),
        ("text_norm", json!(crate::transcript::shadow(text))),
        (
            "corrections",
            json!(serde_json::to_string(&corrections).map_err(internal)?),
        ),
    ]);
    Ok(Mutation {
        entity_type: "segment",
        table: "segments",
        id: id.as_str().to_string(),
        base_rev: None,
        bump_rev: false,
        values,
    })
}

fn right_speaker(
    c: &Connection,
    speaker: SplitSpeaker,
    line: &SegmentView,
    pass: &str,
    channel: &str,
    second: &SegmentId,
    changes: &mut Vec<Mutation>,
) -> Result<(String, Option<String>), CoreError> {
    let call = line.call_id.as_str();
    let person = match speaker {
        SplitSpeaker::Existing { speaker_id } => {
            let found: Option<Option<String>> = db(c.query_row(
                "SELECT person_id FROM speakers WHERE id = ?1 AND call_id = ?2 AND pass = ?3 AND channel = ?4",
                params![speaker_id.as_str(), call, pass, channel],
                |r| r.get(0),
            ).optional())?;
            let person = found.ok_or_else(|| belongs("speaker_id"))?;
            return Ok((speaker_id.as_str().to_owned(), person));
        }
        SplitSpeaker::Person { person } => Some(resolve(c, &person, &mut HashMap::new(), changes)?),
        SplitSpeaker::New => None,
    };
    let mut values = vec![
        ("call_id", json!(call)),
        ("channel", json!(channel)),
        ("pass", json!(pass)),
        ("label", json!(format!("split:{}", second.as_str()))),
    ];
    if let Some((id, name)) = &person {
        let target: Option<String> = db(c.query_row(
            "SELECT id FROM speakers WHERE call_id = ?1 AND pass = ?2 AND channel = ?3 AND person_id = ?4 ORDER BY rowid LIMIT 1",
            params![call, pass, channel, id],
            |r| r.get(0),
        ).optional())?;
        if let Some(target) = target {
            return Ok((target, Some(id.clone())));
        }
        values.extend([
            ("person_id", json!(id)),
            ("name", json!(name)),
            ("named_by", json!("you")),
        ]);
    } else {
        let n: u16 = db(c.query_row(
            "SELECT COALESCE(MAX(n), 0) + 1 FROM speakers WHERE call_id = ?1 AND pass = ?2",
            params![call, pass],
            |r| r.get(0),
        ))?;
        values.push(("n", json!(n)));
    }
    let id = crate::people::new_id("spk");
    changes.push(Mutation {
        entity_type: "speaker",
        table: "speakers",
        id: id.clone(),
        base_rev: None,
        bump_rev: false,
        values,
    });
    Ok((id, person.map(|(id, _)| id)))
}

struct StoredFields {
    pass: String,
    channel: String,
    words_path: Option<String>,
    copied: Vec<(&'static str, serde_json::Value)>,
}

fn stored_fields(c: &Connection, id: &SegmentId) -> Result<StoredFields, CoreError> {
    db(c.query_row(
        "SELECT pass, channel, words_path, avg_logprob, no_speech_p, crosstalk_with, lang, lang_p
         FROM segments WHERE id = ?1",
        [id.as_str()],
        |r| {
            Ok(StoredFields {
                pass: r.get(0)?,
                channel: r.get(1)?,
                words_path: r.get(2)?,
                copied: vec![
                    ("avg_logprob", json!(r.get::<_, Option<f64>>(3)?)),
                    ("no_speech_p", json!(r.get::<_, Option<f64>>(4)?)),
                    ("crosstalk_with", json!(r.get::<_, String>(5)?)),
                    ("lang", json!(r.get::<_, Option<String>>(6)?)),
                    ("lang_p", json!(r.get::<_, Option<f64>>(7)?)),
                ],
            })
        },
    ))
}

impl Core {
    // @cpt-flow:cpt-noter-flow-core-speakers-audio-split:p1
    // @cpt-dod:cpt-noter-dod-core-speakers-audio-split:p1
    pub(crate) async fn split_segment(
        &self,
        ctx: &CommandCtx,
        args: SplitSegmentArgs,
    ) -> Result<SplitSegmentResult, CoreError> {
        self.ready()?;
        let call = args.call_id.clone();
        let id = args.segment_id.clone();
        let second = SegmentId::new(crate::people::new_id("seg"));
        let ids = [id.clone(), second.clone()];
        let dir = self.call_dir(&call);
        let meta = self.change_meta(ctx, "Split a transcript line".into(), REASON);
        let suggest = args.speaker == SplitSpeaker::New;
        let done = self.store().write_with_meta(meta, move |tx, meta| {
            // @cpt-begin:cpt-noter-flow-core-speakers-audio-split:p1:inst-split-validate
            let (active, archiving): (bool, bool) = db(tx.query_row(
                "SELECT status IN ('recording', 'paused'), archive_status = 'running' FROM calls WHERE id = ?1",
                [args.call_id.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ).optional())?.ok_or_else(|| not_found("call"))?;
            if active {
                return Err(belongs("call_id"));
            }
            if archiving {
                return Err(stale_line());
            }
            let mut lines = db(segments_by_id(tx, &args.call_id, std::slice::from_ref(&id)))?;
            let line = lines.pop().ok_or_else(stale_line)?;
            if args.expected_text.as_ref().is_some_and(|expected| *expected != line.text) {
                return Err(stale_line());
            }
            let at = byte_of(&line.text, args.at)
                .filter(|at| boundaries(&line.text).any(|start| start == *at))
                .ok_or_else(|| belongs("at"))?;
            let left = line.text[..at].trim_end();
            let right = &line.text[at..];
            let elapsed = line.t1_ms.0.saturating_sub(line.t0_ms.0);
            if elapsed < 2 {
                return Err(belongs("at"));
            }
            let StoredFields { pass, channel, words_path, mut copied } = stored_fields(tx, &id)?;
            let measured = word_starts(&dir, words_path.as_deref(), &line.text, line.t0_ms, line.t1_ms)
                .and_then(|times| times.get(&args.at).copied());
            let split = measured.unwrap_or_else(|| {
                let fraction = line.text[..at].chars().count() as u64 * u64::from(elapsed)
                    / line.text.chars().count() as u64;
                OffsetMs(line.t0_ms.0 + (fraction as u32).clamp(1, elapsed - 1))
            });
            meta.summary = format!("Split a line at {}", crate::share::clock(split.0));
            let mut changes = vec![];
            let (speaker, person) = right_speaker(tx, args.speaker, &line, &pass, &channel, &second, &mut changes)?;
            // @cpt-end:cpt-noter-flow-core-speakers-audio-split:p1:inst-split-validate
            // @cpt-begin:cpt-noter-flow-core-speakers-audio-split:p1:inst-split-write
            let mut left_fixes = vec![];
            let mut right_fixes = vec![];
            let left_end = units(left);
            for mut fix in line.corrections {
                if fix.range.start < left_end {
                    let mut clipped = fix.clone();
                    clipped.range.end = clipped.range.end.min(left_end);
                    left_fixes.push(clipped);
                }
                if fix.range.end > args.at {
                    fix.range.start = fix.range.start.saturating_sub(args.at);
                    fix.range.end -= args.at;
                    right_fixes.push(fix);
                }
            }
            let summaries = db(tx.prepare(
                "SELECT id FROM summaries WHERE call_id = ?1 AND kind = 'summary' AND agent_id IS NULL AND current_version_id IS NOT NULL AND NOT names_updated",
            ))?.query_map([args.call_id.as_str()], |r| r.get::<_, String>(0)).map_err(internal)?
                .collect::<Result<Vec<_>, _>>().map_err(internal)?;
            copied.extend([
                ("call_id", json!(args.call_id)),
                ("speaker_id", json!(speaker)),
                ("channel", json!(channel)),
                ("pass", json!(pass)),
                ("t1_ms", json!(line.t1_ms)),
                ("words_path", json!(words_path)),
            ]);
            changes.push(part(&second, right, right_fixes, ("t0_ms", split), copied)?);
            // Return the original line's handle, which stays linked to the call even after Undo.
            let original = part(&id, left, left_fixes, ("t1_ms", split), vec![])?;
            let mut logs = vec![];
            for mutation in changes.iter().chain([&original]) {
                logs.push(apply_mutation(tx, mutation)?.2);
            }
            let handle_index = logs.len() - 1;
            let mut cannot_link = constraint(args.call_id.as_str(), "cannot_link",
                (line.t0_ms.0.into(), split.0.into()),
                (split.0.into(), line.t1_ms.0.into()),
            );
            cannot_link.id = format!("spc_split_{}", second.as_str());
            logs.push(apply_mutation(tx, &cannot_link)?.2);
            for summary in &summaries {
                logs.push(apply_mutation(tx, &Mutation {
                    entity_type: "summary",
                    table: "summaries",
                    id: summary.clone(),
                    base_rev: None,
                    bump_rev: true,
                    values: vec![("names_updated", json!(1))],
                })?.2);
            }
            if let Some(person) = person {
                crate::carry::add_participant(tx, args.call_id.as_str(), &person, false, &mut logs)?;
            }
            db(crate::chunks::reindex_split(tx, &args.call_id))?;
            let segments = db(segments_by_id(tx, &args.call_id, &[id, second]))?.try_into()
                .map_err(|_| internal("the split lines are missing"))?;
            Ok(((segments, summaries, handle_index), logs))
            // @cpt-end:cpt-noter-flow-core-speakers-audio-split:p1:inst-split-write
        })?;
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-split:p1:inst-split-return
        let (segments, summaries, handle_index): ([SegmentView; 2], _, _) = done.value;
        let mut speakers = self.publish_corrected(&call, &ids)?;
        for summary in summaries {
            self.publish_section(&summary)?;
        }
        self.embed_split_chunks(&call).await;
        if suggest {
            let new = &segments[1];
            if let Some(speaker) = speakers.iter_mut().find(|s| s.id == new.speaker.speaker_id) {
                speaker.suggestion = self.split_voice_suggestion(new).await;
            }
        }
        Ok(SplitSegmentResult {
            segments,
            speakers,
            change_id: done.change_ids[handle_index].clone(),
        })
        // @cpt-end:cpt-noter-flow-core-speakers-audio-split:p1:inst-split-return
    }
}
