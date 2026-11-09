//! FEATURE cpt-noter-feature-core-people (slice 2): opt-in voice profiles. Centroids are 256-d
//! speaker embeddings, encrypted one by one with a Keychain-held key (TL-33), matched against
//! the archive pass's speakers (TL-40) and never logged, exported or returned.

use std::collections::{BTreeMap, HashMap};

use chacha20poly1305::aead::{Aead, Generate, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use noter_db::rusqlite::{params, Connection, OptionalExtension};
use noter_protocol::engine::EngineSpan;
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{Caller, CommandCtx};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Value};

use crate::people::{db, logged, new_id, not_found};
use crate::settings::invalid;
use crate::{internal, Core, KeychainLocked, Secret};

/// The Keychain account of the key that encrypts every centroid.
const KEY_ACCOUNT: &str = "voice-profile-key";
const DIMS: usize = 256;
const NONCE: usize = 12;
const TAG: usize = 16;
/// Cosine a speaker needs to take a name, and the lead it needs over the runner-up.
const THRESHOLD: f32 = 0.75;
const MARGIN: f32 = 0.05;
/// A profile unused this long stops matching until it is refreshed.
pub(crate) const DECAY_MS: i64 = 90 * 86_400_000;
/// Samples this close join one centroid; a person keeps at most `MAX_CENTROIDS` per device.
const JOIN: f32 = 0.8;
const MAX_CENTROIDS: usize = 3;
/// The longest spans an engine embedding reads.
const EMBED_SPANS: usize = 20;

/// Decrypted vectors, wiped when they go out of scope (inst-match-return).
struct Wiped(Vec<Vec<f32>>);

impl Drop for Wiped {
    fn drop(&mut self) {
        for v in &mut self.0 {
            v.fill(0.0);
        }
        std::hint::black_box(&self.0);
    }
}

struct SecretKey(Key);

impl Drop for SecretKey {
    fn drop(&mut self) {
        self.0.fill(0);
        std::hint::black_box(&self.0);
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(text: &str) -> Option<Key> {
    if text.len() != 64 || !text.is_ascii() {
        return None;
    }
    let bytes = (0..32)
        .map(|i| u8::from_str_radix(&text[2 * i..2 * i + 2], 16).ok())
        .collect::<Option<Vec<u8>>>()?;
    Key::try_from(bytes.as_slice()).ok()
}

fn locked(_: KeychainLocked) -> CoreError {
    CoreError::new(ErrorCode::KeychainLocked, "the Keychain is locked")
}

fn usable(v: &[f32]) -> bool {
    v.len() == DIMS && v.iter().all(|x| x.is_finite()) && v.iter().any(|x| *x != 0.0)
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm = |v: &[f32]| v.iter().map(|x| x * x).sum::<f32>().sqrt();
    let (na, nb) = (norm(a), norm(b));
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na * nb)
    }
}

fn unit(v: &mut [f32]) {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n > 0.0 {
        v.iter_mut().for_each(|x| *x /= n);
    }
}

/// One stored centroid before it is encrypted.
struct Centroid {
    device: String,
    vector: Vec<f32>,
    samples: u32,
}

// @cpt-begin:cpt-noter-algo-core-people-profile-match:p1:inst-match-build
/// Leader clustering per device: a sample joins the first centroid within `JOIN` cosine, else
/// starts one (the nearest when the person already has `MAX_CENTROIDS`).
fn cluster(samples: &[(String, Vec<f32>)]) -> Vec<Centroid> {
    let mut by_device: BTreeMap<&str, Vec<(Vec<f32>, u32)>> = BTreeMap::new();
    for (device, sample) in samples {
        let mut v = sample.clone();
        unit(&mut v);
        let groups = by_device.entry(device).or_default();
        let best = groups
            .iter()
            .enumerate()
            .map(|(i, (c, _))| (i, cosine(c, &v)))
            .max_by(|a, b| a.1.total_cmp(&b.1));
        match best {
            Some((i, s)) if s >= JOIN || groups.len() >= MAX_CENTROIDS => {
                let (sum, n) = &mut groups[i];
                sum.iter_mut().zip(&v).for_each(|(a, b)| *a += b);
                unit(sum);
                *n += 1;
            }
            _ => groups.push((v, 1)),
        }
    }
    by_device
        .into_iter()
        .flat_map(|(device, groups)| {
            groups.into_iter().map(move |(vector, samples)| Centroid {
                device: device.to_string(),
                vector,
                samples,
            })
        })
        .collect()
}
// @cpt-end:cpt-noter-algo-core-people-profile-match:p1:inst-match-build

/// A person's best-scoring profile for one voice.
#[derive(Clone)]
struct Score {
    person: String,
    profile: String,
    cosine: f32,
}

// @cpt-begin:cpt-noter-algo-core-people-profile-match:p1:inst-match-score
/// The match, when the best score reaches the threshold with a margin over the runner-up.
fn verdict(mut scores: Vec<Score>) -> Option<Score> {
    scores.sort_by(|a, b| b.cosine.total_cmp(&a.cosine));
    let mut it = scores.into_iter();
    let best = it.next().filter(|s| s.cosine >= THRESHOLD)?;
    match it.next() {
        Some(second) if best.cosine - second.cosine < MARGIN => None,
        _ => Some(best),
    }
}
// @cpt-end:cpt-noter-algo-core-people-profile-match:p1:inst-match-score

/// One stored profile row, still encrypted.
struct Row {
    id: String,
    person: String,
    blob: Vec<u8>,
}

fn live_profiles(c: &Connection, now: i64) -> noter_db::rusqlite::Result<Vec<Row>> {
    // @cpt-begin:cpt-noter-algo-core-people-profile-match:p1:inst-match-optin
    // @cpt-begin:cpt-noter-state-core-people-profile:p1:inst-state-decayed
    // A person without the opt-in, or a profile unused for 90 days, never contributes.
    c.prepare(
        "SELECT v.id, v.person_id, v.embedding FROM voice_profiles v
         JOIN people p ON p.id = v.person_id
         WHERE p.voice_profile_optin = 1 AND ?1 - v.last_used_at <= ?2 ORDER BY v.rowid",
    )?
    .query_map(params![now, DECAY_MS], |r| {
        Ok(Row {
            id: r.get(0)?,
            person: r.get(1)?,
            blob: r.get(2)?,
        })
    })?
    .collect()
    // @cpt-end:cpt-noter-state-core-people-profile:p1:inst-state-decayed
    // @cpt-end:cpt-noter-algo-core-people-profile-match:p1:inst-match-optin
}

/// A read whose closure fails with a `CoreError` of its own (the closure's `?` on `db(..)`).
pub(crate) fn rd<T>(
    s: &noter_db::Store,
    f: impl FnOnce(&Connection) -> Result<T, CoreError>,
) -> Result<T, CoreError> {
    s.read(|c| Ok(f(c)))?
}

/// The columns of a person a profile write reads.
fn optin_of(c: &Connection, person: &str) -> Result<(u32, bool, Option<i64>), CoreError> {
    db(c.query_row(
        "SELECT rev, voice_profile_optin, optin_date FROM people WHERE id = ?1",
        [person],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )
    .optional())?
    .ok_or_else(not_found)
}

fn view_of(c: &Connection, person: &str, now: i64) -> Result<VoiceProfileView, CoreError> {
    let (_, optin, date) = optin_of(c, person)?;
    let (count, newest): (u32, Option<i64>) = db(c.query_row(
        "SELECT count(*), max(last_used_at) FROM voice_profiles WHERE person_id = ?1",
        [person],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ))?;
    Ok(VoiceProfileView {
        person_id: PersonId::new(person.to_string()),
        enabled: optin && newest.is_some_and(|t| now - t <= DECAY_MS),
        centroids: count,
        opted_in_at: date.filter(|_| optin).map(TimestampMs),
    })
}

/// A speaker's archive voice: the row, its call and its stored embedding, if any.
struct Voice {
    id: String,
    call: String,
    channel: AudioChannel,
    blob: Option<Vec<u8>>,
}

fn channel_of(word: &str) -> AudioChannel {
    if word == "mic" {
        AudioChannel::Mic
    } else {
        AudioChannel::Sys
    }
}

fn device_of(channel: AudioChannel) -> &'static str {
    match channel {
        AudioChannel::Mic => "mic",
        AudioChannel::Sys => "system",
    }
}

/// The context of the writes the core itself makes (matching, embeddings).
fn job_meta(core: &Core, summary: &str, reason: &str) -> noter_db::ChangeMeta {
    let ctx = CommandCtx {
        caller: Caller::Window {
            label: WindowLabel::Main,
        },
    };
    let mut meta = core.change_meta(&ctx, summary.into(), reason);
    meta.actor = Actor::Job {
        job_id: JobId::new("job_voice_profiles"),
        name: "voice profiles".into(),
    };
    meta
}

/// What a write raises to abort without a change row: something it relied on is gone.
fn stale() -> CoreError {
    CoreError::new(ErrorCode::NotFound, "a deletion won over this write")
}

// @cpt-dod:cpt-noter-dod-core-people-profiles:p4
impl Core {
    /// The encryption key; created on the first profile when `create`, never stored in plain
    /// text: a locked Keychain is `keychain_locked` and nothing is written (TL-33).
    // @cpt-begin:cpt-noter-algo-core-people-profile-match:p1:inst-match-encrypt
    fn voice_key(&self, create: bool) -> Result<Option<SecretKey>, CoreError> {
        if let Some(secret) = self.deps.secrets.get(KEY_ACCOUNT).map_err(locked)? {
            return unhex(secret.expose())
                .map(|k| Some(SecretKey(k)))
                .ok_or_else(|| internal("the voice profile key is unreadable"));
        }
        if !create {
            return Ok(None);
        }
        let fresh = Key::generate();
        self.deps
            .secrets
            .set(KEY_ACCOUNT, &Secret::new(hex(&fresh)))
            .map_err(locked)?;
        Ok(Some(SecretKey(fresh)))
    }

    /// `nonce || ciphertext` of the little-endian floats.
    fn seal(key: &SecretKey, vector: &[f32]) -> Result<Vec<u8>, CoreError> {
        let cipher = ChaCha20Poly1305::new(&key.0);
        let nonce = Nonce::generate();
        let mut plain: Vec<u8> = vector.iter().flat_map(|x| x.to_le_bytes()).collect();
        let sealed = cipher.encrypt(&nonce, plain.as_slice());
        plain.fill(0);
        let mut out = nonce.to_vec();
        out.extend(sealed.map_err(|_| internal("a centroid could not be encrypted"))?);
        Ok(out)
    }
    // @cpt-end:cpt-noter-algo-core-people-profile-match:p1:inst-match-encrypt

    /// The vector a blob holds, `None` when it is not one of ours or not usable.
    fn open_blob(key: &SecretKey, blob: &[u8]) -> Option<Vec<f32>> {
        if blob.len() != NONCE + DIMS * 4 + TAG {
            return None;
        }
        let cipher = ChaCha20Poly1305::new(&key.0);
        let mut plain = cipher
            .decrypt(&Nonce::try_from(&blob[..NONCE]).ok()?, &blob[NONCE..])
            .ok()?;
        let vector: Vec<f32> = plain
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect();
        plain.fill(0);
        usable(&vector).then_some(vector)
    }

    /// For the harness and tests: a centroid as the core stores one.
    pub(crate) fn seal_centroid(&self, vector: &[f32]) -> Result<Vec<u8>, CoreError> {
        let key = self.voice_key(true)?.ok_or_else(|| internal("no key"))?;
        Self::seal(&key, vector)
    }

    /// The embedding the engine reads from a speaker's longest archive spans.
    async fn embed_voice(&self, voice: &Voice) -> Option<Vec<f32>> {
        let id = voice.id.clone();
        let mut spans: Vec<(i64, i64)> = self
            .store()
            .read(move |c| {
                c.prepare("SELECT t0_ms, t1_ms FROM segments WHERE speaker_id = ?1")?
                    .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?
                    .collect::<Result<_, _>>()
            })
            .ok()?;
        spans.sort_by_key(|(a, b)| std::cmp::Reverse(b - a));
        spans.truncate(EMBED_SPANS);
        let spans: Vec<EngineSpan> = spans
            .into_iter()
            .filter(|(a, b)| a < b)
            .filter_map(|(a, b)| {
                Some(EngineSpan {
                    t0_ms: OffsetMs(u32::try_from(a).ok()?),
                    t1_ms: OffsetMs(u32::try_from(b).ok()?),
                })
            })
            .collect();
        if spans.is_empty() {
            return None;
        }
        let request = format!("req_{}", ulid::Ulid::generate());
        let out = format!("audio/{}/emb-{}.bin", voice.call, ulid::Ulid::generate());
        let call = CallId::new(voice.call.clone());
        self.engine
            .speaker_embedding(request, call, voice.channel, spans, out)
            .await
            .ok()
            .filter(|v| usable(v))
    }

    // @cpt-flow:cpt-noter-flow-core-people-profile:p1
    // @cpt-state:cpt-noter-state-core-people-profile:p1
    pub(crate) async fn create_voice_profile(
        &self,
        ctx: &CommandCtx,
        args: VoiceProfileArgs,
    ) -> Result<VoiceProfileView, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-people-profile:p1:inst-profile-request
        let person = args.person_id.as_str().to_string();
        let seed = args.from_speaker.map(|s| s.as_str().to_string());
        // @cpt-end:cpt-noter-flow-core-people-profile:p1:inst-profile-request
        // @cpt-begin:cpt-noter-flow-core-people-profile:p1:inst-profile-samples
        // @cpt-begin:cpt-noter-state-core-people-profile:p1:inst-state-build
        let who = person.clone();
        let voices: Vec<Voice> = rd(self.store(), move |c| {
            optin_of(c, &who)?;
            let sql = "SELECT s.id, s.call_id, s.channel, s.centroid, s.person_id FROM speakers s";
            let map = |r: &noter_db::rusqlite::Row<'_>| {
                Ok((
                    Voice {
                        id: r.get(0)?,
                        call: r.get(1)?,
                        channel: channel_of(&r.get::<_, String>(2)?),
                        blob: r.get(3)?,
                    },
                    r.get::<_, Option<String>>(4)?,
                ))
            };
            match &seed {
                Some(id) => {
                    let row = db(c
                        .query_row(&format!("{sql} WHERE s.id = ?1"), [id], map)
                        .optional())?;
                    let (voice, owner) = row.ok_or_else(not_found)?;
                    // A seed owned by someone else, or by no one, is not this person's voice.
                    if owner.as_deref() != Some(who.as_str()) {
                        return Err(invalid("from_speaker", ValidationRule::OutOfRange));
                    }
                    Ok(vec![voice])
                }
                None => {
                    let mut q = db(c.prepare(&format!(
                        "{sql} WHERE s.person_id = ?1 ORDER BY s.pass = 'archive' DESC, s.rowid"
                    )))?;
                    let rows = db(q.query_map([&who], map))?;
                    let all: Vec<(Voice, Option<String>)> = db(rows.collect())?;
                    Ok(all.into_iter().map(|(v, _)| v).collect())
                }
            }
        })?;
        // A locked Keychain refuses here, before anything is derived or stored.
        let key = self.voice_key(true)?.ok_or_else(|| internal("no key"))?;
        let mut samples = Vec::new();
        for voice in &voices {
            let stored = voice.blob.as_deref().and_then(|b| Self::open_blob(&key, b));
            let vector = match stored {
                Some(v) => Some(v),
                None => self.embed_voice(voice).await,
            };
            if let Some(v) = vector {
                samples.push((device_of(voice.channel).to_string(), v));
            }
        }
        // @cpt-end:cpt-noter-state-core-people-profile:p1:inst-state-build
        // @cpt-end:cpt-noter-flow-core-people-profile:p1:inst-profile-samples
        // @cpt-begin:cpt-noter-state-core-people-profile:p1:inst-state-failed
        // No usable voice: nothing is stored and the person stays without a profile.
        if samples.is_empty() {
            return Err(invalid("from_speaker", ValidationRule::OutOfRange));
        }
        // @cpt-end:cpt-noter-state-core-people-profile:p1:inst-state-failed
        // @cpt-begin:cpt-noter-flow-core-people-profile:p1:inst-profile-create
        let mut centroids = cluster(&samples);
        let sealed: Result<Vec<(String, Vec<u8>, u32)>, CoreError> = centroids
            .iter()
            .map(|c| Self::seal(&key, &c.vector).map(|b| (c.device.clone(), b, c.samples)))
            .collect();
        let _wipe = Wiped(
            samples
                .into_iter()
                .map(|(_, v)| v)
                .chain(centroids.drain(..).map(|c| c.vector))
                .collect(),
        );
        let sealed = sealed?;
        let now = self.deps.clock.now().0;
        let mut meta = self.change_meta(
            ctx,
            "Created a voice profile".into(),
            "voice_profile_create",
        );
        // Never undoable: an undo would have to carry the biometric blobs.
        meta.undoable = false;
        let target = person.clone();
        // @cpt-begin:cpt-noter-algo-core-people-profile-match:p1:inst-match-recheck
        // @cpt-begin:cpt-noter-state-core-people-profile:p1:inst-state-enabled
        // @cpt-begin:cpt-noter-state-core-people-profile:p1:inst-state-refreshed
        self.store().write_with(meta, move |tx| {
            // The person is read again inside the transaction: a deletion that won is `not_found`.
            let (rev, was, was_date) = optin_of(tx, &target)?;
            db(tx.execute("DELETE FROM voice_profiles WHERE person_id = ?1", [&target]))?;
            for (device, blob, n) in &sealed {
                db(tx.execute(
                    "INSERT INTO voice_profiles
                       (id, person_id, embedding, device_hint, sample_count, last_used_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![new_id("vp"), target, blob, device, n, now],
                ))?;
            }
            let date = was_date.filter(|_| was).unwrap_or(now);
            db(tx.execute(
                "UPDATE people SET rev = rev + 1, voice_profile_optin = 1, optin_date = ?1
                 WHERE id = ?2",
                params![date, target],
            ))?;
            // Only the flag and its date: a change row never holds a centroid.
            let row = logged(
                "person",
                &target,
                vec![
                    ("rev", json!(rev), json!(rev + 1)),
                    ("voice_profile_optin", json!(i32::from(was)), json!(1)),
                    ("optin_date", json!(was_date), json!(date)),
                ],
            );
            Ok(((), vec![row]))
        })?;
        // @cpt-end:cpt-noter-state-core-people-profile:p1:inst-state-refreshed
        // @cpt-end:cpt-noter-state-core-people-profile:p1:inst-state-enabled
        // @cpt-end:cpt-noter-algo-core-people-profile-match:p1:inst-match-recheck
        // @cpt-end:cpt-noter-flow-core-people-profile:p1:inst-profile-create
        // @cpt-begin:cpt-noter-flow-core-people-profile:p1:inst-profile-created
        self.publish_person(&person)?;
        rd(self.store(), move |c| view_of(c, &person, now))
        // @cpt-end:cpt-noter-flow-core-people-profile:p1:inst-profile-created
    }

    pub(crate) fn delete_voice_profile(
        &self,
        ctx: &CommandCtx,
        args: PersonIdArgs,
    ) -> Result<VoiceProfileView, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-people-profile:p1:inst-profile-delete
        // @cpt-begin:cpt-noter-state-core-people-profile:p1:inst-state-deleted
        let person = args.person_id.as_str().to_string();
        let mut meta = self.change_meta(
            ctx,
            "Deleted a voice profile".into(),
            "voice_profile_delete",
        );
        meta.undoable = false;
        let target = person.clone();
        // One transaction: the opt-in and every centroid go together; speaker names stay.
        self.store().write_with(meta, move |tx| {
            let (rev, was, was_date) = optin_of(tx, &target)?;
            db(tx.execute("DELETE FROM voice_profiles WHERE person_id = ?1", [&target]))?;
            db(tx.execute(
                "UPDATE people SET rev = rev + 1, voice_profile_optin = 0, optin_date = NULL
                 WHERE id = ?1",
                [&target],
            ))?;
            let row = logged(
                "person",
                &target,
                vec![
                    ("rev", json!(rev), json!(rev + 1)),
                    ("voice_profile_optin", json!(i32::from(was)), json!(0)),
                    ("optin_date", json!(was_date), Value::Null),
                ],
            );
            Ok(((), vec![row]))
        })?;
        // @cpt-end:cpt-noter-state-core-people-profile:p1:inst-state-deleted
        // @cpt-end:cpt-noter-flow-core-people-profile:p1:inst-profile-delete
        // @cpt-begin:cpt-noter-flow-core-people-profile:p1:inst-profile-deleted
        // A match in flight rechecks the opt-in and its profile row when it commits, so the
        // deletion wins; no cache outlives the rows.
        self.publish_person(&person)?;
        let now = self.deps.clock.now().0;
        rd(self.store(), move |c| view_of(c, &person, now))
        // @cpt-end:cpt-noter-flow-core-people-profile:p1:inst-profile-deleted
    }

    /// Stores an embedding for each sys-channel speaker of the call still without one, once a
    /// person has opted in: before that nothing biometric is derived.
    pub(crate) async fn embed_archive_speakers(&self, call: &CallId) -> Result<(), CoreError> {
        let id = call.as_str().to_string();
        let voices: Vec<Voice> = rd(self.store(), move |c| {
            let any: bool = db(c.query_row(
                "SELECT EXISTS (SELECT 1 FROM people WHERE voice_profile_optin = 1)",
                [],
                |r| r.get(0),
            ))?;
            if !any {
                return Ok(vec![]);
            }
            let mut q = db(c.prepare(
                "SELECT id, call_id, channel FROM speakers
                 WHERE call_id = ?1 AND pass = 'archive' AND channel = 'sys' AND centroid IS NULL",
            ))?;
            let rows = db(q.query_map([id], |r| {
                Ok(Voice {
                    id: r.get(0)?,
                    call: r.get(1)?,
                    channel: channel_of(&r.get::<_, String>(2)?),
                    blob: None,
                })
            }))?;
            db(rows.collect())
        })?;
        if voices.is_empty() {
            return Ok(());
        }
        let Some(key) = self.voice_key(false)? else {
            return Ok(());
        };
        for voice in &voices {
            let Some(mut vector) = self.embed_voice(voice).await else {
                continue;
            };
            let blob = Self::seal(&key, &vector)?;
            vector.fill(0.0);
            let speaker = voice.id.clone();
            // The change row names the speaker only: the blob stays in its column.
            let meta = {
                let mut m = job_meta(self, "Stored a speaker voice", "speaker_embedding");
                m.undoable = false;
                m
            };
            self.store().write_with(meta, move |tx| {
                let n = db(tx.execute(
                    "UPDATE speakers SET centroid = ?1 WHERE id = ?2",
                    params![blob, speaker],
                ))?;
                if n == 0 {
                    return Err(stale());
                }
                Ok(((), vec![logged("speaker", &speaker, vec![])]))
            })?;
        }
        Ok(())
    }

    // @cpt-algo:cpt-noter-algo-core-people-profile-match:p1
    /// Names the call's unnamed archive speakers whose voice matches an opted-in profile;
    /// returns how many were named.
    pub(crate) fn match_profiles(&self, call: &CallId) -> Result<usize, CoreError> {
        let now = self.deps.clock.now().0;
        let id = call.as_str().to_string();
        let (speakers, profiles, attendees) = rd(self.store(), move |c| {
            let speakers: Vec<(String, Vec<u8>)> = c
                .prepare(
                    "SELECT id, centroid FROM speakers WHERE call_id = ?1 AND pass = 'archive'
                       AND person_id IS NULL AND centroid IS NOT NULL ORDER BY rowid",
                )
                .and_then(|mut q| {
                    q.query_map([&id], |r| Ok((r.get(0)?, r.get(1)?)))?
                        .collect()
                })
                .map_err(internal)?;
            let attendees: Vec<String> = c
                .prepare("SELECT person_id FROM call_participants WHERE call_id = ?1")
                .and_then(|mut q| q.query_map([&id], |r| r.get(0))?.collect())
                .map_err(internal)?;
            Ok((
                speakers,
                live_profiles(c, now).map_err(internal)?,
                attendees,
            ))
        })?;
        if speakers.is_empty() || profiles.is_empty() {
            return Ok(0);
        }
        let Some(key) = self.voice_key(false)? else {
            return Ok(0);
        };
        let mut vectors = Wiped(Vec::new());
        let mut owners: Vec<(&str, &str)> = Vec::new();
        for row in &profiles {
            if let Some(v) = Self::open_blob(&key, &row.blob) {
                vectors.0.push(v);
                owners.push((&row.person, &row.id));
            }
        }
        let mut named = 0;
        for (speaker, blob) in &speakers {
            let Some(mut mine) = Self::open_blob(&key, blob) else {
                continue;
            };
            let mut best: HashMap<&str, Score> = HashMap::new();
            for (v, (person, profile)) in vectors.0.iter().zip(&owners) {
                let c = cosine(&mine, v);
                if best.get(person).map_or(true, |s| c > s.cosine) {
                    best.insert(
                        person,
                        Score {
                            person: (*person).to_string(),
                            profile: (*profile).to_string(),
                            cosine: c,
                        },
                    );
                }
            }
            mine.fill(0.0);
            // Attendees first: only without a verdict among them do the others get a say.
            let narrowed: Vec<Score> = best
                .values()
                .filter(|s| attendees.contains(&s.person))
                .cloned()
                .collect();
            let choice = verdict(narrowed).or_else(|| verdict(best.into_values().collect()));
            if let Some(score) = choice {
                if self.commit_match(call, speaker, &score, now)? {
                    named += 1;
                }
            }
        }
        // @cpt-begin:cpt-noter-algo-core-people-profile-match:p1:inst-match-return
        // The decrypted vectors and the key are wiped as they drop here.
        Ok(named)
        // @cpt-end:cpt-noter-algo-core-people-profile-match:p1:inst-match-return
    }

    /// The suggestion for an unnamed speaker: the best profile at or above the threshold.
    pub(crate) fn suggest_for(&self, speaker: &str) -> Option<PersonChip> {
        let now = self.deps.clock.now().0;
        let id = speaker.to_string();
        let (blob, profiles) = rd(self.store(), move |c| {
            let blob: Option<Vec<u8>> = c
                .query_row("SELECT centroid FROM speakers WHERE id = ?1", [&id], |r| {
                    r.get(0)
                })
                .optional()
                .map_err(internal)?
                .flatten();
            Ok((blob, live_profiles(c, now).map_err(internal)?))
        })
        .ok()?;
        let blob = blob?;
        if profiles.is_empty() {
            return None;
        }
        let key = self.voice_key(false).ok().flatten()?;
        let mut mine = Self::open_blob(&key, &blob)?;
        let mut vectors = Wiped(Vec::new());
        let mut owners = Vec::new();
        for row in &profiles {
            if let Some(v) = Self::open_blob(&key, &row.blob) {
                vectors.0.push(v);
                owners.push(&row.person);
            }
        }
        let best = vectors
            .0
            .iter()
            .zip(owners)
            .map(|(v, p)| (cosine(&mine, v), p))
            .filter(|(c, _)| *c >= THRESHOLD)
            .max_by(|a, b| a.0.total_cmp(&b.0));
        mine.fill(0.0);
        let person = best?.1.clone();
        self.store()
            .read(move |c| crate::people::chip_of(c, &person))
            .ok()
            .flatten()
    }

    /// Commits one match after rechecking everything it relies on; `false` when a deletion,
    /// an opt-out or a user's naming won in the meantime.
    // @cpt-begin:cpt-noter-algo-core-people-profile-match:p1:inst-match-used
    fn commit_match(
        &self,
        call: &CallId,
        speaker: &str,
        score: &Score,
        now: i64,
    ) -> Result<bool, CoreError> {
        let meta = job_meta(self, "Named a speaker by voice", "voice_profile_match");
        let (speaker, person, profile) = (
            speaker.to_string(),
            score.person.clone(),
            score.profile.clone(),
        );
        // @cpt-begin:cpt-noter-algo-core-people-profile-match:p1:inst-match-recheck
        let done = self.store().write_with(meta, move |tx| {
            let ok: bool = tx
                .query_row(
                    "SELECT EXISTS (
                       SELECT 1 FROM people p JOIN voice_profiles v ON v.person_id = p.id
                       WHERE p.id = ?1 AND p.voice_profile_optin = 1 AND v.id = ?2
                         AND ?3 - v.last_used_at <= ?4)
                     AND EXISTS (SELECT 1 FROM speakers WHERE id = ?5 AND person_id IS NULL)",
                    params![person, profile, now, DECAY_MS, speaker],
                    |r| r.get(0),
                )
                .map_err(internal)?;
            if !ok {
                return Err(stale());
            }
            let last: i64 = tx
                .query_row(
                    "SELECT last_used_at FROM voice_profiles WHERE id = ?1",
                    [&profile],
                    |r| r.get(0),
                )
                .map_err(internal)?;
            db(tx.execute(
                "UPDATE speakers SET person_id = ?1, named_by = 'voice_profile' WHERE id = ?2",
                params![person, speaker],
            ))?;
            db(tx.execute(
                "UPDATE voice_profiles SET last_used_at = ?1 WHERE id = ?2",
                params![now, profile],
            ))?;
            Ok((
                (),
                vec![
                    logged(
                        "speaker",
                        &speaker,
                        vec![
                            ("person_id", Value::Null, json!(person)),
                            ("named_by", Value::Null, json!("voice_profile")),
                        ],
                    ),
                    logged(
                        "voice_profile",
                        &profile,
                        vec![("last_used_at", json!(last), json!(now))],
                    ),
                ],
            ))
        });
        // @cpt-end:cpt-noter-algo-core-people-profile-match:p1:inst-match-recheck
        match done {
            Ok(_) => {
                self.sync_participants(call)?;
                Ok(true)
            }
            Err(e) if e.code == ErrorCode::NotFound => Ok(false),
            Err(e) => Err(e),
        }
    }
    // @cpt-end:cpt-noter-algo-core-people-profile-match:p1:inst-match-used
}

#[cfg(test)]
mod tests {
    use super::*;

    // Sealed by chacha20poly1305 0.10.1 (key 00..1f, nonce 64..6f): centroids stored before the
    // 0.11 update must still open.
    const SEALED_BY_0_10: &str = include_str!("../tests/data/centroid-chacha20poly1305-0.10.hex");

    fn golden_key() -> SecretKey {
        SecretKey(unhex(&hex(&(0u8..32).collect::<Vec<_>>())).unwrap())
    }

    #[test]
    fn a_centroid_sealed_before_the_update_still_opens() {
        let text = SEALED_BY_0_10.trim();
        let blob: Vec<u8> = (0..text.len() / 2)
            .map(|i| u8::from_str_radix(&text[2 * i..2 * i + 2], 16).unwrap())
            .collect();
        let expected: Vec<f32> = (0..DIMS).map(|i| i as f32 / 256.0 - 0.5).collect();
        assert_eq!(Core::open_blob(&golden_key(), &blob), Some(expected));
    }

    #[test]
    fn a_sealed_centroid_opens_and_each_seal_takes_a_new_nonce() {
        let key = golden_key();
        let vector: Vec<f32> = (0..DIMS).map(|i| i as f32 + 1.0).collect();
        let (a, b) = (
            Core::seal(&key, &vector).unwrap(),
            Core::seal(&key, &vector).unwrap(),
        );
        assert_ne!(a[..NONCE], b[..NONCE]);
        assert_eq!(Core::open_blob(&key, &a), Some(vector));
    }
}
