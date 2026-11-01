//! The archive pass of a stopped call (`cpt-noter-flow-core-postcall-regenerate`, archive steps):
//! the engine's offline pass with the user's corrections as constraints, then its result installed
//! beside the live transcript, which stays seven days (retention cleanup is M5): clusters mapped to
//! the live speakers by time overlap so the user's names and line moves stay, term fixes applied
//! again, crosstalk candidates stored; then the chunks are rebuilt and a regeneration is queued.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Weak};

use noter_db::rusqlite::Connection;
use noter_db::Insert;
use noter_jobs::{BoxFuture, JobHandler, Request, RunCtx, Stop, Trigger};
use noter_protocol::engine::{ArchiveResult, AsrBackend, EngineSegment, OfflineConstraints};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::json;

use crate::transcript::{lang_word, shadow};
use crate::{object, Core};

/// A live speaker as the install copies it onto its archive row.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LiveSpeaker {
    pub id: String,
    pub label: String,
    pub n: Option<i64>,
    pub channel: AudioChannel,
    pub named_by: Option<String>,
    pub person_id: Option<String>,
    /// What the user called the speaker (2.13); `label` stays the engine's label.
    pub name: Option<String>,
}

/// A live segment: its speaker, time and the user's term fixes.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LiveLine {
    pub speaker_id: String,
    pub channel: AudioChannel,
    pub t0: i64,
    pub t1: i64,
    pub text: String,
    pub corrections: Vec<TermCorrection>,
}

/// Where an archive segment goes: onto a live speaker's archive row, or a new speaker for a
/// cluster that overlaps no live speech.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) enum Target {
    Live(String),
    New(AudioChannel, String),
}

fn overlap(a0: i64, a1: i64, b0: i64, b1: i64) -> i64 {
    (a1.min(b1) - a0.max(b0)).max(0)
}

/// The id with the most overlap; ties go to the smaller id, so the mapping is deterministic.
fn most(votes: BTreeMap<String, i64>) -> Option<String> {
    votes
        .into_iter()
        .max_by_key(|(id, o)| (*o, std::cmp::Reverse(id.clone())))
        .map(|(id, _)| id)
}

/// Overlap with each live speaker of `channel` over `t0..t1`.
fn votes(live: &[LiveLine], channel: AudioChannel, t0: i64, t1: i64) -> BTreeMap<String, i64> {
    let mut by = BTreeMap::new();
    for l in live.iter().filter(|l| l.channel == channel) {
        let o = overlap(t0, t1, l.t0, l.t1);
        if o > 0 {
            *by.entry(l.speaker_id.clone()).or_default() += o;
        }
    }
    by
}

fn span(s: &EngineSegment) -> (i64, i64) {
    (s.t0_ms.0.into(), s.t1_ms.0.into())
}

/// The target of every archive segment and of every cluster. A segment goes to the live speaker
/// its own span overlaps most, so a line the user moved to another speaker stays there; one that
/// overlaps no live line goes where its cluster's speech overlaps most, else to a new speaker.
pub(crate) fn map_speakers(
    archive: &[EngineSegment],
    live: &[LiveLine],
) -> (Vec<Target>, HashMap<(AudioChannel, String), Target>) {
    // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-install
    let mut clusters: HashMap<(AudioChannel, String), BTreeMap<String, i64>> = HashMap::new();
    for s in archive {
        let (t0, t1) = span(s);
        let all = clusters
            .entry((s.channel, s.speaker_label.clone()))
            .or_default();
        for (id, o) in votes(live, s.channel, t0, t1) {
            *all.entry(id).or_default() += o;
        }
    }
    let of_cluster: HashMap<(AudioChannel, String), Target> = clusters
        .into_iter()
        .map(|(key, votes)| {
            let target =
                most(votes).map_or_else(|| Target::New(key.0, key.1.clone()), Target::Live);
            (key, target)
        })
        .collect();
    let targets = archive
        .iter()
        .map(|s| {
            let (t0, t1) = span(s);
            most(votes(live, s.channel, t0, t1))
                .map(Target::Live)
                .unwrap_or_else(|| of_cluster[&(s.channel, s.speaker_label.clone())].clone())
        })
        .collect();
    (targets, of_cluster)
    // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-install
}

/// `chars[i..i+n]` stands alone: no letter or digit right before or after it.
fn whole(chars: &[char], i: usize, n: usize) -> bool {
    let before = i == 0 || !chars[i - 1].is_alphanumeric();
    let after = i + n >= chars.len() || !chars[i + n].is_alphanumeric();
    before && after
}

/// The character offsets of every whole-word occurrence of `word` in `chars`.
fn find_words(chars: &[char], word: &[char]) -> Vec<usize> {
    let mut at = vec![];
    let mut i = 0;
    while !word.is_empty() && i + word.len() <= chars.len() {
        if chars[i..i + word.len()] == *word && whole(chars, i, word.len()) {
            at.push(i);
            i += word.len();
        } else {
            i += 1;
        }
    }
    at
}

/// The user's term fixes on live lines that overlap `seg`, applied to its text: every whole-word
/// occurrence of what the recognizer heard becomes the fixed term, and is marked as corrected.
/// A fix's range is in UTF-16 code units of the live line's text, as the UI and 2.13 count it.
pub(crate) fn fix_terms(seg: &EngineSegment, live: &[LiveLine]) -> (String, Vec<TermCorrection>) {
    // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-install
    let (t0, t1) = span(seg);
    let mut text = seg.text.clone();
    let mut fixes: Vec<(String, String)> = vec![];
    let near = live
        .iter()
        .filter(|l| l.channel == seg.channel && overlap(t0, t1, l.t0, l.t1) > 0);
    for l in near {
        for c in &l.corrections {
            let units: Vec<u16> = l.text.encode_utf16().collect();
            let fixed = units
                .get(c.range.start as usize..c.range.end as usize)
                .map(String::from_utf16_lossy)
                .unwrap_or_default();
            if fixed.is_empty() || c.original.is_empty() || fixed == c.original {
                continue;
            }
            let chars: Vec<char> = text.chars().collect();
            let heard: Vec<char> = c.original.chars().collect();
            let mut out = String::with_capacity(text.len());
            let mut from = 0;
            for at in find_words(&chars, &heard) {
                out.extend(&chars[from..at]);
                out.push_str(&fixed);
                from = at + heard.len();
            }
            out.extend(&chars[from..]);
            text = out;
            fixes.push((fixed, c.original.clone()));
        }
    }
    let chars: Vec<char> = text.chars().collect();
    let mut corrections: Vec<TermCorrection> = fixes
        .iter()
        .flat_map(|(fixed, original)| {
            let word: Vec<char> = fixed.chars().collect();
            let units = |cs: &[char]| cs.iter().map(|c| c.len_utf16() as u32).sum::<u32>();
            let len = units(&word);
            find_words(&chars, &word)
                .into_iter()
                .map(|at| units(&chars[..at]))
                .map(move |start| TermCorrection {
                    range: TextRange {
                        start,
                        end: start + len,
                    },
                    original: original.clone(),
                })
                .collect::<Vec<_>>()
        })
        .collect();
    corrections.sort_by_key(|c| c.range.start);
    corrections.dedup_by_key(|c| c.range.start);
    (text, corrections)
    // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-install
}

/// The archive pass's job handler.
pub(crate) struct ArchiveJob(Weak<Core>);

impl JobHandler for ArchiveJob {
    fn run<'a>(&'a self, ctx: &'a mut RunCtx) -> BoxFuture<'a, Result<(), Stop>> {
        Box::pin(async move {
            let (Some(core), Some(call)) = (self.0.upgrade(), ctx.subject().map(CallId::new))
            else {
                return Ok(());
            };
            core.archive_pass(ctx, &call).await
        })
    }
}

pub(crate) fn register(core: &Arc<Core>) {
    core.jobs.register(
        JobKind::ArchivePass,
        Arc::new(ArchiveJob(Arc::downgrade(core))),
    );
}

/// What the archive pass reads of the call.
struct Audio {
    status: String,
    archive_status: String,
    absent: bool,
}

fn audio(c: &Connection, call: &str) -> noter_db::rusqlite::Result<Option<Audio>> {
    use noter_db::rusqlite::OptionalExtension;
    c.query_row(
        "SELECT status, archive_status, audio_deleted OR audio_not_stored FROM calls WHERE id = ?1",
        [call],
        |r| {
            Ok(Audio {
                status: r.get(0)?,
                archive_status: r.get(1)?,
                absent: r.get(2)?,
            })
        },
    )
    .optional()
}

fn channel(word: String) -> AudioChannel {
    if word == "mic" {
        AudioChannel::Mic
    } else {
        AudioChannel::Sys
    }
}

fn live_of(
    c: &Connection,
    call: &str,
) -> noter_db::rusqlite::Result<(Vec<LiveSpeaker>, Vec<LiveLine>)> {
    let mut stmt = c.prepare(
        "SELECT id, label, n, channel, named_by, person_id, name FROM speakers
         WHERE call_id = ?1 AND pass = 'live' ORDER BY rowid",
    )?;
    let speakers = stmt
        .query_map([call], |r| {
            Ok(LiveSpeaker {
                id: r.get(0)?,
                label: r.get(1)?,
                n: r.get(2)?,
                channel: channel(r.get(3)?),
                named_by: r.get(4)?,
                person_id: r.get(5)?,
                name: r.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = c.prepare(
        "SELECT speaker_id, channel, t0_ms, t1_ms, text, corrections FROM segments
         WHERE call_id = ?1 AND pass = 'live' AND speaker_id IS NOT NULL ORDER BY t0_ms",
    )?;
    let lines = stmt
        .query_map([call], |r| {
            Ok(LiveLine {
                speaker_id: r.get(0)?,
                channel: channel(r.get(1)?),
                t0: r.get(2)?,
                t1: r.get(3)?,
                text: r.get(4)?,
                corrections: serde_json::from_str(&r.get::<_, String>(5)?).unwrap_or_default(),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok((speakers, lines))
}

/// The archive `speakers` row of one target: a live speaker's label, number, name and who named
/// it carry over; a new voice takes the next number.
fn speaker_values(
    target: &Target,
    speakers: &[LiveSpeaker],
    next_n: &mut i64,
) -> Vec<(&'static str, serde_json::Value)> {
    match target {
        Target::Live(id) => {
            let s = speakers.iter().find(|s| &s.id == id);
            vec![
                ("label", json!(s.map_or(id.as_str(), |s| s.label.as_str()))),
                ("n", json!(s.and_then(|s| s.n))),
                ("channel", json!(s.map_or(AudioChannel::Sys, |s| s.channel))),
                ("named_by", json!(s.and_then(|s| s.named_by.clone()))),
                ("person_id", json!(s.and_then(|s| s.person_id.clone()))),
                ("name", json!(s.and_then(|s| s.name.clone()))),
            ]
        }
        Target::New(channel, label) => {
            let n = (*channel == AudioChannel::Sys).then(|| {
                *next_n += 1;
                *next_n
            });
            vec![
                ("label", json!(format!("archive:{label}"))),
                ("n", json!(n)),
                ("channel", json!(channel)),
            ]
        }
    }
}

/// The `speakers` and `segments` rows of pass `archive` that install `result`.
pub(crate) fn install_rows(
    call: &CallId,
    result: &ArchiveResult,
    speakers: &[LiveSpeaker],
    live: &[LiveLine],
) -> Vec<Insert> {
    // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-install
    let (targets, of_cluster) = map_speakers(&result.segments, live);
    let mut ids: HashMap<Target, String> = HashMap::new();
    let mut rows = vec![];
    let mut next_n = speakers.iter().filter_map(|s| s.n).max().unwrap_or(0);
    let mut speaker_of = |target: &Target, rows: &mut Vec<Insert>| -> String {
        if let Some(id) = ids.get(target) {
            return id.clone();
        }
        let id = format!("spk_{}", ulid::Ulid::generate());
        let mut values = speaker_values(target, speakers, &mut next_n);
        values.extend([
            ("id", json!(id)),
            ("call_id", json!(call)),
            ("pass", json!("archive")),
        ]);
        rows.push(Insert {
            table: "speakers",
            values,
        });
        ids.insert(target.clone(), id.clone());
        id
    };
    let mut segments = vec![];
    for (seg, target) in result.segments.iter().zip(&targets) {
        let speaker = speaker_of(target, &mut rows);
        let crosstalk: Vec<String> = seg
            .crosstalk_labels
            .iter()
            .filter_map(|label| of_cluster.get(&(seg.channel, label.clone())))
            .map(|t| speaker_of(t, &mut rows))
            .collect();
        let (text, corrections) = fix_terms(seg, live);
        segments.push(Insert {
            table: "segments",
            values: vec![
                ("id", json!(format!("seg_{}", ulid::Ulid::generate()))),
                ("call_id", json!(call)),
                ("speaker_id", json!(speaker)),
                ("channel", json!(seg.channel)),
                ("t0_ms", json!(seg.t0_ms)),
                ("t1_ms", json!(seg.t1_ms)),
                ("text_norm", json!(shadow(&text))),
                ("text", json!(text)),
                ("lang", json!(lang_word(&seg.lang))),
                ("lang_p", json!(seg.lang_p)),
                ("avg_logprob", json!(seg.avg_logprob)),
                ("no_speech_p", json!(seg.no_speech_p)),
                ("pass", json!("archive")),
                ("words_path", json!(seg.words_path)),
                (
                    "corrections",
                    json!(serde_json::to_string(&corrections).unwrap_or_default()),
                ),
                (
                    "crosstalk_with",
                    json!(serde_json::to_string(&crosstalk).unwrap_or_default()),
                ),
            ],
        });
    }
    rows.extend(segments);
    rows
    // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-install
}

/// The constraints the pass reads when the speakers feature wrote none: the live names only.
pub(crate) fn live_constraints(speakers: &[LiveSpeaker]) -> OfflineConstraints {
    let speaker_names = speakers
        .iter()
        .filter_map(|s| Some((s.label.clone(), s.name.clone()?)))
        .collect();
    OfflineConstraints {
        languages: vec![],
        glossary: vec![],
        speaker_priors: vec![],
        must_link: vec![],
        cannot_link: vec![],
        speaker_names,
    }
}

impl Core {
    fn set_archive(&self, ctx: &RunCtx, call: &CallId, status: &str) -> Result<(), Stop> {
        let meta = ctx.change_meta("archive").ok_or(Stop::Cancelled)?;
        self.store().write(
            noter_db::Mutation {
                entity_type: "call",
                table: "calls",
                id: call.as_str().to_owned(),
                base_rev: None,
                bump_rev: true,
                values: vec![("archive_status", json!(status))],
            },
            meta,
        )?;
        if let Ok(Some(row)) = self.call_row(call.as_str()) {
            self.emit_entity_changed(&EntityChanged::Call { call: row });
        }
        Ok(())
    }

    /// The archive failed or cannot run: the live transcript stays and the call says so; the
    /// nightly window retries a failed pass while the audio is kept.
    fn archive_failed(&self, ctx: &RunCtx, call: &CallId, why: &str) -> Result<(), Stop> {
        // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-archive-fail
        self.log(object(json!({
            "level": "warn", "module": "postcall", "code": "archive_failed", "message_len": why.len()
        })));
        self.set_archive(ctx, call, "failed")?;
        Ok(())
        // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-archive-fail
    }

    /// The constraints file the pass reads: the speakers feature's if it wrote one, else the live
    /// names. `None` without a container (the pass then fails on its own).
    fn constraints_file(&self, call: &CallId, speakers: &[LiveSpeaker]) -> Option<String> {
        let rel = format!("audio/{call}/constraints.json");
        let path = self.deps.engine.container()?.join(&rel);
        if !path.exists() {
            let body = serde_json::to_vec(&live_constraints(speakers)).ok()?;
            std::fs::create_dir_all(path.parent()?).ok()?;
            std::fs::write(&path, body).ok()?;
        }
        Some(rel)
    }

    /// The archive pass of `call`. A run stopped after it started leaves the call as it found
    /// it: cancelled (Continue Recording) back to pending for the next stop, failed as failed.
    pub(crate) async fn archive_pass(&self, ctx: &mut RunCtx, call: &CallId) -> Result<(), Stop> {
        let result = self.archive_run(ctx, call).await;
        let status = match &result {
            Err(Stop::Cancelled) => "pending",
            Err(Stop::Failed(_)) => "failed",
            Ok(()) => return result,
        };
        let id = call.as_str().to_owned();
        let running = self
            .store()
            .read(move |c| audio(c, &id))
            .ok()
            .flatten()
            .is_some_and(|h| h.archive_status == "running");
        if running {
            let _ = self.set_archive(ctx, call, status);
        }
        result
    }

    // @cpt-flow:cpt-noter-flow-core-postcall-regenerate:p1
    // @cpt-dod:cpt-noter-dod-core-postcall-regeneration:p1
    async fn archive_run(&self, ctx: &mut RunCtx, call: &CallId) -> Result<(), Stop> {
        // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-archive
        // The scheduler holds this run while a call is live (TL-23); the checkpoint waits for it.
        ctx.checkpoint().await?;
        let id = call.as_str().to_owned();
        let Some(head) = self.store().read(move |c| audio(c, &id))? else {
            return Ok(());
        };
        if matches!(head.status.as_str(), "recording" | "paused") {
            return Err(Stop::Cancelled);
        }
        if head.archive_status == "done" {
            return Ok(());
        }
        if head.absent {
            return self.archive_failed(ctx, call, "no audio");
        }
        self.set_archive(ctx, call, "running")?;
        let id = call.as_str().to_owned();
        let (speakers, live) = self.store().read(move |c| live_of(c, &id))?;
        let constraints = self.constraints_file(call, &speakers);
        let result_path = format!("audio/{call}/archive-{}.json", ulid::Ulid::generate());
        let pass = self
            .engine
            .offline_pass(
                call.clone(),
                format!("audio/{call}"),
                result_path,
                constraints,
                AsrBackend::WhisperLargeV3,
            )
            .await;
        // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-archive
        let read = pass.map_err(|e| format!("{e:?}")).and_then(|path| {
            let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
            serde_json::from_slice::<ArchiveResult>(&bytes).map_err(|e| e.to_string())
        });
        let result = match read {
            Ok(r) if r.segments.is_empty() && !live.is_empty() => {
                return self.archive_failed(ctx, call, "the archive heard none of the live speech");
            }
            Ok(r) => r,
            Err(why) => return self.archive_failed(ctx, call, &why),
        };
        // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-return
        // A capture continued meanwhile makes this result obsolete: it is never installed.
        ctx.checkpoint().await?;
        let id = call.as_str().to_owned();
        match self.store().read(move |c| audio(c, &id))? {
            Some(h) if !matches!(h.status.as_str(), "recording" | "paused") => {}
            Some(_) => return Err(Stop::Cancelled),
            None => return Ok(()),
        }
        // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-return
        // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-install
        // Capture data (TL-1): one transaction, no change rows; the live rows stay.
        self.store()
            .insert_batch(install_rows(call, &result, &speakers, &live))?;
        // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-install
        self.set_archive(ctx, call, "done")?;
        // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-rechunk
        if let Err(e) = self.write_transcript_file(call) {
            self.log(object(json!({
                "level": "error", "module": "postcall", "code": "transcript_file",
                "message_len": e.message.len()
            })));
        }
        self.rechunk(ctx, call).await?;
        // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-rechunk
        // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-publish
        // The relabelled speakers go out whole; the transcript reads the archive pass from now on.
        let id = call.clone();
        let speakers = self
            .store()
            .read(move |c| crate::transcript::speaker_views(c, &id))?;
        self.emit_entity_changed(&EntityChanged::Speakers {
            call_id: call.clone(),
            speakers,
        });
        // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-publish
        let req = Request::for_call(JobKind::Regeneration, Trigger::OnDemand, call);
        self.jobs.trigger(req)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use noter_protocol::engine::EngineSegmentState;

    fn seg(channel: AudioChannel, label: &str, t0: u32, t1: u32, text: &str) -> EngineSegment {
        EngineSegment {
            id: String::new(),
            call_id: CallId::new("c"),
            channel,
            t0_ms: OffsetMs(t0),
            t1_ms: OffsetMs(t1),
            state: EngineSegmentState::Confirmed,
            lang: Lang::En,
            lang_p: 0.9,
            speaker_label: label.into(),
            text: text.into(),
            words_path: None,
            avg_logprob: -0.1,
            no_speech_p: 0.0,
            corrections: vec![],
            crosstalk_labels: vec![],
        }
    }

    fn line(speaker: &str, t0: i64, t1: i64, text: &str) -> LiveLine {
        LiveLine {
            speaker_id: speaker.into(),
            channel: AudioChannel::Sys,
            t0,
            t1,
            text: text.into(),
            corrections: vec![],
        }
    }

    #[test]
    fn clusters_map_to_live_speakers_by_overlap_and_a_moved_line_stays_moved() {
        let live = vec![
            line("anna", 0, 10_000, "a"),
            // The user moved this one line to Ben (cannot-link with Anna's voice).
            line("ben", 10_000, 12_000, "b"),
            line("anna", 12_000, 30_000, "a"),
            line("ben", 30_000, 40_000, "b"),
        ];
        let archive = vec![
            seg(AudioChannel::Sys, "c1", 0, 9_000, "x"),
            seg(AudioChannel::Sys, "c1", 10_000, 12_000, "x"),
            seg(AudioChannel::Sys, "c1", 12_000, 29_000, "x"),
            seg(AudioChannel::Sys, "c2", 30_000, 40_000, "y"),
            // Speech the live pass missed: its cluster decides.
            seg(AudioChannel::Sys, "c2", 50_000, 52_000, "y"),
            // A voice the live pass never heard.
            seg(AudioChannel::Sys, "c3", 60_000, 62_000, "z"),
        ];
        let (targets, clusters) = map_speakers(&archive, &live);
        let t = |s: &str| Target::Live(s.into());
        assert_eq!(
            targets,
            vec![
                t("anna"),
                t("ben"),
                t("anna"),
                t("ben"),
                t("ben"),
                Target::New(AudioChannel::Sys, "c3".into())
            ]
        );
        assert_eq!(clusters[&(AudioChannel::Sys, "c1".into())], t("anna"));
        // Channels never mix.
        let mic = vec![seg(AudioChannel::Mic, "you", 0, 5_000, "m")];
        assert_eq!(
            map_speakers(&mic, &live).0,
            vec![Target::New(AudioChannel::Mic, "you".into())]
        );
    }

    #[test]
    fn the_users_term_fixes_apply_to_the_archive_text() {
        // The user fixed what the recognizer heard as "Cubanetes" (characters 4..14 now).
        let mut live = line("anna", 0, 10_000, "Use Kubernetes now");
        live.corrections = vec![TermCorrection {
            range: TextRange { start: 4, end: 14 },
            original: "Cubanetes".into(),
        }];
        let s = seg(
            AudioChannel::Sys,
            "c1",
            1_000,
            9_000,
            "Cubanetes or Cubanetes2, Cubanetes.",
        );
        let (text, corrections) = fix_terms(&s, std::slice::from_ref(&live));
        assert_eq!(text, "Kubernetes or Cubanetes2, Kubernetes.");
        assert_eq!(
            corrections
                .iter()
                .map(|c| (c.range.start, c.range.end))
                .collect::<Vec<_>>(),
            vec![(0, 10), (26, 36)]
        );
        assert!(corrections.iter().all(|c| c.original == "Cubanetes"));
        // Ranges count UTF-16 code units, as the UI does: the emoji is two.
        let wide = seg(AudioChannel::Sys, "c1", 1_000, 9_000, "😀 Cubanetes");
        let (text, corrections) = fix_terms(&wide, std::slice::from_ref(&live));
        assert_eq!(text, "😀 Kubernetes");
        assert_eq!(
            (corrections[0].range.start, corrections[0].range.end),
            (3, 13)
        );
        // A line elsewhere in time keeps its text.
        let far = seg(AudioChannel::Sys, "c1", 20_000, 21_000, "Cubanetes");
        assert_eq!(fix_terms(&far, &[live]).0, "Cubanetes");
    }

    struct Clock0;
    impl crate::Clock for Clock0 {
        fn now(&self) -> TimestampMs {
            TimestampMs(1_790_000_000_000)
        }
    }
    struct Quiet;
    impl crate::EventEmitter for Quiet {
        fn emit(&self, _: &'static str, _: serde_json::Value) {}
    }

    #[test]
    fn the_installed_archive_is_what_the_transcript_reads_with_names_fixes_and_crosstalk() {
        let dir = tempfile::tempdir().unwrap();
        let deps = crate::CoreDeps::new(Arc::new(Clock0), Arc::new(Quiet));
        let core = Core::open(dir.path(), deps).unwrap();
        let call = CallId::new("c");
        let row = |table, values: Vec<(&'static str, serde_json::Value)>| Insert { table, values };
        let fix = json!([{"range": {"start": 4, "end": 14}, "original": "Cubanetes"}]).to_string();
        core.store()
            .insert_batch(vec![
                row(
                    "calls",
                    vec![
                        ("id", json!("c")),
                        ("rev", json!(1)),
                        ("started_at", json!(0)),
                        ("title", json!("T")),
                        ("call_type", json!("planning")),
                        ("status", json!("ready")),
                        ("mode_used", json!("cloud")),
                    ],
                ),
                row(
                    "speakers",
                    vec![
                        ("id", json!("anna")),
                        ("call_id", json!("c")),
                        ("label", json!("spk_1")),
                        ("name", json!("Anna Lee")),
                        ("n", json!(1)),
                        ("channel", json!("sys")),
                        ("pass", json!("live")),
                        ("named_by", json!("you")),
                        ("person_id", json!("per_anna")),
                    ],
                ),
                row(
                    "speakers",
                    vec![
                        ("id", json!("ben")),
                        ("call_id", json!("c")),
                        ("label", json!("spk_2")),
                        ("n", json!(2)),
                        ("channel", json!("sys")),
                        ("pass", json!("live")),
                    ],
                ),
                row(
                    "segments",
                    vec![
                        ("id", json!("l1")),
                        ("call_id", json!("c")),
                        ("speaker_id", json!("anna")),
                        ("channel", json!("sys")),
                        ("t0_ms", json!(0)),
                        ("t1_ms", json!(10_000)),
                        ("text", json!("Use Kubernetes now")),
                        ("text_norm", json!("x")),
                        ("pass", json!("live")),
                        ("corrections", json!(fix)),
                    ],
                ),
                row(
                    "segments",
                    vec![
                        ("id", json!("l2")),
                        ("call_id", json!("c")),
                        ("speaker_id", json!("ben")),
                        ("channel", json!("sys")),
                        ("t0_ms", json!(10_000)),
                        ("t1_ms", json!(20_000)),
                        ("text", json!("b")),
                        ("text_norm", json!("b")),
                        ("pass", json!("live")),
                    ],
                ),
            ])
            .unwrap();
        let (speakers, live) = core.store().read(|c| live_of(c, "c")).unwrap();
        let mut both = seg(AudioChannel::Sys, "c2", 10_000, 20_000, "Both at once.");
        both.crosstalk_labels = vec!["c1".into(), "c2".into()];
        let result = ArchiveResult {
            call_id: call.clone(),
            backend: AsrBackend::WhisperLargeV3,
            segments: vec![
                seg(AudioChannel::Sys, "c1", 0, 9_000, "Use Cubanetes now."),
                both,
            ],
        };
        core.store()
            .insert_batch(install_rows(&call, &result, &speakers, &live))
            .unwrap();
        let read = core
            .store()
            .read(|c| crate::transcript::segments_of(c, &call, None))
            .unwrap();
        assert_eq!(read.len(), 2);
        assert!(read.iter().all(|s| s.pass == TranscriptPass::Archive));
        assert_eq!(read[0].text, "Use Kubernetes now.");
        assert!(
            matches!(&read[0].speaker.label, SpeakerLabel::Person { person } if person.id.0 == "per_anna")
        );
        assert!(read[0].crosstalk_with.is_empty());
        let labels: Vec<&SpeakerLabel> = read[1].crosstalk_with.iter().map(|s| &s.label).collect();
        assert!(
            matches!(
                labels[..],
                [SpeakerLabel::Person { .. }, SpeakerLabel::Unnamed { n: 2 }]
            ),
            "{labels:?}"
        );
        // The live copy stays for its seven days.
        let live_rows: i64 = core
            .store()
            .read(|c| {
                c.query_row(
                    "SELECT count(*) FROM segments WHERE pass = 'live'",
                    [],
                    |r| r.get(0),
                )
            })
            .unwrap();
        assert_eq!(live_rows, 2);
    }

    #[test]
    fn install_rows_copy_the_live_names_and_store_crosstalk_by_speaker() {
        let call = CallId::new("c");
        let speakers = vec![
            LiveSpeaker {
                id: "anna".into(),
                label: "spk_1".into(),
                n: Some(1),
                channel: AudioChannel::Sys,
                named_by: Some("you".into()),
                person_id: Some("per_anna".into()),
                name: Some("Anna Lee".into()),
            },
            LiveSpeaker {
                id: "ben".into(),
                label: "spk_2".into(),
                n: Some(2),
                channel: AudioChannel::Sys,
                named_by: None,
                person_id: None,
                name: None,
            },
        ];
        let live = vec![
            line("anna", 0, 10_000, "a"),
            line("ben", 10_000, 20_000, "b"),
        ];
        let mut overlapped = seg(AudioChannel::Sys, "c2", 10_000, 20_000, "both");
        overlapped.crosstalk_labels = vec!["c1".into(), "c2".into()];
        let result = ArchiveResult {
            call_id: call.clone(),
            backend: AsrBackend::WhisperLargeV3,
            segments: vec![
                seg(AudioChannel::Sys, "c1", 0, 10_000, "first"),
                overlapped,
                seg(AudioChannel::Sys, "c9", 30_000, 31_000, "new voice"),
            ],
        };
        let rows = install_rows(&call, &result, &speakers, &live);
        let get = |r: &Insert, k: &str| r.values.iter().find(|(c, _)| *c == k).unwrap().1.clone();
        let spk: Vec<&Insert> = rows.iter().filter(|r| r.table == "speakers").collect();
        let segs: Vec<&Insert> = rows.iter().filter(|r| r.table == "segments").collect();
        assert_eq!(spk.len(), 3);
        assert_eq!(get(spk[0], "label"), "spk_1");
        assert_eq!(get(spk[0], "name"), "Anna Lee");
        assert_eq!(get(spk[0], "person_id"), "per_anna");
        assert_eq!(get(spk[0], "pass"), "archive");
        assert_eq!(get(spk[2], "n"), 3, "a new voice takes the next number");
        assert_eq!(segs.len(), 3);
        let crosstalk: Vec<String> =
            serde_json::from_str(get(segs[1], "crosstalk_with").as_str().unwrap()).unwrap();
        assert_eq!(crosstalk, vec![get(spk[0], "id"), get(spk[1], "id")]);
        assert_eq!(get(segs[0], "crosstalk_with"), "[]");
        // With no constraints file, the pass gets the names the user gave.
        let c = live_constraints(&speakers);
        assert_eq!(c.speaker_names.len(), 1);
        assert_eq!(c.speaker_names["spk_1"], "Anna Lee");
    }
}
