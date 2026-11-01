//! Chunks of a call's active transcript and their local embeddings
//! (`cpt-noter-algo-core-postcall-chunks`): about 200–300 tokens each along segment boundaries,
//! under a call header and with speaker prefixes, embedded by the engine's bge-m3 for M3's
//! retrieval. The chunks are a derived index: one logged, non-undoable change per write.

use noter_db::rusqlite::params;
use noter_db::Logged;
use noter_jobs::{RunCtx, Stop};
use noter_protocol::*;
use serde_json::json;

use crate::{object, Core};

const MIN_TOKENS: usize = 200;
const MAX_TOKENS: usize = 300;
/// Texts per `embed_texts` request.
const EMBED_BATCH: usize = 32;
/// Chunks per writer transaction (the scheduler's batch bound).
const WRITE_BATCH: usize = 200;
const DIMS: usize = 1024;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Chunk {
    pub t0_ms: i64,
    pub t1_ms: i64,
    pub text: String,
    pub token_count: usize,
}

/// What a chunking pass left: how many chunks, and whether every one has its embedding.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Indexed {
    pub chunks: usize,
    pub embedded: bool,
}

/// shortcut: about four tokens per three words, not the bge-m3 tokenizer; retrieval (M3) counts
/// with the real one.
fn tokens(text: &str) -> usize {
    (text.split_whitespace().count() * 4).div_ceil(3)
}

// @cpt-algo:cpt-noter-algo-core-postcall-chunks:p1
/// Ordered lines `(t0, t1, "Speaker: text")` grouped into chunks under `header`.
pub(crate) fn group(header: &str, lines: &[(i64, i64, String)]) -> Vec<Chunk> {
    // @cpt-begin:cpt-noter-algo-core-postcall-chunks:p1:inst-chunk-group
    let mut out = vec![];
    let mut open: Vec<&(i64, i64, String)> = vec![];
    let mut n = 0;
    let close = |open: &[&(i64, i64, String)]| {
        let body: Vec<&str> = open.iter().map(|l| l.2.as_str()).collect();
        let text = format!("{header}\n{}", body.join("\n"));
        // @cpt-begin:cpt-noter-algo-core-postcall-chunks:p1:inst-chunk-normalize
        Chunk {
            t0_ms: open[0].0,
            t1_ms: open.iter().map(|l| l.1).max().unwrap_or(open[0].1),
            token_count: tokens(&text),
            text,
        }
        // @cpt-end:cpt-noter-algo-core-postcall-chunks:p1:inst-chunk-normalize
    };
    for line in lines {
        let t = tokens(&line.2);
        if !open.is_empty() && (n >= MAX_TOKENS || (n >= MIN_TOKENS && n + t > MAX_TOKENS)) {
            out.push(close(&open));
            open.clear();
            n = 0;
        }
        open.push(line);
        n += t;
    }
    if !open.is_empty() {
        out.push(close(&open));
    }
    out
    // @cpt-end:cpt-noter-algo-core-postcall-chunks:p1:inst-chunk-group
}

/// A chunk's embedding as the `embedding` column keeps it: float32, little-endian.
fn blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|x| x.to_le_bytes()).collect()
}

impl Core {
    /// Re-chunks the call's active transcript and embeds the chunks; replaces the call's chunks.
    /// An embedding failure keeps the chunks without vectors, is logged and is not an error of
    /// the run: the transcript and the sections stay usable, and the next pass embeds again.
    pub(crate) async fn rechunk(&self, ctx: &mut RunCtx, call: &CallId) -> Result<Indexed, Stop> {
        let id = call.clone();
        let (header, lines) = self.store().read(move |c| {
            let header: Option<(String, String, i64)> = c
                .query_row(
                    "SELECT title, call_type, started_at FROM calls WHERE id = ?1",
                    [id.as_str()],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .ok();
            let lines: Vec<(i64, i64, String)> = crate::transcript::segments_of(c, &id, None)?
                .into_iter()
                .map(|s| {
                    let who = crate::postcall::speaker_name(&s.speaker.label);
                    (
                        i64::from(s.t0_ms.0),
                        i64::from(s.t1_ms.0),
                        format!("{who}: {}", s.text),
                    )
                })
                .collect();
            Ok((header, lines))
        })?;
        let Some((title, call_type, started)) = header else {
            return Ok(Indexed {
                chunks: 0,
                embedded: true,
            });
        };
        let chunks = group(&format!("Call: {title} · {call_type} · {started}"), &lines);
        ctx.checkpoint().await?;
        // @cpt-begin:cpt-noter-algo-core-postcall-chunks:p1:inst-chunk-embed
        let vectors = self.embed(call, &chunks).await;
        // @cpt-end:cpt-noter-algo-core-postcall-chunks:p1:inst-chunk-embed
        // @cpt-begin:cpt-noter-algo-core-postcall-chunks:p1:inst-chunk-fail
        let embedded = vectors.is_ok();
        if let Err(e) = &vectors {
            self.log(object(json!({
                "level": "warn", "module": "postcall", "code": "embedding_failed",
                "message_len": e.len()
            })));
        }
        let vectors = vectors.unwrap_or_default();
        // @cpt-end:cpt-noter-algo-core-postcall-chunks:p1:inst-chunk-fail
        // @cpt-begin:cpt-noter-algo-core-postcall-chunks:p1:inst-chunk-store
        // shortcut: no `chunk_vec` or FTS rows yet: M3 builds both from these columns.
        let mut first = true;
        let total = chunks.len();
        let mut rows = chunks.into_iter().enumerate().peekable();
        while first || rows.peek().is_some() {
            ctx.checkpoint().await?;
            let batch: Vec<(Chunk, Option<Vec<u8>>)> = rows
                .by_ref()
                .take(WRITE_BATCH)
                .map(|(n, c)| (c, vectors.get(n).map(|v| blob(v))))
                .collect();
            let meta = ctx.change_meta("chunks").ok_or(Stop::Cancelled)?;
            let call_id = call.as_str().to_owned();
            let replace = std::mem::take(&mut first);
            self.store().write_with(meta, move |tx| {
                let internal =
                    |e: noter_db::rusqlite::Error| CoreError::new(ErrorCode::Internal, e.to_string());
                if replace {
                    tx.execute("DELETE FROM chunks WHERE call_id = ?1", [&call_id])
                        .map_err(internal)?;
                }
                for (c, embedding) in &batch {
                    tx.execute(
                        "INSERT INTO chunks (id, call_id, t0_ms, t1_ms, text, text_norm, token_count,
                             embedding) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                        params![
                            format!("chk_{}", ulid::Ulid::generate()),
                            call_id,
                            c.t0_ms,
                            c.t1_ms,
                            c.text,
                            crate::transcript::shadow(&c.text),
                            c.token_count as i64,
                            embedding
                        ],
                    )
                    .map_err(internal)?;
                }
                let logged = Logged {
                    entity_type: "call",
                    entity_id: call_id.clone(),
                    field: Some("chunks".into()),
                    before: None,
                    after: Some(total.to_string()),
                    delta: None,
                };
                Ok(((), vec![logged]))
            })?;
        }
        // @cpt-end:cpt-noter-algo-core-postcall-chunks:p1:inst-chunk-store
        // @cpt-begin:cpt-noter-algo-core-postcall-chunks:p1:inst-chunk-return
        Ok(Indexed {
            chunks: total,
            embedded,
        })
        // @cpt-end:cpt-noter-algo-core-postcall-chunks:p1:inst-chunk-return
    }

    /// One finite 1024-value vector per chunk, in order, in batches through the engine.
    async fn embed(&self, call: &CallId, chunks: &[Chunk]) -> Result<Vec<Vec<f32>>, String> {
        let mut out = Vec::with_capacity(chunks.len());
        for batch in chunks.chunks(EMBED_BATCH) {
            let id = ulid::Ulid::generate();
            let texts: Vec<String> = batch.iter().map(|c| c.text.clone()).collect();
            let path = format!("audio/{call}/embed-{id}.f32");
            let rows = self
                .engine
                .embed_texts(format!("emb_{id}"), texts, Some(path))
                .await
                .map_err(|e| format!("{e:?}"))?;
            let valid = rows.len() == batch.len()
                && rows
                    .iter()
                    .all(|v| v.len() == DIMS && v.iter().all(|x| x.is_finite()));
            if !valid {
                return Err("embeddings of the wrong shape".into());
            }
            out.extend(rows);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(n: i64, words: usize) -> (i64, i64, String) {
        let text = vec!["word"; words].join(" ");
        (n * 1000, n * 1000 + 900, format!("Speaker 1: {text}"))
    }

    #[test]
    fn lines_group_into_chunks_of_two_to_three_hundred_tokens_on_segment_boundaries() {
        // Thirty lines of 30 words (about 43 tokens each with the prefix).
        let lines: Vec<_> = (0..30).map(|n| line(n, 30)).collect();
        let chunks = group("Call: Planning", &lines);
        assert!(chunks.len() >= 4, "{}", chunks.len());
        for c in &chunks[..chunks.len() - 1] {
            assert!(
                (MIN_TOKENS..=MAX_TOKENS + 10).contains(&c.token_count),
                "{}",
                c.token_count
            );
            assert!(c.text.starts_with("Call: Planning\nSpeaker 1: "));
        }
        // Every line lands once, in order, and the spans follow the lines.
        let joined: usize = chunks.iter().map(|c| c.text.lines().count() - 1).sum();
        assert_eq!(joined, 30);
        assert_eq!(chunks[0].t0_ms, 0);
        assert_eq!(chunks.last().unwrap().t1_ms, 29_900);
        assert!(chunks.windows(2).all(|w| w[0].t1_ms < w[1].t0_ms));
        // A line longer than a chunk stays whole; no lines, no chunks.
        let long = group("H", &[line(0, 500), line(1, 3)]);
        assert_eq!(long.len(), 2);
        assert!(group("H", &[]).is_empty());
    }

    #[test]
    fn embeddings_are_kept_as_little_endian_floats() {
        assert_eq!(
            blob(&[1.0, -2.5]),
            [1f32.to_le_bytes(), (-2.5f32).to_le_bytes()].concat()
        );
        assert_eq!(tokens("a b c"), 4);
    }
}
