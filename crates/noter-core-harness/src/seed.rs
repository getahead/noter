use super::*;
use noter_protocol::TopicId;

impl Harness {
    // @cpt-algo:cpt-noter-algo-core-harness-boot:p1
    /// Replace only the canonical topics; counts and suggestions remain core computations.
    pub(super) fn replace_topics(&self, topics: &[TopicRow]) -> Result<(), CoreError> {
        let mut db = noter_db::rusqlite::Connection::open(self.dir.join("noter.db"))
            .map_err(crate::internal)?;
        db.busy_timeout(std::time::Duration::from_secs(10))
            .map_err(crate::internal)?;
        db.execute_batch("PRAGMA foreign_keys = ON")
            .map_err(crate::internal)?;
        let tx = db.transaction().map_err(crate::internal)?;
        tx.execute("DELETE FROM topics", [])
            .map_err(crate::internal)?;
        for topic in topics {
            tx.execute("INSERT INTO topics (id, rev, name, first_seen, last_seen) VALUES (?1, ?2, ?3, ?4, ?4)",
                noter_db::rusqlite::params![topic.id.as_str(), topic.rev.0, topic.name, topic.last_seen.0]).map_err(crate::internal)?;
            for alias in &topic.aliases {
                tx.execute(
                    "INSERT INTO topic_aliases (topic_id, alias) VALUES (?1, ?2)",
                    noter_db::rusqlite::params![topic.id.as_str(), alias],
                )
                .map_err(crate::internal)?;
            }
        }
        tx.execute(
            "UPDATE items SET topic_id = NULL WHERE topic_id NOT IN (SELECT id FROM topics)",
            [],
        )
        .map_err(crate::internal)?;
        tx.commit().map_err(crate::internal)
    }

    // @cpt-algo:cpt-noter-algo-core-retrieval-ask-attach-topic:p1
    /// Seed identical centroid inputs; the retrieval service computes suggestions and applies suppressions.
    pub(super) fn seed_topic_centroids(&self, args: Value) -> Result<Value, CoreError> {
        #[derive(serde::Deserialize)]
        struct Args {
            topic_ids: Vec<TopicId>,
        }
        let args: Args = serde_json::from_value(args).map_err(|_| {
            CoreError::new(
                ErrorCode::InvalidInput,
                "topic_centroids needs { topic_ids }",
            )
        })?;
        let ids: std::collections::BTreeSet<_> =
            args.topic_ids.iter().map(|id| id.as_str()).collect();
        if ids.len() < 2 || ids.len() != args.topic_ids.len() {
            return Err(CoreError::new(
                ErrorCode::InvalidInput,
                "topic_ids must name at least two distinct topics",
            ));
        }
        let mut db = noter_db::rusqlite::Connection::open(self.dir.join("noter.db"))
            .map_err(crate::internal)?;
        db.busy_timeout(std::time::Duration::from_secs(10))
            .map_err(crate::internal)?;
        let tx = db.transaction().map_err(crate::internal)?;
        for id in &ids {
            let exists: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM topics WHERE id = ?1)",
                    [id],
                    |r| r.get(0),
                )
                .map_err(crate::internal)?;
            if !exists {
                return Err(CoreError::new(ErrorCode::NotFound, "no such topic"));
            }
        }
        let mut vector = vec![0_f32; noter_retrieval::DIMS];
        vector[0] = 1.0;
        let blob: Vec<u8> = vector.iter().flat_map(|v| v.to_le_bytes()).collect();
        for id in ids {
            tx.execute(
                "UPDATE topics SET centroid = ?2 WHERE id = ?1",
                noter_db::rusqlite::params![id, blob],
            )
            .map_err(crate::internal)?;
        }
        tx.execute("DELETE FROM topic_suggestions", [])
            .map_err(crate::internal)?;
        tx.commit().map_err(crate::internal)?;
        Ok(json!({}))
    }

    /// The fixture's owned slices, through the core's own commands.
    pub(super) async fn seed(&self, w: &FakeWorld) -> Result<(), CoreError> {
        let wanted = to_json(w);
        self.write_settings(&wanted["settings"]).await?;
        for term in w.glossary.terms.iter() {
            let t = to_json(term);
            let args = json!({ "term": t["term"], "variants_latin": t["variants_latin"], "variants_cyrillic": t["variants_cyrillic"], "spoken_forms": t["spoken_forms"], "always_apply": t["always_apply"] });
            self.call(WindowLabel::Settings, "glossary_upsert", args)
                .await?;
        }
        self.write_setup(&wanted["app"]["setup"]).await?;
        // The self-test result lives in the core, not in settings: without this a fixture that
        // says `passed` boots `not_run` (#1062).
        noter_core::testing::seed_self_test(&self.core, w.app.setup.self_test.clone());
        self.seed_people(&wanted)?;
        self.seed_calls(&wanted)?;
        self.native.set_calendar(&w.today);
        if !w.app.banners.banners.is_empty() {
            self.core.set_banners(w.app.banners.banners.clone());
        }
        if w.app.capture.phase != CapturePhase::Idle {
            noter_core::testing::seed_capture(&self.core, w.app.capture.clone()).await?;
        }
        // The fixture's configured API keys, as stand-ins in the scripted Keychain: the core
        // then reads them as configured (never sent anywhere; the runtimes are scripted).
        for key in &w.app.accounts.keys {
            if matches!(key.status, KeyStatus::Configured { .. }) {
                let runtime = match key.provider {
                    KeyProvider::Anthropic => noter_protocol::RuntimeChoice::ClaudeApiKey,
                    KeyProvider::Codex => noter_protocol::RuntimeChoice::CodexApiKey,
                };
                if let Some(account) = noter_core::key_account(runtime) {
                    use noter_core::SecretStore;
                    let stand_in = noter_core::Secret::new("harness-seeded-key".into());
                    let _ = self.secrets.set(account, &stand_in);
                }
            }
        }
        // The launch read saw the accounts before the seeded settings and keys (issue 1139):
        // read again.
        noter_core::testing::refresh_accounts(&self.core).await;
        Ok(())
    }

    /// Writes the world's people as rows without change rows (a seed is not something the user
    /// did): the seeded You keeps its row and takes the world's details, everyone else is
    /// replaced, aliases and opt-in flags included. Profiles are never seeded.
    pub(super) fn seed_people(&self, wanted: &Value) -> Result<(), CoreError> {
        let db = noter_db::rusqlite::Connection::open(self.dir.join("noter.db"))
            .map_err(crate::internal)?;
        db.busy_timeout(std::time::Duration::from_secs(10))
            .map_err(crate::internal)?;
        db.execute_batch("PRAGMA foreign_keys = ON; DELETE FROM people WHERE is_you = 0;")
            .map_err(crate::internal)?;
        let empty = vec![];
        let mut rows = vec![];
        for p in wanted["people"].as_array().unwrap_or(&empty) {
            if p["is_you"] == json!(true) {
                db.execute(
                    "UPDATE people SET display_name = ?1, short_name = ?2, email = ?3, role = ?4, org = ?5
                     WHERE is_you = 1",
                    noter_db::rusqlite::params![
                        p["display_name"].as_str(),
                        p["short_name"].as_str(),
                        p["email"].as_str(),
                        p["role"].as_str(),
                        p["org"].as_str()
                    ],
                )
                .map_err(crate::internal)?;
                continue;
            }
            rows.push(noter_db::Insert {
                table: "people",
                values: vec![
                    ("id", p["id"].clone()),
                    ("rev", p["rev"].clone()),
                    ("display_name", p["display_name"].clone()),
                    ("short_name", p["short_name"].clone()),
                    ("email", p["email"].clone()),
                    ("role", p["role"].clone()),
                    ("org", p["org"].clone()),
                    ("is_you", json!(0)),
                    ("voice_profile_optin", p["voice_profile"].clone()),
                ],
            });
            for (n, alias) in p["aliases"].as_array().unwrap_or(&empty).iter().enumerate() {
                let text = alias.as_str().unwrap_or_default();
                rows.push(noter_db::Insert {
                    table: "person_aliases",
                    values: vec![
                        (
                            "id",
                            json!(format!("pal_{}_{n}", p["id"].as_str().unwrap_or_default())),
                        ),
                        ("person_id", p["id"].clone()),
                        ("alias", json!(text)),
                        ("alias_norm", json!(text.to_lowercase().replace('ё', "е"))),
                    ],
                });
            }
        }
        self.core.store().insert_batch(rows)
    }

    /// Removes every call (and with it its segments, speakers, marks, gaps and tags) and every
    /// topic its items named, leaving no change row behind: a seed is not something the user
    /// did, and the store logs every write it is given (the log is append-only), so the harness
    /// deletes on a connection of its own.
    pub(super) fn clear_calls(&self) -> Result<(), CoreError> {
        let db = noter_db::rusqlite::Connection::open(self.dir.join("noter.db"))
            .map_err(crate::internal)?;
        db.busy_timeout(std::time::Duration::from_secs(10))
            .map_err(crate::internal)?;
        db.execute_batch("PRAGMA foreign_keys = ON; DELETE FROM calls; DELETE FROM topics;")
            .map_err(crate::internal)
    }

    /// Writes the world's calls, speakers, segments, marks and gaps as rows, the way capture
    /// writes them (`cpt-noter-algo-core-library-calls-fixture-parity`, `inst-parity-seed`).
    pub(super) fn seed_calls(&self, wanted: &Value) -> Result<(), CoreError> {
        // @cpt-begin:cpt-noter-algo-core-library-calls-fixture-parity:p2:inst-parity-seed
        let ins = |table: &'static str, values: Vec<(&'static str, Value)>| noter_db::Insert {
            table,
            values,
        };
        let empty = vec![];
        let transcripts = wanted["transcripts"].as_array().unwrap_or(&empty);
        let mut rows = vec![];
        for call in wanted["calls"].as_array().unwrap_or(&empty) {
            let id = &call["id"];
            // The call's folder exists, as capture leaves it, so **Show in Finder** finds it.
            let folder = self.dir.join("audio").join(id.as_str().unwrap_or_default());
            std::fs::create_dir_all(&folder).map_err(crate::internal)?;
            if call["audio_deleted"] != true && call["audio_not_stored"] != true {
                std::fs::write(folder.join("mic.m4a"), b"scripted microphone recording")
                    .map_err(crate::internal)?;
                std::fs::write(folder.join("sys.m4a"), b"scripted system recording")
                    .map_err(crate::internal)?;
                std::fs::write(
                    folder.join("timeline.json"),
                    serde_json::to_vec(&json!({
                        "call_id": id,
                        "duration_ms": call["duration_ms"],
                        "gaps": [],
                        "parts": 1
                    }))
                    .map_err(crate::internal)?,
                )
                .map_err(crate::internal)?;
            }
            let detail = wanted["call_details"]
                .as_array()
                .unwrap_or(&empty)
                .iter()
                .find(|d| d["call"]["id"] == *id);
            let started = call["started_at"].as_i64().unwrap_or(0);
            let live = matches!(call["status"].as_str(), Some("recording" | "paused"));
            rows.push(ins(
                "calls",
                vec![
                    ("id", id.clone()),
                    ("rev", call["rev"].clone()),
                    ("started_at", json!(started)),
                    (
                        "ended_at",
                        if live {
                            Value::Null
                        } else {
                            json!(started + call["duration_ms"].as_i64().unwrap_or(0))
                        },
                    ),
                    ("title", call["title"].clone()),
                    ("call_type", call["call_type"].clone()),
                    ("platform", call["platform"].clone()),
                    ("privacy_class", call["privacy"].clone()),
                    ("status", call["status"].clone()),
                    ("outputs_status", call["outputs"].clone()),
                    ("archive_status", call["archive"].clone()),
                    ("audio_retention_until", call["audio_kept_until"].clone()),
                    ("audio_deleted", call["audio_deleted"].clone()),
                    ("audio_deleted_at", call["audio_deleted_at"].clone()),
                    (
                        "audio_not_stored",
                        detail.map_or(json!(false), |d| d["audio_not_stored"].clone()),
                    ),
                    (
                        "mode_used",
                        detail.map_or(json!("cloud_redacted"), |d| d["mode_used"].clone()),
                    ),
                ],
            ));
            for participant in call["participants"].as_array().unwrap_or(&empty) {
                rows.push(ins(
                    "call_participants",
                    vec![
                        (
                            "id",
                            json!(format!(
                                "cp_{}_{}",
                                id.as_str().unwrap_or_default(),
                                participant["id"].as_str().unwrap_or_default()
                            )),
                        ),
                        ("call_id", id.clone()),
                        ("person_id", participant["id"].clone()),
                    ],
                ));
            }
            for tag in call["tags"].as_array().unwrap_or(&empty) {
                let text = tag.as_str().unwrap_or_default();
                rows.push(ins(
                    "call_tags",
                    vec![
                        ("call_id", id.clone()),
                        ("tag", json!(text)),
                        ("tag_norm", json!(text.to_lowercase())),
                    ],
                ));
            }
            let transcript = transcripts.iter().find(|t| t["call_id"] == *id);
            let pass = transcript.map_or(json!("live"), |t| t["pass"].clone());
            let Some(d) = detail else { continue };
            // Marks and gaps live on both slices; a transcript that carries them is the newer say.
            let rows_of = |field: &str| -> Vec<Value> {
                transcript
                    .and_then(|t| t[field].as_array())
                    .filter(|v| !v.is_empty())
                    .or_else(|| d[field].as_array())
                    .cloned()
                    .unwrap_or_default()
            };
            for sp in d["speakers"].as_array().unwrap_or(&empty) {
                let label = &sp["label"];
                let (text, n, person, name) = match label["type"].as_str() {
                    Some("you") => (json!("you"), Value::Null, Value::Null, Value::Null),
                    Some("guest_your_side") => (
                        json!("guest_your_side"),
                        Value::Null,
                        Value::Null,
                        Value::Null,
                    ),
                    Some("person") => {
                        let id = sp["id"].as_str().unwrap_or_default();
                        let n = id.strip_prefix("spk_").and_then(|n| n.parse::<i64>().ok());
                        (
                            json!(id),
                            n.map_or(Value::Null, |n| json!(n)),
                            label["person"]["id"].clone(),
                            label["person"]["display_name"].clone(),
                        )
                    }
                    _ => (
                        json!(format!("spk_{}", label["n"])),
                        label["n"].clone(),
                        Value::Null,
                        Value::Null,
                    ),
                };
                rows.push(ins(
                    "speakers",
                    vec![
                        ("id", sp["id"].clone()),
                        ("call_id", id.clone()),
                        ("label", text),
                        ("n", n),
                        ("channel", sp["channel"].clone()),
                        ("person_id", person),
                        ("name", name),
                        ("named_by", sp["named_by"].clone()),
                        ("pass", pass.clone()),
                    ],
                ));
            }
            for m in &rows_of("marks") {
                rows.push(ins(
                    "marks",
                    vec![
                        ("id", m["id"].clone()),
                        ("call_id", id.clone()),
                        ("at_ms", m["at_ms"].clone()),
                        ("note", m["note"].clone()),
                    ],
                ));
            }
            for g in &rows_of("gaps") {
                rows.push(ins(
                    "gaps",
                    vec![
                        ("call_id", id.clone()),
                        ("t0_ms", g["t0_ms"].clone()),
                        ("t1_ms", g["t1_ms"].clone()),
                        ("reason", g["reason"].clone()),
                    ],
                ));
            }
            for seg in transcript
                .into_iter()
                .flat_map(|t| t["segments"].as_array().unwrap_or(&empty))
            {
                rows.push(ins(
                    "segments",
                    vec![
                        ("id", seg["id"].clone()),
                        ("call_id", id.clone()),
                        ("speaker_id", seg["speaker"]["speaker_id"].clone()),
                        ("channel", seg["channel"].clone()),
                        ("t0_ms", seg["t0_ms"].clone()),
                        ("t1_ms", seg["t1_ms"].clone()),
                        ("text", seg["text"].clone()),
                        (
                            "text_norm",
                            json!(noter_retrieval::normalize(
                                seg["text"].as_str().unwrap_or_default()
                            )),
                        ),
                        ("lang", seg["lang"].clone()),
                        ("lang_p", seg["lang_p"].clone()),
                        // The engine stores average log probability; the fixture exposes its
                        // confidence projection, so seed the inverse for parity.
                        (
                            "avg_logprob",
                            json!(seg["confidence"].as_f64().unwrap_or(1.0).ln()),
                        ),
                        ("pass", seg["pass"].clone()),
                    ],
                ));
            }
        }
        // The topics the items name, with their aliases; a centroid comes from item vectors.
        for topic in wanted["topics"].as_array().unwrap_or(&empty) {
            rows.push(ins(
                "topics",
                vec![
                    ("id", topic["id"].clone()),
                    ("rev", topic["rev"].clone()),
                    ("name", topic["name"].clone()),
                    ("first_seen", topic["last_seen"].clone()),
                    ("last_seen", topic["last_seen"].clone()),
                ],
            ));
            for alias in topic["aliases"].as_array().unwrap_or(&empty) {
                rows.push(ins(
                    "topic_aliases",
                    vec![("topic_id", topic["id"].clone()), ("alias", alias.clone())],
                ));
            }
        }
        // The items follow their calls (they reference them), each with its evidence spans.
        let calls = wanted["calls"].as_array().unwrap_or(&empty);
        let has_call = |id: &Value| calls.iter().any(|c| c["id"] == *id);
        // A scenario may drop calls and leave their items in the fixture: those are left out.
        for item in wanted["items"]
            .as_array()
            .unwrap_or(&empty)
            .iter()
            .filter(|i| has_call(&i["call"]["id"]))
        {
            let lang = match &item["lang"] {
                Value::String(code) => json!(code),
                other => other["code"].clone(),
            };
            let text = &item["text"];
            rows.push(ins(
                "items",
                vec![
                    ("id", item["id"].clone()),
                    ("rev", item["rev"].clone()),
                    ("call_id", item["call"]["id"].clone()),
                    ("kind", item["kind"].clone()),
                    ("text", text.clone()),
                    ("lang", lang),
                    // The view says only that the text was edited: any other wording will do.
                    (
                        "generated_text",
                        if item["edited"] == json!(true) {
                            json!(format!("{} (generated)", text.as_str().unwrap_or_default()))
                        } else {
                            Value::Null
                        },
                    ),
                    ("owner_person_id", item["owner"]["id"].clone()),
                    ("due_date", item["due"].clone()),
                    ("status", item["status"].clone()),
                    ("review_state", item["review"].clone()),
                    ("created_by", item["created_by"].clone()),
                    ("topic_id", item["topic"]["id"].clone()),
                    ("is_engineering", item["is_engineering"].clone()),
                    ("linked_issue_key", item["linked_issue"].clone()),
                    ("handoff_target", item["handoff"]["target"].clone()),
                    ("handoff_cwd", item["handoff"]["cwd"].clone()),
                    ("handed_off_at", item["handoff"]["at"].clone()),
                    ("done_at", item["done_at"].clone()),
                    (
                        "carried_from_call_id",
                        if has_call(&item["carried_from"]["id"]) {
                            item["carried_from"]["id"].clone()
                        } else {
                            Value::Null
                        },
                    ),
                ],
            ));
            for span in item["spans"].as_array().unwrap_or(&empty) {
                rows.push(ins(
                    "item_spans",
                    vec![
                        ("item_id", item["id"].clone()),
                        ("call_id", span["call_id"].clone()),
                        ("channel", span["channel"].clone()),
                        ("t0_ms", span["t0_ms"].clone()),
                        ("t1_ms", span["t1_ms"].clone()),
                    ],
                ));
            }
        }
        // @cpt-end:cpt-noter-algo-core-library-calls-fixture-parity:p2:inst-parity-seed
        rows.extend(summary_rows(wanted));
        self.core.store().insert_batch(rows)
    }

    /// The running states of the world's sections (writing, failed) live in the core, not in
    /// rows: every section of a changed `outputs` is set again, with its `outputs:progress`.
    // @cpt-flow:cpt-noter-flow-core-harness-session:p1
    pub(super) fn seed_sections(&self, w: &FakeWorld) {
        // A section omitted by the replacement world must lose its old running state too.
        for o in &lock(&self.world).outputs {
            for s in &o.sections {
                noter_core::testing::seed_section(
                    &self.core,
                    &o.call_id,
                    s.kind,
                    SectionState::Pending,
                );
            }
        }
        let seeded = |id: &CallId| w.calls.iter().any(|c| c.id == *id);
        for o in w.outputs.iter().filter(|o| seeded(&o.call_id)) {
            for s in &o.sections {
                noter_core::testing::seed_section(&self.core, &o.call_id, s.kind, s.state.clone());
            }
        }
    }

    /// Each settings section that differs, with the current `rev`.
    pub(super) async fn write_settings(&self, wanted: &Value) -> Result<(), CoreError> {
        let current = self
            .call(WindowLabel::Settings, "settings_get", json!({}))
            .await?;
        for (section, value) in wanted.as_object().into_iter().flatten() {
            if matches!(section.as_str(), "rev" | "version") || current.get(section) == Some(value)
            {
                continue;
            }
            // The core's own reactions to a section (first run follows `general`) can bump `rev`
            // meanwhile; a conflict carries the current one, so try again with it.
            let mut rev = self
                .call(WindowLabel::Settings, "settings_get", json!({}))
                .await?["rev"]
                .clone();
            for attempt in 0..3 {
                let args = json!({ "rev": rev, "section": { "section": section, "value": value } });
                match self
                    .call(WindowLabel::Settings, "settings_update", args)
                    .await
                {
                    Ok(_) => break,
                    Err(e) if e.code == ErrorCode::Conflict && attempt < 2 => {
                        rev = to_json(&e.detail)["current_rev"].clone()
                    }
                    Err(e) => return Err(e),
                }
            }
        }
        Ok(())
    }

    /// Step states and the call display, through the first-run commands; a refusal is the
    /// caller's to see (the core accepts every step state since decision D10).
    pub(super) async fn write_setup(&self, wanted: &Value) -> Result<(), CoreError> {
        let current = self
            .call(WindowLabel::FirstRun, "setup_status", json!({}))
            .await?;
        for step in wanted["steps"].as_array().into_iter().flatten() {
            let now = current["steps"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|s| s["step"] == step["step"]);
            if now.map(|s| &s["state"]) != Some(&step["state"]) {
                self.call(WindowLabel::FirstRun, "setup_set_step", step.clone())
                    .await?;
            }
        }
        if current["call_display"] != wanted["call_display"] {
            self.call(
                WindowLabel::FirstRun,
                "setup_set_call_display",
                json!({ "display_id": wanted["call_display"] }),
            )
            .await?;
        }
        Ok(())
    }
}

pub(super) fn change_row(c: &Value) -> noter_db::Insert {
    let actor = &c["actor"];
    let actor = match actor["type"].as_str() {
        Some("job") => format!("job:{}", actor["job_id"].as_str().unwrap_or_default()),
        Some("model") => format!(
            "llm_run:{}",
            actor["llm_run_id"].as_str().unwrap_or_default()
        ),
        _ => "you".into(),
    };
    noter_db::Insert {
        table: "changes",
        values: vec![
            ("id", c["id"].clone()),
            ("ts", c["at"].clone()),
            ("actor", json!(actor)),
            ("entity_type", c["entity"]["kind"].clone()),
            ("entity_id", c["entity"]["id"].clone()),
            ("field", c["field"].clone()),
            ("before", c["before"].clone()),
            ("after", c["after"].clone()),
            ("summary", c["summary"].clone()),
            ("reason", json!(c["reason"].as_str().unwrap_or_default())),
            ("confidence", c["confidence"].clone()),
            ("status", c["status"].clone()),
            ("batch_id", c["batch_id"].clone()),
            ("undoable", c["undoable"].clone()),
        ],
    }
}

/// The world's sections of the calls it seeds as `summaries` rows, each with its versions
/// (generated; the current one last, the user's edit when edited) and the `llm_runs` row their
/// writer comes from.
fn summary_rows(wanted: &Value) -> Vec<noter_db::Insert> {
    let ins = |table: &'static str, values: Vec<(&'static str, Value)>| noter_db::Insert {
        table,
        values,
    };
    // `llm_runs` outlives a world_set's call deletion: each seed writes its own run ids.
    let seeded = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let mut rows = vec![];
    let calls = wanted["calls"].as_array().cloned().unwrap_or_default();
    let seeded_call = |o: &&Value| calls.iter().any(|c| c["id"] == o["call_id"]);
    for outputs in wanted["outputs"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(seeded_call)
    {
        let call = &outputs["call_id"];
        for s in outputs["sections"].as_array().into_iter().flatten() {
            // An item section's row says only ready (its items as the body) or empty; the items
            // themselves are the world's `items`, as the core lists them.
            let item_kind = match s["kind"].as_str() {
                Some("decisions") => Some("decision"),
                Some("action_items") => Some("action_item"),
                Some("open_questions") => Some("open_question"),
                Some("risks") => Some("risk"),
                _ => None,
            };
            let body = match (
                s["body_md"].as_str(),
                item_kind,
                s["state"]["type"].as_str(),
            ) {
                (Some(body), _, _) => body.to_owned(),
                (None, Some(kind), Some("ready")) => {
                    let lines: Vec<String> = wanted["items"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|i| i["call"]["id"] == *call && i["kind"] == kind)
                        .map(|i| format!("- {}", i["text"].as_str().unwrap_or_default()))
                        .collect();
                    if lines.is_empty() {
                        "-".to_owned()
                    } else {
                        lines.join("\n")
                    }
                }
                (None, Some(_), Some("empty")) => String::new(),
                _ => continue,
            };
            let id = s["summary_id"].as_str().map_or_else(
                || {
                    format!(
                        "sum_{}_{}",
                        call.as_str().unwrap_or_default(),
                        s["kind"].as_str().unwrap_or_default()
                    )
                },
                str::to_owned,
            );
            let (id, body) = (id.as_str(), body.as_str());
            let w = &s["writer"];
            let run = format!("llm_seed_{id}_{seeded}");
            if w.is_object() {
                rows.push(ins(
                    "llm_runs",
                    vec![
                        ("id", json!(run)),
                        ("adapter", json!("fixture")),
                        ("runtime_choice", w["runtime"].clone()),
                        ("model", w["model"].clone()),
                        ("skill", json!("post-call")),
                        ("skill_version", w["skill_version"].clone()),
                        ("call_id", outputs["call_id"].clone()),
                        ("prompt_hash", json!("fixture")),
                        ("schema_ok", json!(1)),
                    ],
                ));
            }
            let count = s["version_count"].as_u64().unwrap_or(1).max(1);
            rows.push(ins(
                "summaries",
                vec![
                    ("id", json!(id)),
                    ("rev", s["rev"].as_u64().map_or(json!(1), |r| json!(r))),
                    ("call_id", outputs["call_id"].clone()),
                    ("kind", s["kind"].clone()),
                    ("current_version_id", json!(format!("ver_{id}_{count}"))),
                    ("user_edited", s["user_edited"].clone()),
                    ("names_updated", s["names_updated"].clone()),
                    (
                        "regenerated_with_edits",
                        s["regenerated_with_edits"].clone(),
                    ),
                ],
            ));
            for n in 1..=count {
                let edit = n == count && s["user_edited"] == json!(true);
                rows.push(ins(
                    "summary_versions",
                    vec![
                        ("id", json!(format!("ver_{id}_{n}"))),
                        ("summary_id", json!(id)),
                        ("n", json!(n)),
                        // An edited section's current version is the user's edit.
                        ("kind", json!(if edit { "user_edit" } else { "generated" })),
                        ("body_md", json!(body)),
                        ("lang", json!("en")),
                        ("skill_version", w["skill_version"].clone()),
                        (
                            "llm_run_id",
                            if w.is_object() && !edit {
                                json!(run)
                            } else {
                                Value::Null
                            },
                        ),
                        (
                            "from_pass",
                            w["from_pass"].as_str().map_or(json!("live"), |p| json!(p)),
                        ),
                        (
                            "created_at",
                            w["generated_at"].as_i64().map_or(json!(0), |t| json!(t)),
                        ),
                    ],
                ));
            }
        }
    }
    rows
}
