//! FEATURE cpt-noter-feature-core-speakers-audio (slice 1): speaker names at call or line scope,
//! post-call naming and term fixes, each one logged batch that undoes as a whole, with the
//! constraints the archive pass reads.

use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;

use noter_db::rusqlite::{Connection, OptionalExtension};
use noter_db::Mutation;
use noter_protocol::engine::{EngineSpan, GlossaryEntry, OfflineConstraints, SpanLink};
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::CommandCtx;
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

use crate::settings::invalid;
use crate::transcript::segments_of;
use crate::{internal, object, Core};

/// Change rows with these reasons are one action: the `change_id` the commands return undoes
/// every row of their batch.
const ACTION_REASONS: [&str; 2] = ["speaker_name", "term_fix"];

/// One speaker to name, with the lines it covers.
struct Assignment {
    speaker_id: SpeakerId,
    person: Option<PersonRef>,
    scope: RenameScope,
}

/// What a naming writes and which lines it changes.
struct Plan {
    mutations: Vec<Mutation>,
    segments: Vec<SegmentId>,
}

fn not_found(what: &str) -> CoreError {
    CoreError::new(ErrorCode::NotFound, what.to_string())
}

fn belongs(field: &str) -> CoreError {
    invalid(field, ValidationRule::OutOfRange)
}

fn db<T>(r: noter_db::rusqlite::Result<T>) -> Result<T, CoreError> {
    r.map_err(internal)
}

fn constraint(call_id: &str, kind: &str, a: (i64, i64), b: (i64, i64)) -> Mutation {
    Mutation {
        entity_type: "speaker_constraint",
        table: "speaker_constraints",
        id: format!("spc_{call_id}_{kind}_{}_{}", a.0, b.0),
        base_rev: None,
        bump_rev: false,
        values: vec![
            ("call_id", json!(call_id)),
            ("kind", json!(kind)),
            ("a_t0_ms", json!(a.0)),
            ("a_t1_ms", json!(a.1)),
            ("b_t0_ms", json!(b.0)),
            ("b_t1_ms", json!(b.1)),
        ],
    }
}

/// The person an assignment names: an existing one a speaker row carries, or a new one the core
/// mints (the same name twice in one batch is one person).
fn resolve(
    c: &Connection,
    person: &PersonRef,
    minted: &mut HashMap<String, String>,
) -> Result<(String, String), CoreError> {
    match person {
        PersonRef::Existing { person_id } => {
            let name: Option<String> = db(c
                .query_row(
                    "SELECT COALESCE(name, label) FROM speakers WHERE person_id = ?1
                     ORDER BY rowid DESC LIMIT 1",
                    [person_id.as_str()],
                    |r| r.get(0),
                )
                .optional())?;
            let name = name.ok_or_else(|| not_found("person"))?;
            Ok((person_id.as_str().to_string(), name))
        }
        PersonRef::New { display_name, .. } => {
            let name = display_name.trim();
            if name.is_empty() {
                return Err(invalid("display_name", ValidationRule::Required));
            }
            let id = minted
                .entry(name.to_lowercase())
                .or_insert_with(|| format!("per_{}", ulid::Ulid::generate()));
            Ok((id.clone(), name.to_string()))
        }
    }
}

/// The lines of a speaker on the system channel as `(id, t0, t1)`, in time order.
fn spans_of(c: &Connection, speaker_id: &str) -> Result<Vec<(String, i64, i64)>, CoreError> {
    let mut stmt = db(c.prepare(
        "SELECT id, t0_ms, t1_ms FROM segments WHERE speaker_id = ?1 AND channel = 'sys'
         ORDER BY t0_ms, rowid",
    ))?;
    let rows = db(stmt.query_map([speaker_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))))?;
    db(rows.collect())
}

// @cpt-algo:cpt-noter-algo-core-speakers-audio-correct:p1
fn plan_names(
    c: &Connection,
    call_id: &str,
    assignments: &[Assignment],
) -> Result<Plan, CoreError> {
    let mut plan = Plan {
        mutations: vec![],
        segments: vec![],
    };
    let mut minted = HashMap::new();
    for a in assignments {
        // A skipped speaker stays as it is.
        let Some(person) = &a.person else { continue };
        // @cpt-begin:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-load
        let speaker: Option<(String, String, String, String, Option<String>)> = db(c
            .query_row(
                "SELECT call_id, label, channel, pass, person_id FROM speakers WHERE id = ?1",
                [a.speaker_id.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional())?;
        let (owner, label, channel, pass, current) = speaker.ok_or_else(|| not_found("speaker"))?;
        if owner != call_id {
            return Err(belongs("speaker_id"));
        }
        // @cpt-end:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-load
        let (person_id, name) = resolve(c, person, &mut minted)?;
        // @cpt-begin:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-no-enroll
        // The name is the user's own word; no voice profile is made or touched here (M3).
        let named = [
            ("name", json!(name)),
            ("person_id", json!(person_id)),
            ("named_by", json!("you")),
        ];
        // @cpt-end:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-no-enroll
        match &a.scope {
            RenameScope::WholeCall => {
                // @cpt-begin:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-propagate
                // Lines, summaries and owners read the speaker's name, so one row carries the change.
                plan.mutations.push(Mutation {
                    entity_type: "speaker",
                    table: "speakers",
                    id: a.speaker_id.as_str().to_string(),
                    base_rev: None,
                    bump_rev: false,
                    values: named.to_vec(),
                });
                // @cpt-end:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-propagate
                // @cpt-begin:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-constraints
                // One voice: each line is linked to the next, so the pass keeps them together.
                let spans = spans_of(c, a.speaker_id.as_str())?;
                for pair in spans.windows(2) {
                    let (x, y) = (&pair[0], &pair[1]);
                    plan.mutations
                        .push(constraint(call_id, "must_link", (x.1, x.2), (y.1, y.2)));
                }
                // @cpt-end:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-constraints
                plan.segments
                    .extend(spans.into_iter().map(|s| SegmentId::new(s.0)));
            }
            RenameScope::OneSegment { segment_id } => {
                let line: Option<(String, Option<String>, i64, i64)> = db(c
                    .query_row(
                        "SELECT call_id, speaker_id, t0_ms, t1_ms FROM segments WHERE id = ?1",
                        [segment_id.as_str()],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                    )
                    .optional())?;
                let (line_call, line_speaker, t0, t1) = line.ok_or_else(|| not_found("segment"))?;
                if line_call != call_id || line_speaker.as_deref() != Some(a.speaker_id.as_str()) {
                    return Err(belongs("segment_id"));
                }
                // The line moves to the call's speaker of that person on its side, or to a new one.
                let target: Option<String> = db(c
                    .query_row(
                        "SELECT id FROM speakers WHERE call_id = ?1 AND pass = ?2 AND channel = ?3
                           AND person_id = ?4 LIMIT 1",
                        noter_db::rusqlite::params![call_id, pass, channel, person_id],
                        |r| r.get(0),
                    )
                    .optional())?;
                if target.as_deref() == Some(a.speaker_id.as_str())
                    || current.as_deref() == Some(person_id.as_str())
                {
                    continue;
                }
                let target = target.unwrap_or_else(|| {
                    let id = format!("spk_{}", ulid::Ulid::generate());
                    let mut values = vec![
                        ("call_id", json!(call_id)),
                        ("label", json!(format!("{label}+{}", segment_id.as_str()))),
                        ("channel", json!(channel)),
                        ("pass", json!(pass)),
                    ];
                    values.extend(named.iter().cloned());
                    plan.mutations.push(Mutation {
                        entity_type: "speaker",
                        table: "speakers",
                        id: id.clone(),
                        base_rev: None,
                        bump_rev: false,
                        values,
                    });
                    id
                });
                plan.mutations.push(Mutation {
                    entity_type: "segment",
                    table: "segments",
                    id: segment_id.as_str().to_string(),
                    base_rev: None,
                    bump_rev: false,
                    values: vec![("speaker_id", json!(target))],
                });
                // @cpt-begin:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-split
                // The line left its cluster: the pass must not merge it back into a line that stayed.
                if channel == "sys" {
                    let rest = spans_of(c, a.speaker_id.as_str())?;
                    if let Some(other) = rest.iter().find(|s| s.0 != segment_id.as_str()) {
                        plan.mutations.push(constraint(
                            call_id,
                            "cannot_link",
                            (t0, t1),
                            (other.1, other.2),
                        ));
                    }
                }
                // @cpt-end:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-split
                plan.segments.push(segment_id.clone());
            }
        }
    }
    Ok(plan)
}

/// UTF-16 units (what the UI counts) to a byte offset; `None` inside a surrogate pair or past the end.
fn byte_of(text: &str, units: u32) -> Option<usize> {
    let mut seen = 0u32;
    for (i, ch) in text.char_indices() {
        if seen == units {
            return Some(i);
        }
        seen += ch.len_utf16() as u32;
        if seen > units {
            return None;
        }
    }
    (seen == units).then_some(text.len())
}

fn units(text: &str) -> u32 {
    text.encode_utf16().count() as u32
}

impl Core {
    // @cpt-flow:cpt-noter-flow-core-speakers-audio-name:p1
    // @cpt-dod:cpt-noter-dod-core-speakers-audio-corrections:p1
    pub(crate) fn rename_speaker(
        &self,
        ctx: &CommandCtx,
        args: RenameSpeakerArgs,
    ) -> Result<SpeakerMutation, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-name:p1:inst-name-request
        let one = Assignment {
            speaker_id: args.speaker_id,
            person: Some(args.person),
            scope: args.scope,
        };
        self.name(ctx, &args.call_id, vec![one], "Named a speaker")
        // @cpt-end:cpt-noter-flow-core-speakers-audio-name:p1:inst-name-request
    }

    pub(crate) fn name_speakers(
        &self,
        ctx: &CommandCtx,
        args: NameSpeakersArgs,
    ) -> Result<SpeakerMutation, CoreError> {
        let all = args
            .assignments
            .into_iter()
            .map(|a| Assignment {
                speaker_id: a.speaker_id,
                person: a.person,
                scope: RenameScope::WholeCall,
            })
            .collect();
        self.name(ctx, &args.call_id, all, "Named speakers")
    }

    fn name(
        &self,
        ctx: &CommandCtx,
        call_id: &CallId,
        assignments: Vec<Assignment>,
        summary: &str,
    ) -> Result<SpeakerMutation, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-name:p1:inst-name-validate
        let id = call_id.as_str().to_string();
        let plan = self.store().read(move |c| {
            let known: bool = c.query_row(
                "SELECT EXISTS (SELECT 1 FROM calls WHERE id = ?1)",
                [&id],
                |r| r.get(0),
            )?;
            Ok(if known {
                plan_names(c, &id, &assignments)
            } else {
                Err(not_found("call"))
            })
        })??;
        // @cpt-end:cpt-noter-flow-core-speakers-audio-name:p1:inst-name-validate
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-name:p1:inst-name-correct
        // Every speaker skipped (or already that person): nothing to log, so no handle to return.
        if plan.mutations.is_empty() {
            return Err(invalid("assignments", ValidationRule::Required));
        }
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-name:p1:inst-name-no-audio
        // Naming writes text rows only: it works the same once the audio is gone.
        // @cpt-begin:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-log
        let meta = self.change_meta(ctx, summary.into(), "speaker_name");
        let written = self.store().write_batch(plan.mutations, meta)?;
        // @cpt-end:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-log
        // @cpt-end:cpt-noter-flow-core-speakers-audio-name:p1:inst-name-no-audio
        // @cpt-end:cpt-noter-flow-core-speakers-audio-name:p1:inst-name-correct
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-name:p1:inst-name-publish
        let speakers = self.publish_corrected(call_id, &plan.segments)?;
        // @cpt-end:cpt-noter-flow-core-speakers-audio-name:p1:inst-name-publish
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-name:p1:inst-name-return
        // @cpt-begin:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-return
        Ok(SpeakerMutation {
            speakers,
            change_id: written[0].change_id.clone(),
        })
        // @cpt-end:cpt-noter-algo-core-speakers-audio-correct:p1:inst-correct-return
        // @cpt-end:cpt-noter-flow-core-speakers-audio-name:p1:inst-name-return
    }

    // @cpt-flow:cpt-noter-flow-core-speakers-audio-term:p1
    pub(crate) fn fix_term(
        &self,
        ctx: &CommandCtx,
        args: FixTermArgs,
    ) -> Result<FixTermResult, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-term:p1:inst-term-request
        self.ready()?;
        // @cpt-end:cpt-noter-flow-core-speakers-audio-term:p1:inst-term-request
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-term:p1:inst-term-validate
        if args.replacement.trim().is_empty() {
            return Err(invalid("replacement", ValidationRule::Required));
        }
        let seg_id = args.segment_id.as_str().to_string();
        let row: Option<(String, String, String)> = self.store().read(move |c| {
            c.query_row(
                "SELECT call_id, text, corrections FROM segments WHERE id = ?1",
                [seg_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
        })?;
        let (owner, text, corrections) = row.ok_or_else(|| not_found("segment"))?;
        if owner != args.call_id.as_str() {
            return Err(belongs("segment_id"));
        }
        let TextRange { start, end } = args.range;
        let bounds = byte_of(&text, start).zip(byte_of(&text, end));
        let Some((b0, b1)) = bounds.filter(|(b0, b1)| b0 < b1) else {
            return Err(invalid("range", ValidationRule::OutOfRange));
        };
        let original = text[b0..b1].to_string();
        let fresh = units(&args.replacement);
        let shifted = i64::from(fresh) - i64::from(end - start);
        let mut kept: Vec<TermCorrection> = serde_json::from_str(&corrections).unwrap_or_default();
        // An earlier fix before this one stays, one after it moves with the text, one inside it goes.
        kept.retain(|k| k.range.end <= start || k.range.start >= end);
        for k in &mut kept {
            if k.range.start >= end {
                k.range.start = (i64::from(k.range.start) + shifted) as u32;
                k.range.end = (i64::from(k.range.end) + shifted) as u32;
            }
        }
        kept.push(TermCorrection {
            range: TextRange {
                start,
                end: start + fresh,
            },
            original: original.clone(),
        });
        kept.sort_by_key(|k| k.range.start);
        let new_text = format!("{}{}{}", &text[..b0], args.replacement, &text[b1..]);
        // @cpt-end:cpt-noter-flow-core-speakers-audio-term:p1:inst-term-validate
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-term:p1:inst-term-write
        let batch = BatchId::new(format!("bat_{}", ulid::Ulid::generate()));
        // shortcut: the glossary entry and the text commit in two transactions of one batch (the
        // glossary first, so a refused fix leaves nothing half-written but a taught term); one
        // transaction needs the glossary service to take a transaction.
        let term_id = if args.add_to_glossary {
            Some(self.teach(ctx, &args.replacement, &original, &batch)?)
        } else {
            None
        };
        let shadow = new_text.to_lowercase().replace('ё', "е").replace('ß', "ss");
        let mut meta = self.change_meta(ctx, "Fixed a term".into(), "term_fix");
        meta.batch_id = Some(batch);
        let written = self.store().write(
            Mutation {
                entity_type: "segment",
                table: "segments",
                id: args.segment_id.as_str().to_string(),
                base_rev: None,
                bump_rev: false,
                values: vec![
                    ("text", json!(new_text)),
                    ("text_norm", json!(shadow)),
                    (
                        "corrections",
                        json!(serde_json::to_string(&kept).unwrap_or_default()),
                    ),
                ],
            },
            meta,
        )?;
        // @cpt-end:cpt-noter-flow-core-speakers-audio-term:p1:inst-term-write
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-term:p1:inst-term-publish
        self.publish_corrected(&args.call_id, std::slice::from_ref(&args.segment_id))?;
        let call = args.call_id.clone();
        let wanted = args.segment_id.clone();
        let segment = self
            .store()
            .read(move |c| segments_of(c, &call, None))?
            .into_iter()
            .find(|s| s.id == wanted)
            .ok_or_else(|| not_found("segment"))?;
        // @cpt-end:cpt-noter-flow-core-speakers-audio-term:p1:inst-term-publish
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-term:p1:inst-term-reconcile
        // Nothing is queued before the jobs of M5 propose the term for earlier calls.
        let proposal_queued = false;
        // @cpt-end:cpt-noter-flow-core-speakers-audio-term:p1:inst-term-reconcile
        // @cpt-begin:cpt-noter-flow-core-speakers-audio-term:p1:inst-term-return
        Ok(FixTermResult {
            segment,
            change_id: written.change_id,
            glossary_term_id: term_id,
            proposal_queued,
        })
        // @cpt-end:cpt-noter-flow-core-speakers-audio-term:p1:inst-term-return
    }

    /// The glossary term for `term`, added with the misheard form as a variant if it is new.
    fn teach(
        &self,
        ctx: &CommandCtx,
        term: &str,
        heard: &str,
        batch: &BatchId,
    ) -> Result<GlossaryTermId, CoreError> {
        let term = term.trim();
        let find = |list: &GlossaryList| {
            list.terms
                .iter()
                .find(|t| t.term.to_lowercase() == term.to_lowercase())
                .map(|t| t.id.clone())
        };
        if let Some(id) = find(&self.glossary()?) {
            return Ok(id);
        }
        let cyrillic = heard.chars().any(|c| ('\u{400}'..='\u{4ff}').contains(&c));
        let variants = vec![heard.to_string()];
        let (latin, cyr) = if cyrillic {
            (vec![], variants)
        } else {
            (variants, vec![])
        };
        let list = self.upsert_term_in(
            ctx,
            GlossaryUpsertArgs {
                id: None,
                rev: None,
                term: term.to_string(),
                variants_latin: latin,
                variants_cyrillic: cyr,
                spoken_forms: vec![],
                lang: None,
                always_apply: false,
            },
            Some(batch.clone()),
        )?;
        find(&list).ok_or_else(|| internal("the taught term is missing"))
    }

    /// After a committed correction: the call file, the constraints, the open windows. A
    /// failure to write a file after the commit is logged; a window that missed an event catches
    /// up on its next read.
    fn publish_corrected(
        &self,
        call_id: &CallId,
        changed: &[SegmentId],
    ) -> Result<Vec<SpeakerView>, CoreError> {
        let id = call_id.as_str().to_string();
        let (speakers, segments) = self.store().read(move |c| {
            let all = segments_of(c, &CallId::new(&id), None)?;
            Ok((crate::library::speakers_of(c, &id)?, all))
        })?;
        let segments: Vec<SegmentView> = segments
            .into_iter()
            .filter(|s| changed.contains(&s.id))
            .collect();
        let files = self
            .write_transcript_file(call_id)
            .and_then(|()| self.write_constraints_file(call_id));
        if let Err(e) = files {
            self.log(object(json!({
                "level": "error", "module": "speakers", "code": "files", "message_len": e.message.len()
            })));
        }
        if !segments.is_empty() {
            self.publish_event(call_id, TranscriptEvent::SegmentsUpdated { segments });
        }
        self.publish_event(
            call_id,
            TranscriptEvent::SpeakersUpdated {
                speakers: speakers.clone(),
                relabelled_by_archive: false,
            },
        );
        self.emit_entity_changed(&EntityChanged::Speakers {
            call_id: call_id.clone(),
            speakers: speakers.clone(),
        });
        if let Some(call) = self.call_row(call_id.as_str())? {
            self.emit_entity_changed(&EntityChanged::Call { call });
        }
        Ok(speakers)
    }

    /// The constraints file the archive pass reads: what the user named and linked, with the
    /// call's languages and glossary.
    pub(crate) fn write_constraints_file(&self, call_id: &CallId) -> Result<(), CoreError> {
        let id = call_id.as_str().to_string();
        let (languages, links, names) = self.store().read(move |c| {
            let mut stmt = c.prepare(
                "SELECT lang FROM segments WHERE call_id = ?1 AND lang IS NOT NULL
                 GROUP BY lang ORDER BY min(t0_ms), lang",
            )?;
            let languages = stmt
                .query_map([&id], |r| {
                    r.get::<_, String>(0).map(crate::library::lang_of)
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let mut stmt = c.prepare(
                "SELECT kind, a_t0_ms, a_t1_ms, b_t0_ms, b_t1_ms FROM speaker_constraints
                 WHERE call_id = ?1 ORDER BY a_t0_ms, b_t0_ms",
            )?;
            let links = stmt
                .query_map([&id], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        [r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?],
                    ))
                })?
                .collect::<Result<Vec<(String, [u32; 4])>, _>>()?;
            let mut stmt = c.prepare(
                "SELECT label, name FROM speakers
                 WHERE call_id = ?1 AND pass = 'live' AND name IS NOT NULL",
            )?;
            let names = stmt
                .query_map([&id], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })?
                .collect::<Result<BTreeMap<_, _>, _>>()?;
            Ok((languages, links, names))
        })?;
        let link = |v: &[u32; 4]| SpanLink {
            a: EngineSpan {
                t0_ms: OffsetMs(v[0]),
                t1_ms: OffsetMs(v[1]),
            },
            b: EngineSpan {
                t0_ms: OffsetMs(v[2]),
                t1_ms: OffsetMs(v[3]),
            },
        };
        let of = |kind: &str| -> Vec<SpanLink> {
            links
                .iter()
                .filter(|(k, _)| k == kind)
                .map(|(_, v)| link(v))
                .collect()
        };
        let file = OfflineConstraints {
            languages,
            glossary: self
                .glossary()?
                .terms
                .into_iter()
                .map(|t| GlossaryEntry {
                    term: t.term,
                    variants_latin: t.variants_latin,
                    variants_cyrillic: t.variants_cyrillic,
                    spoken_forms: t.spoken_forms,
                })
                .collect(),
            // Voice profiles come with M3.
            speaker_priors: vec![],
            must_link: of("must_link"),
            cannot_link: of("cannot_link"),
            speaker_names: names,
        };
        let dir = self.call_dir(call_id);
        std::fs::create_dir_all(&dir).map_err(internal)?;
        let tmp = dir.join("constraints.json.tmp");
        let mut out = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(internal)?;
        let body: Value = serde_json::to_value(&file).map_err(internal)?;
        write!(out, "{body}").map_err(internal)?;
        out.sync_all().map_err(internal)?;
        std::fs::rename(&tmp, dir.join("constraints.json")).map_err(internal)
    }

    /// The batch a naming or term fix wrote when `change_id` is one of its rows: undo and redo
    /// take the whole action, as the handle the command returned promised.
    pub(crate) fn action_batch(&self, change_id: &ChangeId) -> Result<Option<BatchId>, CoreError> {
        let id = change_id.as_str().to_string();
        let row: Option<(Option<String>, String)> = self.store().read(move |c| {
            c.query_row(
                "SELECT batch_id, reason FROM changes WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
        })?;
        Ok(row
            .filter(|(_, reason)| ACTION_REASONS.contains(&reason.as_str()))
            .and_then(|(batch, _)| batch)
            .map(BatchId::new))
    }
}
