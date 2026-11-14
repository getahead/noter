use super::*;
use crate::Core;
use noter_db::Mutation;
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::CommandCtx;
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::json;

impl Core {
    // @cpt-flow:cpt-noter-flow-core-postcall-edit:p1
    // @cpt-begin:cpt-noter-flow-core-postcall-edit:p1:inst-edit-get
    /// `outputs_get`: every section of the call in order, with its state and provenance.
    pub(crate) fn outputs_now(&self, call: &CallId) -> Result<CallOutputs, CoreError> {
        let id = call.as_str().to_owned();
        let (head, rows) = self
            .store()
            .read(move |c| match header(c, &id)? {
                Some(head) => Ok(Some((head, stored(c, "call_id", &id)?))),
                None => Ok(None),
            })?
            .ok_or_else(|| not_found("call"))?;
        let mut kinds = sections_of(&head.call_type);
        for row in &rows {
            if !kinds.contains(&row.kind) {
                kinds.push(row.kind);
            }
        }
        // Item sections list the call's items of their kind; a rejected suggestion is gone (D75).
        // shortcut: one page (500 items per call), page through if a call can hold more.
        let listed: Vec<ItemView> = self
            .list_items(ItemsListArgs {
                filter: ItemFilter {
                    call_id: Some(call.clone()),
                    ..ItemFilter::default()
                },
                page: PageRequest {
                    cursor: None,
                    limit: Some(500),
                },
            })?
            .rows;
        let (rejected, items): (Vec<ItemView>, Vec<ItemView>) = listed
            .into_iter()
            .partition(|i| i.review == ReviewState::Rejected);
        let sections: Vec<OutputSection> = kinds
            .into_iter()
            .map(|kind| {
                let row = rows.iter().find(|s| s.kind == kind);
                let mut out = section(row, kind, self.postcall.get(call, kind));
                out.items = items
                    .iter()
                    .filter(|i| item_section(i.kind) == kind)
                    .cloned()
                    .collect();
                // Regeneration never suggests a rejected item again (store_items).
                out.suppressed_count = rejected
                    .iter()
                    .filter(|i| item_section(i.kind) == kind)
                    .count() as u32;
                out
            })
            .collect();
        let writing = sections.iter().any(|s| s.state == SectionState::Writing);
        Ok(CallOutputs {
            call_id: call.clone(),
            status: if writing {
                OutputsStatus::Writing
            } else {
                word(&head.outputs_status).unwrap_or(OutputsStatus::NotStarted)
            },
            archive: word(&head.archive_status).unwrap_or(ArchiveStatus::NotStarted),
            review_waiting: items
                .iter()
                .filter(|i| i.review == ReviewState::Suggested)
                .count() as u32,
            sensitive: head.sensitive,
            written_locally: sections.iter().any(|s| {
                s.writer
                    .as_ref()
                    .is_some_and(|w| w.runtime == RuntimeChoice::Local)
            }),
            sections,
        })
    }
    // @cpt-end:cpt-noter-flow-core-postcall-edit:p1:inst-edit-get

    pub(super) fn section_now(
        &self,
        call: &CallId,
        kind: SectionKind,
    ) -> Result<OutputSection, CoreError> {
        self.outputs_now(call)?
            .sections
            .into_iter()
            .find(|s| s.kind == kind)
            .ok_or_else(|| not_found("section"))
    }

    /// `output_edit`: a new user-edit version becomes the section's current one, under its `rev`.
    pub(crate) fn edit_output(
        &self,
        ctx: &CommandCtx,
        args: OutputEditArgs,
    ) -> Result<OutputMutation, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-postcall-edit:p1:inst-edit-validate
        let call = args.call_id.as_str().to_owned();
        let id = args.summary_id.as_str().to_owned();
        let (head, found) = self
            .store()
            .read(move |c| Ok((header(c, &call)?, stored(c, "id", &id)?.pop())))?;
        head.ok_or_else(|| not_found("call"))?;
        let stored = found.ok_or_else(|| not_found("section"))?;
        if stored.call_id != args.call_id.as_str() {
            return Err(CoreError::new(
                ErrorCode::InvalidInput,
                "the section belongs to another call",
            ));
        }
        if noter_llm::raw_html(&args.body_md) {
            return Err(
                CoreError::new(ErrorCode::InvalidInput, "Markdown only, no HTML").with_detail(
                    ErrorDetail::Validation {
                        field: "body_md".into(),
                        rule: ValidationRule::InvalidFormat,
                    },
                ),
            );
        }
        // @cpt-end:cpt-noter-flow-core-postcall-edit:p1:inst-edit-validate
        // @cpt-begin:cpt-noter-flow-core-postcall-edit:p1:inst-edit-commit
        // The generated base stays a version of its own; undo moves the section back to it.
        let version = format!("ver_{}", ulid::Ulid::generate());
        let rows = vec![
            Mutation {
                entity_type: "summary_version",
                table: "summary_versions",
                id: version.clone(),
                base_rev: None,
                bump_rev: false,
                values: vec![
                    ("summary_id", json!(stored.id)),
                    ("n", json!(stored.versions + 1)),
                    ("kind", json!("user_edit")),
                    ("body_md", json!(args.body_md)),
                    ("lang", json!(stored.lang)),
                    ("from_pass", json!(stored.from_pass)),
                    ("created_at", json!(self.deps.clock.now().0)),
                ],
            },
            Mutation {
                entity_type: "summary",
                table: "summaries",
                id: stored.id.clone(),
                base_rev: Some(args.rev),
                bump_rev: true,
                values: vec![
                    ("current_version_id", json!(version)),
                    ("user_edited", json!(1)),
                ],
            },
        ];
        let what = text_of(&stored.kind).replace('_', " ");
        let meta = self.change_meta(ctx, format!("Edited the {what}"), "output_edit");
        let written = self.store().write_batch(rows, meta)?;
        // @cpt-end:cpt-noter-flow-core-postcall-edit:p1:inst-edit-commit
        // @cpt-begin:cpt-noter-flow-core-postcall-edit:p1:inst-edit-publish
        // No index holds a section's body yet (FTS is M3).
        let section = self.section_now(&args.call_id, stored.kind)?;
        self.progress(&args.call_id, stored.kind, section.state.clone());
        self.emit_entity_changed(&EntityChanged::Section {
            call_id: args.call_id.clone(),
            section: section.clone(),
        });
        self.write_files(&args.call_id);
        Ok(OutputMutation {
            section,
            change_id: written[1].change_id.clone(),
        })
        // @cpt-end:cpt-noter-flow-core-postcall-edit:p1:inst-edit-publish
    }

    fn versions_of(&self, summary: &SummaryId) -> Result<Vec<(VersionMeta, String)>, CoreError> {
        let id = summary.as_str().to_owned();
        let rows = self.store().read(move |c| {
            let mut stmt = c.prepare(
                "SELECT v.id, v.n, v.kind, v.body_md, l.runtime_choice, l.model, k.call_type,
                        v.skill_version, v.created_at, v.from_pass
                 FROM summary_versions v
                 JOIN summaries s ON s.id = v.summary_id
                 JOIN calls k ON k.id = s.call_id
                 LEFT JOIN llm_runs l ON l.id = v.llm_run_id
                 WHERE v.summary_id = ?1 ORDER BY v.n",
            )?;
            let rows = stmt.query_map([&id], |r| {
                let kind = if r.get::<_, String>(2)? == "user_edit" {
                    VersionKind::UserEdit
                } else {
                    VersionKind::Generated
                };
                let meta = VersionMeta {
                    id: VersionId::new(r.get::<_, String>(0)?),
                    n: r.get(1)?,
                    kind,
                    writer: writer_at(r, 4)?,
                    created_at: TimestampMs(r.get(8)?),
                };
                Ok((meta, r.get::<_, String>(3)?))
            })?;
            rows.collect::<Result<Vec<_>, _>>()
        })?;
        if rows.is_empty() {
            return Err(not_found("section"));
        }
        Ok(rows)
    }

    // @cpt-begin:cpt-noter-flow-core-postcall-edit:p1:inst-edit-versions
    /// `output_versions`: every version of a section, oldest first.
    pub(crate) fn output_version_list(
        &self,
        summary: &SummaryId,
    ) -> Result<VersionList, CoreError> {
        let versions = self.versions_of(summary)?.into_iter().map(|(m, _)| m);
        Ok(VersionList {
            versions: versions.collect(),
        })
    }

    /// `output_version_get`: one version's whole body, for the UI's diff.
    pub(crate) fn output_version(&self, args: &VersionGetArgs) -> Result<VersionBody, CoreError> {
        let (meta, body_md) = self
            .versions_of(&args.summary_id)?
            .into_iter()
            .find(|(m, _)| m.id == args.version_id)
            .ok_or_else(|| not_found("version"))?;
        // @cpt-begin:cpt-noter-flow-core-postcall-edit:p1:inst-edit-return
        Ok(VersionBody { meta, body_md })
        // @cpt-end:cpt-noter-flow-core-postcall-edit:p1:inst-edit-return
    }
    // @cpt-end:cpt-noter-flow-core-postcall-edit:p1:inst-edit-versions

    /// `outputs_regenerate`: queues a Regeneration run of the call with the requested sections
    /// (none means all), runtime, model, skill and local rewrite.
    pub(crate) fn queue_regeneration(
        &self,
        args: &RegenerateArgs,
    ) -> Result<JobAccepted, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-request
        let id = args.call_id.as_str().to_owned();
        let head = self
            .store()
            .read(move |c| header(c, &id))?
            .ok_or_else(|| not_found("call"))?;
        let known = sections_of(&head.call_type);
        let unknown = args
            .sections
            .iter()
            .any(|k| *k != SectionKind::RoleReviews && !known.contains(k));
        if unknown {
            return Err(CoreError::new(
                ErrorCode::InvalidInput,
                "the call type has no such section",
            ));
        }
        let blocked = || CoreError::new(ErrorCode::JobBlocked, "a call is being recorded");
        if self.capture_guard.borrow().live {
            return Err(blocked());
        }
        let req = Request::for_call(JobKind::Regeneration, Trigger::OnDemand, &args.call_id);
        self.postcall.request(args);
        let run = self.in_runtime(|| self.jobs.trigger(req))?;
        Ok(JobAccepted {
            job_run_id: run.ok_or_else(blocked)?,
        })
        // @cpt-end:cpt-noter-flow-core-postcall-regenerate:p1:inst-regen-request
    }

    /// After an undo or redo of a section: its new state goes out as progress.
    pub(crate) fn publish_section(&self, summary: &str) -> Result<(), CoreError> {
        let id = summary.to_owned();
        let found = self.store().read(move |c| stored(c, "id", &id))?.pop();
        if let Some(s) = found {
            let call = CallId::new(s.call_id);
            let section = self.section_now(&call, s.kind)?;
            self.progress(&call, s.kind, section.state.clone());
            self.emit_entity_changed(&EntityChanged::Section {
                call_id: call.clone(),
                section,
            });
            self.write_files(&call);
        }
        Ok(())
    }
}
