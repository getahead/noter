//! Retrieval in the composition root: `noter-retrieval` on the core's store, engine and jobs
//! (FEATURE `cpt-noter-feature-core-retrieval-ask`: search, scope presets, the index rebuild at
//! start, topics), with knowledge sources' chunks as the documents of search and Ask (2.24).

use std::collections::HashSet;
use std::sync::{Arc, Weak};

use noter_db::rusqlite::{self, Connection};
use noter_jobs::{BoxFuture, JobHandler, Request, RunCtx, Stop, Trigger};
use noter_protocol::ipc::CommandCtx;
use noter_protocol::model::*;
use noter_protocol::*;
use noter_retrieval::{DocHits, DocQuery, DocumentSource, Evidence, Hit, Privacy};
use serde_json::{json, Value};

use crate::{object, Core};

/// Retrieval's documents: knowledge chunks by keyword and by vector, each ranking through the
/// sources' policy as it stands now (`noter_knowledge::permitted_chunks`).
pub(crate) struct Documents;

impl DocumentSource for Documents {
    fn permitted_chunks(&self, conn: &Connection, q: &DocQuery<'_>) -> rusqlite::Result<DocHits> {
        let scope = AskScope {
            call_types: q.call_types.to_vec(),
            include_documents: true,
            ..AskScope::default()
        };
        let cloud = q.privacy == Privacy::Cloud;
        let keyword = noter_knowledge::keyword_chunks(conn, q.fts, q.fetch)?;
        let semantic = match q.vector {
            Some(v) => {
                let far = 1.0 - noter_retrieval::MIN_SIMILARITY;
                noter_knowledge::nearest_chunks(conn, v, q.fetch, far)?
            }
            None => vec![],
        };
        // The chunks a cloud request lost only because their source is sensitive.
        let mut skipped: HashSet<ChunkId> = HashSet::new();
        let mut permit = |ids: Vec<ChunkId>| -> rusqlite::Result<Vec<Hit>> {
            let allowed = noter_knowledge::permitted_chunks(conn, &ids, &scope, cloud)?;
            if cloud {
                for p in noter_knowledge::permitted_chunks(conn, &ids, &scope, false)? {
                    if !allowed.iter().any(|a| a.chunk_id == p.chunk_id) {
                        skipped.insert(p.chunk_id);
                    }
                }
            }
            Ok(allowed.into_iter().map(document_hit).collect())
        };
        let keyword = permit(keyword)?;
        let semantic = permit(semantic)?;
        Ok(DocHits {
            keyword,
            semantic,
            sensitive_skipped: skipped.len() as u32,
        })
    }
}

/// A permitted chunk as retrieval ranks it: its heading path is the section, and its text is
/// the body without the "title › headings" line every chunk starts with (the provenance says it).
fn document_hit(p: noter_knowledge::Permitted) -> Hit {
    let section = (!p.heading_path.is_empty()).then(|| p.heading_path.join(" › "));
    let body = p
        .text
        .split_once("\n\n")
        .map_or_else(|| p.text.clone(), |(_, body)| body.to_string());
    Hit {
        evidence: Evidence::Document {
            document_id: p.document_id.clone(),
            chunk_id: p.chunk_id.clone(),
        },
        target: HitTarget::Document {
            document_id: p.document_id.clone(),
            chunk_id: p.chunk_id.clone(),
        },
        title: p.title.clone(),
        text: body,
        lang: None,
        call: None,
        provenance: Provenance::Document {
            source_id: p.source_id,
            document_id: p.document_id,
            chunk_id: p.chunk_id,
            title: p.title,
            section,
            source_name: p.source_name,
        },
        keyword: false,
        semantic: false,
        score: 0.0,
    }
}

/// The `IndexRebuild` job: fills the vector indexes, keyword-only meanwhile.
struct RebuildJob(Weak<Core>);

impl JobHandler for RebuildJob {
    fn run<'a>(&'a self, ctx: &'a mut RunCtx) -> BoxFuture<'a, Result<(), Stop>> {
        Box::pin(async move {
            let core = self.0.upgrade().ok_or(Stop::Cancelled)?;
            noter_retrieval::rebuild(core.store(), &core.engine, &core.index, ctx).await
        })
    }
}

pub(crate) fn register(core: &Arc<Core>) {
    core.jobs.register(
        JobKind::IndexRebuild,
        Arc::new(RebuildJob(Arc::downgrade(core))),
    );
}

impl Core {
    /// At open: hybrid when the vector indexes hold every committed row; otherwise keyword-only
    /// until the rebuild `start_rebuild` queues has filled them.
    pub(crate) fn check_index(&self) {
        if matches!(self.store().read(noter_retrieval::stale), Ok(false)) {
            self.index.ready();
        }
    }

    /// Queues the rebuild once the scheduler runs, when the indexes lack rows (the vector
    /// tables are new or a previous rebuild did not finish). The maintenance trigger is M5's.
    // shortcut: items written after start get their vectors at the next start (or from topic
    // attachment, which embeds them, in 2.22 slice 3); chunks are indexed as they are written.
    pub(crate) fn start_rebuild(&self) {
        if !matches!(self.store().read(noter_retrieval::stale), Ok(true)) {
            return;
        }
        let queued = self
            .jobs
            .trigger(Request::new(JobKind::IndexRebuild, Trigger::OnDemand));
        if let Err(e) = queued {
            self.log(object(json!({
                "level": "error", "module": "retrieval", "code": "rebuild_not_queued",
                "message": e.message
            })));
        }
    }

    /// `search`: one retrieval for every section, the query embedded locally when the vector
    /// indexes are ready. Reads on the pool; never logs the query or what it found.
    pub(crate) async fn search_library(
        &self,
        args: SearchArgs,
    ) -> Result<SearchResults, CoreError> {
        self.ready()?;
        let request = noter_retrieval::search_request(&args)?;
        let (vector, mode) = self.query_vector(request.text()).await;
        let request = request.with_vector(vector);
        self.store()
            .read(|c| noter_retrieval::search(c, &args.query, &request, mode, &Documents))
    }

    /// A query's local embedding when the vector indexes are ready, and the mode the request
    /// runs in: keyword-only while they rebuild, or when this embedding failed.
    pub(crate) async fn query_vector(&self, text: &str) -> (Option<Vec<f32>>, SearchMode) {
        let mode = self.index.mode();
        if mode != SearchMode::Hybrid || text.trim().is_empty() {
            return (None, mode);
        }
        match noter_retrieval::embed_query(&self.engine, text).await {
            Some(vector) => (Some(vector), mode),
            // The indexes are complete; only this request ran without vectors.
            None => (
                None,
                SearchMode::KeywordOnly {
                    rebuild_progress: 1.0,
                },
            ),
        }
    }

    /// `ask_scope_presets`: readable scopes from the current library.
    pub(crate) fn scope_presets(&self) -> Result<ScopePresetList, CoreError> {
        self.ready()?;
        let now = self.deps.clock.now();
        let types = self.call_types_now().call_types;
        self.store()
            .read(|c| noter_retrieval::scope_presets(c, now, &types))
    }
}

fn no_topic() -> CoreError {
    CoreError::new(ErrorCode::NotFound, "no such topic")
}

/// Topic threads and their edits (`cpt-noter-flow-core-retrieval-ask-topics`), and the
/// post-call attachment of new items to topics (TL-37).
impl Core {
    /// The topic's row as lists show it, sent through `entity:changed` (or its removal).
    fn publish_topic(&self, id: &str) -> Result<Option<TopicRow>, CoreError> {
        let row = self.store().read(|c| noter_retrieval::topic_row(c, id))?;
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-return
        match &row {
            Some(topic) => self.emit_entity_changed(&EntityChanged::Topic {
                topic: topic.clone(),
            }),
            None => self.emit_entity_changed(&EntityChanged::Removed {
                kind: EntityKind::Topic,
                id: id.to_owned(),
            }),
        }
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-return
        Ok(row)
    }

    /// Items whose chips changed, sent whole.
    fn publish_items(&self, ids: &[String]) -> Result<(), CoreError> {
        for id in ids {
            if let Some(item) = self.item_view(id)? {
                self.emit_entity_changed(&EntityChanged::Item { item });
            }
        }
        Ok(())
    }

    /// `topics_list`.
    pub(crate) fn list_topics(&self) -> Result<TopicList, CoreError> {
        self.ready()?;
        let topics = self.store().read(noter_retrieval::topic_list)?;
        Ok(TopicList { topics })
    }

    /// `topic_get`: the topic and its items grouped by call, newest call first.
    pub(crate) fn get_topic(&self, args: TopicIdArgs) -> Result<TopicThread, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-read
        let id = args.topic_id.as_str();
        let (topic, items) = self.store().read(|c| {
            let topic = noter_retrieval::topic_row(c, id)?;
            Ok((topic, noter_retrieval::thread_items(c, id)?))
        })?;
        let topic = topic.ok_or_else(no_topic)?;
        let mut groups: Vec<TopicThreadGroup> = vec![];
        for item in items {
            let Some(item) = self.item_view(&item)? else {
                continue;
            };
            match groups.last_mut() {
                Some(g) if g.call.id == item.call.id => g.items.push(item),
                _ => groups.push(TopicThreadGroup {
                    call: item.call.clone(),
                    items: vec![item],
                }),
            }
        }
        Ok(TopicThread { topic, groups })
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-read
    }

    /// `topic_rename`.
    pub(crate) fn rename_topic(
        &self,
        ctx: &CommandCtx,
        args: TopicRenameArgs,
    ) -> Result<TopicMutation, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-rename
        let mutation = noter_retrieval::rename(&args.topic_id, args.rev, &args.name)?;
        let id = args.topic_id.as_str();
        if self
            .store()
            .read(|c| noter_retrieval::topic_row(c, id))?
            .is_none()
        {
            return Err(no_topic());
        }
        let meta = self.change_meta(ctx, "Renamed a topic".into(), "topic_rename");
        let written = self.store().write(mutation, meta)?;
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-rename
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-return
        let topic = self.publish_topic(id)?.ok_or_else(no_topic)?;
        Ok(TopicMutation {
            topic,
            change_id: written.change_id,
        })
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-return
    }

    /// `topics_merge`: one change batch; its `change_id` undoes the whole batch.
    pub(crate) fn merge_topics(
        &self,
        ctx: &CommandCtx,
        args: TopicMergeArgs,
    ) -> Result<TopicMutation, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-merge
        let (source, target) = (
            args.source.as_str().to_owned(),
            args.target.as_str().to_owned(),
        );
        let meta = self.change_meta(ctx, "Merged topics".into(), "topics_merge");
        let (s, t) = (source.clone(), target.clone());
        let done = self
            .store()
            .write_with(meta, move |tx| noter_retrieval::merge(tx, &s, &t))?;
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-merge
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-return
        self.publish_topic(&source)?;
        let topic = self.publish_topic(&target)?.ok_or_else(no_topic)?;
        self.publish_items(&done.value)?;
        Ok(TopicMutation {
            topic,
            change_id: done.change_ids[0].clone(),
        })
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-return
    }

    /// `topics_keep_separate`.
    pub(crate) fn keep_topics_separate(
        &self,
        ctx: &CommandCtx,
        args: TopicPairArgs,
    ) -> Result<Ack, CoreError> {
        self.ready()?;
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-separate
        let (a, b) = (args.a.as_str().to_owned(), args.b.as_str().to_owned());
        let mut meta = self.change_meta(ctx, "Kept topics separate".into(), "topics_keep_separate");
        meta.undoable = false;
        let now = self.deps.clock.now();
        let (x, y) = (a.clone(), b.clone());
        self.store().write_with(meta, move |tx| {
            noter_retrieval::keep_separate(tx, &x, &y, now)
        })?;
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-separate
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-return
        // Their merge suggestions changed.
        self.publish_topic(&a)?;
        self.publish_topic(&b)?;
        Ok(Ack {})
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-topics:p1:inst-topic-return
    }

    /// After an undo or redo moved topic rows or links: their centroids from their items'
    /// vectors again, then each topic through `entity:changed`.
    pub(crate) fn topics_reversed(&self, ids: &[String]) -> Result<(), CoreError> {
        let meta = noter_db::ChangeMeta {
            actor: Actor::You,
            summary: "topic centroids".into(),
            reason: "change_undo".into(),
            evidence_ids: vec![],
            batch_id: None,
            undoable: false,
            surface: None,
        };
        let ids_now = ids.to_vec();
        self.store().write_with(meta, move |tx| {
            noter_retrieval::refresh_centroids(tx, &ids_now).map_err(crate::internal)?;
            Ok(((), vec![centroids_logged(ids_now.len())]))
        })?;
        for id in ids {
            self.publish_topic(id)?;
        }
        Ok(())
    }

    /// Attaches a call's new items to topics right after the items step (TL-37): their texts
    /// embedded locally, then one logged write that also stores their vectors. The outputs are
    /// committed already, so a failure is logged and leaves the items without a topic.
    /// Answers the items it linked.
    pub(crate) async fn attach_items(
        &self,
        ctx: &RunCtx,
        call: &CallId,
        items: Vec<(String, String, Option<String>)>,
    ) -> Vec<String> {
        if items.is_empty() {
            return vec![];
        }
        let fail = |error: Value| {
            self.log(object(json!({
                "level": "error", "module": "retrieval", "code": "attach_topics", "error": error
            })));
        };
        let texts = items.iter().map(|(_, text, _)| text.clone()).collect();
        // The engine's error stays out of the log: only that the embedding failed.
        let Ok(vectors) = noter_retrieval::Embedder::embed(&self.engine, texts).await else {
            // shortcut: items the engine could not embed stay without a topic; a later
            // attachment pass over unattached items is for when this shows up in practice.
            fail(json!("not_embedded"));
            return vec![];
        };
        let new: Vec<noter_retrieval::NewItem> = items
            .into_iter()
            .zip(vectors)
            .map(|((id, text, hint), vector)| noter_retrieval::NewItem {
                id,
                text,
                hint,
                vector,
            })
            .collect();
        let Some(meta) = ctx.change_meta("topics") else {
            return vec![];
        };
        let call_id = call.as_str().to_owned();
        let done = self.store().write_with(meta, move |tx| {
            noter_retrieval::attach_topics(tx, &call_id, &new)
        });
        match done {
            Ok(done) => {
                for id in &done.value.topics {
                    if let Err(e) = self.publish_topic(id) {
                        fail(json!(e.code));
                    }
                }
                done.value.items
            }
            Err(e) => {
                fail(json!(e.code));
                vec![]
            }
        }
    }
}

/// The change row of a centroid refresh: how many topics, no content.
fn centroids_logged(n: usize) -> noter_db::Logged {
    noter_db::Logged {
        entity_type: "index",
        entity_id: "topic_centroid".into(),
        field: Some("rows".into()),
        before: None,
        after: Some(n.to_string()),
        delta: None,
    }
}
