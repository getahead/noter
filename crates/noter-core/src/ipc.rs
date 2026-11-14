use super::{accounts, app, hub, lock, log, Core};
use noter_db::Direction;
use noter_protocol::ipc::{CommandCtx, CoreApi, Sink};
use noter_protocol::model::*;
use noter_protocol::*;

impl CoreApi for Core {
    async fn setup_status(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<SetupStatus, CoreError> {
        Ok(self.setup_now())
    }

    async fn setup_set_step(
        &self,
        ctx: &CommandCtx,
        args: StepArgs,
    ) -> Result<SetupStatus, CoreError> {
        self.set_step(ctx, args)
    }

    async fn setup_set_call_display(
        &self,
        ctx: &CommandCtx,
        args: CallDisplayArgs,
    ) -> Result<SetupStatus, CoreError> {
        self.set_call_display(ctx, args)
    }

    async fn setup_set_audio_storage(
        &self,
        ctx: &CommandCtx,
        args: AudioStorageArgs,
    ) -> Result<SetupStatus, CoreError> {
        self.set_audio_storage(ctx, args)
    }

    async fn permission_request(
        &self,
        ctx: &CommandCtx,
        args: PermissionArgs,
    ) -> Result<PermissionRow, CoreError> {
        self.request_permission(ctx, args).await
    }

    async fn self_test_run(
        &self,
        ctx: &CommandCtx,
        args: SelfTestArgs,
        channel: Sink<SelfTestMsg>,
    ) -> Result<SubscriptionHandle, CoreError> {
        self.start_self_test(ctx, args, channel)
    }

    async fn share_test_run(
        &self,
        _ctx: &CommandCtx,
        args: ShareTestArgs,
    ) -> Result<ShareTestResult, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-services-share-test:p1:inst-test-request
        self.share_test(args).await
        // @cpt-end:cpt-noter-flow-core-native-services-share-test:p1:inst-test-request
    }

    async fn models_download(
        &self,
        _ctx: &CommandCtx,
        args: ModelsDownloadArgs,
    ) -> Result<SetupStatus, CoreError> {
        self.download_models(args)
    }

    async fn audio_play(
        &self,
        _ctx: &CommandCtx,
        args: PlayAudioArgs,
    ) -> Result<PlaybackState, CoreError> {
        self.play_audio(args).await
    }

    async fn audio_stop(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<PlaybackState, CoreError> {
        self.stop_audio().await
    }

    async fn transcript_subscribe(
        &self,
        ctx: &CommandCtx,
        args: TranscriptSubscribeArgs,
        channel: Sink<TranscriptMsg>,
    ) -> Result<TranscriptSnapshot, CoreError> {
        let snapshot = self.subscribe_transcript(ctx, args, channel)?;
        // A live call's lines come from the engine: it runs once someone watches them.
        if snapshot.live {
            let _ = self.engine.ensure_ready().await;
        }
        Ok(snapshot)
    }

    async fn levels_subscribe(
        &self,
        ctx: &CommandCtx,
        args: SubscribeLevelsArgs,
        channel: Sink<LevelsMsg>,
    ) -> Result<SubscriptionHandle, CoreError> {
        let handle = self.subscribe_levels(ctx, args, channel)?;
        // The meters are the engine's: it runs once someone watches them.
        let _ = self.engine.ensure_ready().await;
        Ok(handle)
    }

    async fn transcript_span(
        &self,
        _ctx: &CommandCtx,
        args: SpanArgs,
    ) -> Result<SpanPreview, CoreError> {
        self.span_preview(args)
    }

    async fn transcript_rename_speaker(
        &self,
        ctx: &CommandCtx,
        args: RenameSpeakerArgs,
    ) -> Result<SpeakerMutation, CoreError> {
        self.rename_speaker(ctx, args)
    }

    async fn transcript_name_speakers(
        &self,
        ctx: &CommandCtx,
        args: NameSpeakersArgs,
    ) -> Result<SpeakerMutation, CoreError> {
        self.name_speakers(ctx, args)
    }

    async fn transcript_fix_term(
        &self,
        ctx: &CommandCtx,
        args: FixTermArgs,
    ) -> Result<FixTermResult, CoreError> {
        self.fix_term(ctx, args)
    }

    async fn audio_delete(
        &self,
        ctx: &CommandCtx,
        args: DeleteAudioArgs,
    ) -> Result<DeleteAudioResult, CoreError> {
        self.delete_audio(ctx, args)
    }

    async fn audio_delete_older(
        &self,
        ctx: &CommandCtx,
        args: DeleteOldAudioArgs,
    ) -> Result<DeleteAudioResult, CoreError> {
        self.delete_audio_older(ctx, args)
    }

    async fn update_install(&self, _ctx: &CommandCtx, _args: NoArgs) -> Result<Ack, CoreError> {
        self.install_update().await
    }

    async fn calls_list(
        &self,
        _ctx: &CommandCtx,
        args: CallsListArgs,
    ) -> Result<Page<CallRow>, CoreError> {
        self.list_calls(args)
    }

    async fn call_get(&self, _ctx: &CommandCtx, args: CallIdArgs) -> Result<CallDetail, CoreError> {
        self.get_call(args)
    }

    async fn call_update(
        &self,
        ctx: &CommandCtx,
        args: CallUpdateArgs,
    ) -> Result<CallMutation, CoreError> {
        self.update_call(ctx, args)
    }

    async fn search(
        &self,
        _ctx: &CommandCtx,
        args: SearchArgs,
    ) -> Result<SearchResults, CoreError> {
        self.search_library(args).await
    }

    async fn topics_list(&self, _ctx: &CommandCtx, _args: NoArgs) -> Result<TopicList, CoreError> {
        self.list_topics()
    }

    async fn topic_get(
        &self,
        _ctx: &CommandCtx,
        args: TopicIdArgs,
    ) -> Result<TopicThread, CoreError> {
        self.get_topic(args)
    }

    async fn topic_rename(
        &self,
        ctx: &CommandCtx,
        args: TopicRenameArgs,
    ) -> Result<TopicMutation, CoreError> {
        self.rename_topic(ctx, args)
    }

    async fn topics_merge(
        &self,
        ctx: &CommandCtx,
        args: TopicMergeArgs,
    ) -> Result<TopicMutation, CoreError> {
        self.merge_topics(ctx, args)
    }

    async fn topics_keep_separate(
        &self,
        ctx: &CommandCtx,
        args: TopicPairArgs,
    ) -> Result<Ack, CoreError> {
        self.keep_topics_separate(ctx, args)
    }

    async fn ask_scope_presets(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<ScopePresetList, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-request
        self.scope_presets()
        // @cpt-end:cpt-noter-flow-core-retrieval-ask-answer:p1:inst-ask-request
    }

    async fn ask_start(
        &self,
        ctx: &CommandCtx,
        args: AskStartArgs,
        channel: Sink<AskMsg>,
    ) -> Result<AskHandle, CoreError> {
        self.start_ask(ctx, args, channel)
    }

    async fn ask_stop(&self, _ctx: &CommandCtx, args: AskTurnArgs) -> Result<Ack, CoreError> {
        self.stop_ask(args)
    }

    async fn ask_threads_list(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<AskThreadList, CoreError> {
        self.ask_threads()
    }

    async fn ask_thread_get(
        &self,
        _ctx: &CommandCtx,
        args: AskThreadArgs,
    ) -> Result<AskThread, CoreError> {
        self.ask_thread(args)
    }

    async fn ask_thread_delete(
        &self,
        ctx: &CommandCtx,
        args: AskThreadArgs,
    ) -> Result<Ack, CoreError> {
        self.delete_ask_thread(ctx, args)
    }

    async fn call_types_list(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<CallTypeList, CoreError> {
        Ok(self.call_types_now())
    }

    async fn calls_delete(
        &self,
        ctx: &CommandCtx,
        args: CallsDeleteArgs,
    ) -> Result<DeleteResult, CoreError> {
        self.delete_calls(ctx, args)
    }

    async fn outputs_get(
        &self,
        _ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CallOutputs, CoreError> {
        self.outputs_now(&args.call_id)
    }

    async fn output_edit(
        &self,
        ctx: &CommandCtx,
        args: OutputEditArgs,
    ) -> Result<OutputMutation, CoreError> {
        self.edit_output(ctx, args)
    }

    async fn outputs_regenerate(
        &self,
        _ctx: &CommandCtx,
        args: RegenerateArgs,
    ) -> Result<JobAccepted, CoreError> {
        self.queue_regeneration(&args)
    }

    async fn output_versions(
        &self,
        _ctx: &CommandCtx,
        args: SummaryIdArgs,
    ) -> Result<VersionList, CoreError> {
        self.output_version_list(&args.summary_id)
    }

    async fn output_version_get(
        &self,
        _ctx: &CommandCtx,
        args: VersionGetArgs,
    ) -> Result<VersionBody, CoreError> {
        self.output_version(&args)
    }

    async fn history_list(
        &self,
        _ctx: &CommandCtx,
        args: HistoryListArgs,
    ) -> Result<Page<ChangeRow>, CoreError> {
        self.history_page(args)
    }

    async fn history_export(
        &self,
        _ctx: &CommandCtx,
        args: HistoryExportArgs,
    ) -> Result<ExportResult, CoreError> {
        self.export_history(args).await
    }

    async fn change_undo(
        &self,
        _ctx: &CommandCtx,
        args: UndoArgs,
    ) -> Result<UndoResult, CoreError> {
        self.reverse_change(Direction::Undo, args.target)
    }

    async fn change_redo(
        &self,
        _ctx: &CommandCtx,
        args: RedoArgs,
    ) -> Result<UndoResult, CoreError> {
        self.reverse_change(Direction::Redo, args.target)
    }

    async fn items_list(
        &self,
        _ctx: &CommandCtx,
        args: ItemsListArgs,
    ) -> Result<Page<ItemView>, CoreError> {
        self.list_items(args)
    }

    async fn people_list(
        &self,
        _ctx: &CommandCtx,
        args: PeopleListArgs,
    ) -> Result<PeopleList, CoreError> {
        self.list_people(args)
    }

    async fn person_get(
        &self,
        _ctx: &CommandCtx,
        args: PersonIdArgs,
    ) -> Result<PersonPage, CoreError> {
        self.get_person(args)
    }

    async fn person_create(
        &self,
        ctx: &CommandCtx,
        args: PersonCreateArgs,
    ) -> Result<PersonMutation, CoreError> {
        self.create_person(ctx, args)
    }

    async fn person_update(
        &self,
        ctx: &CommandCtx,
        args: PersonUpdateArgs,
    ) -> Result<PersonMutation, CoreError> {
        self.update_person(ctx, args)
    }

    async fn people_merge(
        &self,
        ctx: &CommandCtx,
        args: PeopleMergeArgs,
    ) -> Result<PersonMutation, CoreError> {
        self.merge_people(ctx, args)
    }

    async fn person_delete(
        &self,
        ctx: &CommandCtx,
        args: PersonIdArgs,
    ) -> Result<DeleteResult, CoreError> {
        self.delete_person(ctx, args)
    }

    async fn voice_profile_create(
        &self,
        ctx: &CommandCtx,
        args: VoiceProfileArgs,
    ) -> Result<VoiceProfileView, CoreError> {
        self.create_voice_profile(ctx, args).await
    }

    async fn voice_profile_delete(
        &self,
        ctx: &CommandCtx,
        args: PersonIdArgs,
    ) -> Result<VoiceProfileView, CoreError> {
        self.delete_voice_profile(ctx, args)
    }

    async fn today_get(&self, _ctx: &CommandCtx, _args: NoArgs) -> Result<TodayView, CoreError> {
        self.today_view()
    }

    async fn call_tags_set(
        &self,
        ctx: &CommandCtx,
        args: TagsSetArgs,
    ) -> Result<TagsSetResult, CoreError> {
        self.set_call_tags(ctx, args)
    }

    async fn share_copy(
        &self,
        _ctx: &CommandCtx,
        args: ShareCopyArgs,
    ) -> Result<ShareResult, CoreError> {
        self.copy_share(args).await
    }

    async fn calls_export(
        &self,
        _ctx: &CommandCtx,
        args: ExportCallsArgs,
    ) -> Result<ExportResult, CoreError> {
        self.export_calls(args).await
    }

    async fn tags_list(&self, _ctx: &CommandCtx, _args: NoArgs) -> Result<TagList, CoreError> {
        self.list_tags()
    }

    async fn item_get(&self, _ctx: &CommandCtx, args: ItemIdArgs) -> Result<ItemDetail, CoreError> {
        self.get_item(args)
    }

    async fn item_set_done(
        &self,
        ctx: &CommandCtx,
        args: ItemDoneArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.set_item_done(ctx, args)
    }

    async fn item_review(
        &self,
        ctx: &CommandCtx,
        args: ItemReviewArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.review_item(ctx, args)
    }

    async fn items_review_all(
        &self,
        ctx: &CommandCtx,
        args: ReviewAllArgs,
    ) -> Result<ItemsBatchResult, CoreError> {
        self.review_all_items(ctx, args)
    }

    async fn item_edit(
        &self,
        ctx: &CommandCtx,
        args: ItemEditArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.edit_item(ctx, args)
    }

    async fn item_reopen(
        &self,
        ctx: &CommandCtx,
        args: ItemReopenArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.reopen_item(ctx, args)
    }

    async fn item_create(
        &self,
        ctx: &CommandCtx,
        args: ItemCreateArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.create_item(ctx, args)
    }

    async fn item_answer_handoff_landed(
        &self,
        ctx: &CommandCtx,
        args: HandoffLandedArgs,
    ) -> Result<ItemMutation, CoreError> {
        self.answer_handoff(ctx, args)
    }

    async fn handoff_get(
        &self,
        _ctx: &CommandCtx,
        args: ItemIdArgs,
    ) -> Result<HandoffView, CoreError> {
        self.handoff_view(args.item_id.as_str())
    }

    async fn handoff_generate(
        &self,
        _ctx: &CommandCtx,
        args: HandoffGenerateArgs,
    ) -> Result<HandoffView, CoreError> {
        self.generate_handoff(args)
    }

    async fn handoff_cancel(
        &self,
        _ctx: &CommandCtx,
        args: ItemIdArgs,
    ) -> Result<HandoffView, CoreError> {
        self.cancel_handoff(args)
    }

    async fn handoff_edit(
        &self,
        ctx: &CommandCtx,
        args: HandoffEditArgs,
    ) -> Result<HandoffView, CoreError> {
        self.edit_handoff(ctx, args)
    }

    async fn handoff_set_target(
        &self,
        _ctx: &CommandCtx,
        args: HandoffTargetArgs,
    ) -> Result<HandoffView, CoreError> {
        self.target_handoff(args)
    }

    async fn handoff_open(
        &self,
        ctx: &CommandCtx,
        args: ItemIdArgs,
    ) -> Result<HandoffOpenResult, CoreError> {
        self.open_handoff(ctx, args).await
    }

    async fn handoff_copy(
        &self,
        ctx: &CommandCtx,
        args: ItemIdArgs,
    ) -> Result<HandoffCopyResult, CoreError> {
        self.copy_handoff(ctx, args).await
    }

    async fn sources_list(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<SourceList, CoreError> {
        self.list_sources()
    }

    async fn source_add_folder(
        &self,
        ctx: &CommandCtx,
        args: SourceAddFolderArgs,
    ) -> Result<SourceRow, CoreError> {
        self.add_folder_source(ctx, args).await
    }

    async fn source_update(
        &self,
        ctx: &CommandCtx,
        args: SourceUpdateArgs,
    ) -> Result<SourceRow, CoreError> {
        self.update_source(ctx, args)
    }

    async fn source_reindex(
        &self,
        _ctx: &CommandCtx,
        args: SourceIdArgs,
    ) -> Result<SourceRow, CoreError> {
        self.reindex_source(args)
    }

    async fn source_remove(
        &self,
        ctx: &CommandCtx,
        args: SourceIdArgs,
    ) -> Result<DeleteResult, CoreError> {
        self.remove_source(ctx, args)
    }

    async fn source_add_mcp(
        &self,
        ctx: &CommandCtx,
        args: SourceAddMcpArgs,
    ) -> Result<SourceRow, CoreError> {
        self.add_mcp_source(ctx, args).await
    }

    async fn source_revoke_token(
        &self,
        ctx: &CommandCtx,
        args: SourceIdArgs,
    ) -> Result<SourceRow, CoreError> {
        self.revoke_source_token(ctx, args)
    }

    async fn repos_list(&self, _ctx: &CommandCtx, _args: NoArgs) -> Result<RepoList, CoreError> {
        self.list_repos()
    }

    async fn repo_upsert(
        &self,
        ctx: &CommandCtx,
        args: RepoUpsertArgs,
    ) -> Result<RepoList, CoreError> {
        self.upsert_repo(ctx, args).await
    }

    async fn repo_remove(&self, ctx: &CommandCtx, args: RepoIdArgs) -> Result<RepoList, CoreError> {
        self.remove_repo(ctx, args)
    }

    async fn window_show_call(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<CallWindowState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-show-call
        Ok(self.show_call(true))
        // @cpt-end:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-show-call
    }

    async fn window_hide_call(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<CallWindowState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-layout-commands
        Ok(self.hide_call())
        // @cpt-end:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-layout-commands
    }

    async fn window_call_state(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<CallWindowState, CoreError> {
        Ok(self.call_window_now())
    }

    async fn window_share_warning_seen(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<CallWindowState, CoreError> {
        Ok(self.share_warning_seen())
    }

    async fn window_set_call_layout(
        &self,
        ctx: &CommandCtx,
        args: CallLayoutArgs,
    ) -> Result<CallWindowState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-layout-commands
        self.set_call_layout(ctx, args)
        // @cpt-end:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-layout-commands
    }

    async fn window_set_collapsed(
        &self,
        _ctx: &CommandCtx,
        args: CollapseArgs,
    ) -> Result<CallWindowState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-layout-commands
        Ok(self.set_call_collapsed(args.collapsed))
        // @cpt-end:cpt-noter-flow-core-native-surfaces-call-window:p1:inst-layout-commands
    }

    async fn app_set_hidden_for_presenting(
        &self,
        _ctx: &CommandCtx,
        args: HiddenArgs,
    ) -> Result<PresentingState, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-presenting-call
        Ok(self.set_hidden_for_presenting(args.hidden))
        // @cpt-end:cpt-noter-flow-core-native-surfaces-presenting:p1:inst-presenting-call
    }

    async fn window_navigate(
        &self,
        _ctx: &CommandCtx,
        args: NavigateArgs,
    ) -> Result<Ack, CoreError> {
        self.navigate(args.target);
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-return-nav
        Ok(Ack {})
        // @cpt-end:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-return-nav
    }

    async fn window_report_view(
        &self,
        _ctx: &CommandCtx,
        args: ViewReportArgs,
    ) -> Result<Ack, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-report-view
        self.report_view(args.call_id);
        // @cpt-end:cpt-noter-flow-core-native-surfaces-navigation:p2:inst-report-view
        Ok(Ack {})
    }

    async fn window_announce(
        &self,
        _ctx: &CommandCtx,
        args: AnnounceArgs,
    ) -> Result<Ack, CoreError> {
        self.announce(args)?;
        Ok(Ack {})
    }

    async fn window_fit(&self, _ctx: &CommandCtx, args: FitArgs) -> Result<Ack, CoreError> {
        self.fit_record_prompt(args)?;
        Ok(Ack {})
    }

    async fn window_set_fix_term_enabled(
        &self,
        _ctx: &CommandCtx,
        args: FixTermEnabledArgs,
    ) -> Result<Ack, CoreError> {
        self.deps.surfaces.set_fix_term_enabled(args.enabled);
        Ok(Ack {})
    }

    async fn open_external(
        &self,
        _ctx: &CommandCtx,
        args: OpenExternalArgs,
    ) -> Result<Ack, CoreError> {
        self.open_external(args.target)?;
        Ok(Ack {})
    }

    async fn settings_get(&self, _ctx: &CommandCtx, _args: NoArgs) -> Result<Settings, CoreError> {
        Ok(lock(&self.settings).clone())
    }

    async fn settings_update(
        &self,
        ctx: &CommandCtx,
        args: SettingsUpdateArgs,
    ) -> Result<Settings, CoreError> {
        self.update_settings(ctx, args)
    }

    async fn settings_unignore_app(
        &self,
        ctx: &CommandCtx,
        args: AppIdArgs,
    ) -> Result<Settings, CoreError> {
        self.unignore_app(ctx, args)
    }

    async fn hotkeys_list(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<HotkeyList, CoreError> {
        Ok(lock(&self.hotkeys).clone())
    }

    async fn hotkey_set(
        &self,
        ctx: &CommandCtx,
        args: HotkeySetArgs,
    ) -> Result<HotkeyList, CoreError> {
        self.set_hotkey(ctx, args)
    }

    async fn hotkeys_reset(
        &self,
        ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<HotkeyList, CoreError> {
        self.reset_hotkeys(ctx)
    }

    async fn glossary_list(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<GlossaryList, CoreError> {
        self.glossary()
    }

    async fn glossary_upsert(
        &self,
        ctx: &CommandCtx,
        args: GlossaryUpsertArgs,
    ) -> Result<GlossaryList, CoreError> {
        self.upsert_term(ctx, args)
    }

    async fn glossary_remove(
        &self,
        ctx: &CommandCtx,
        args: GlossaryIdArgs,
    ) -> Result<GlossaryList, CoreError> {
        self.remove_term(ctx, args)
    }

    async fn capture_start(
        &self,
        ctx: &CommandCtx,
        args: CaptureStartArgs,
    ) -> Result<CaptureState, CoreError> {
        self.start_call(ctx, args).await
    }

    async fn capture_stop(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        self.stop_call(ctx, args).await
    }

    async fn capture_set_paused(
        &self,
        ctx: &CommandCtx,
        args: CapturePauseArgs,
    ) -> Result<CaptureState, CoreError> {
        self.pause_call(ctx, args).await
    }

    async fn capture_mark_moment(
        &self,
        _ctx: &CommandCtx,
        args: MarkMomentArgs,
    ) -> Result<MarkView, CoreError> {
        self.mark_moment(args).await
    }

    async fn capture_continue(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        self.continue_call(ctx, args).await
    }

    async fn capture_discard(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        self.discard_call(ctx, args).await
    }

    async fn capture_resume_interrupted(
        &self,
        ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        self.resume_interrupted(ctx, args).await
    }

    async fn capture_answer_call_end(
        &self,
        ctx: &CommandCtx,
        args: CallEndAnswerArgs,
    ) -> Result<CaptureState, CoreError> {
        self.answer_call_end(ctx, args).await
    }

    async fn capture_hold_notice(
        &self,
        _ctx: &CommandCtx,
        args: NoticeHoldArgs,
    ) -> Result<CaptureState, CoreError> {
        self.hold_notice(args).await
    }

    async fn capture_answer_new_meeting(
        &self,
        ctx: &CommandCtx,
        args: NewMeetingAnswerArgs,
    ) -> Result<CaptureState, CoreError> {
        self.answer_new_meeting(ctx, args).await
    }

    async fn capture_keep_recording(
        &self,
        _ctx: &CommandCtx,
        args: CallIdArgs,
    ) -> Result<CaptureState, CoreError> {
        self.keep_recording(args).await
    }

    async fn capture_keep_source(
        &self,
        _ctx: &CommandCtx,
        args: KeepSourceArgs,
    ) -> Result<CaptureState, CoreError> {
        self.keep_source(args).await
    }

    async fn capture_exclude_source(
        &self,
        _ctx: &CommandCtx,
        args: ExcludeSourceArgs,
    ) -> Result<CaptureState, CoreError> {
        self.exclude_source(args).await
    }

    async fn capture_dismiss_detection(
        &self,
        _ctx: &CommandCtx,
        args: DismissDetectionArgs,
    ) -> Result<Ack, CoreError> {
        self.dismiss_detection(args)
    }

    async fn capture_ignore_app(
        &self,
        ctx: &CommandCtx,
        args: IgnoreAppArgs,
    ) -> Result<Ack, CoreError> {
        self.ignore_app(ctx, args)
    }

    async fn capture_set_sensitive(
        &self,
        ctx: &CommandCtx,
        args: SensitiveArgs,
    ) -> Result<CaptureState, CoreError> {
        self.set_call_sensitive(ctx, args).await
    }

    // @cpt-flow:cpt-noter-flow-core-credentials-privacy-keys:p1
    async fn accounts_get(
        &self,
        _ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<AccountsView, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-read
        Ok(self.refresh_accounts().await)
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-keys:p1:inst-key-read
    }

    async fn api_key_set(
        &self,
        ctx: &CommandCtx,
        args: ApiKeySetArgs,
    ) -> Result<AccountsView, CoreError> {
        accounts::api_key_set(self, ctx, args).await
    }

    async fn api_key_remove(
        &self,
        ctx: &CommandCtx,
        args: KeyProviderArgs,
    ) -> Result<AccountsView, CoreError> {
        self.remove_key(ctx, args.provider).await
    }

    // @cpt-flow:cpt-noter-flow-core-credentials-privacy-audit:p1
    async fn audit_list(
        &self,
        _ctx: &CommandCtx,
        args: AuditListArgs,
    ) -> Result<Page<AuditEntry>, CoreError> {
        self.audit_page(args)
    }

    async fn audit_export(
        &self,
        _ctx: &CommandCtx,
        args: AuditExportArgs,
    ) -> Result<ExportResult, CoreError> {
        self.export_audit(args).await
    }

    // @cpt-flow:cpt-noter-flow-core-credentials-privacy-storage:p1
    async fn storage_move(
        &self,
        _ctx: &CommandCtx,
        _args: StorageMoveArgs,
    ) -> Result<JobAccepted, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-storage:p1:inst-storage-guard
        // Q4 (20 Oct): the app stays unsandboxed and the engine sandboxed, so the move does not
        // ship (TL-29).
        Err(CoreError::new(ErrorCode::NotImplemented, "storage_move"))
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-storage:p1:inst-storage-guard
    }

    // @cpt-flow:cpt-noter-flow-core-credentials-privacy-prepare:p1
    async fn account_signin_prepare(
        &self,
        _ctx: &CommandCtx,
        args: AccountProviderArgs,
    ) -> Result<SignInPrepare, CoreError> {
        self.signin_prepare(args.provider).await
    }

    // @cpt-flow:cpt-noter-flow-core-credentials-privacy-signin:p1
    async fn account_signin_start(
        &self,
        ctx: &CommandCtx,
        args: SignInStartArgs,
    ) -> Result<SignInSession, CoreError> {
        self.signin_start(ctx, args).await
    }

    async fn account_signin_cancel(
        &self,
        _ctx: &CommandCtx,
        args: SignInSessionArgs,
    ) -> Result<AccountsView, CoreError> {
        self.signin_cancel(&args.session_id).await
    }

    async fn account_use_existing(
        &self,
        ctx: &CommandCtx,
        args: AccountProviderArgs,
    ) -> Result<AccountsView, CoreError> {
        self.use_existing(ctx, args.provider).await
    }

    // @cpt-flow:cpt-noter-flow-core-credentials-privacy-bind-signout:p1
    async fn account_bind_agents(
        &self,
        ctx: &CommandCtx,
        args: AccountBindArgs,
    ) -> Result<AccountBindResult, CoreError> {
        self.bind_agents(ctx, args).await
    }

    async fn account_test(
        &self,
        _ctx: &CommandCtx,
        args: AccountProviderArgs,
    ) -> Result<AccountTestResult, CoreError> {
        self.account_test_now(args.provider).await
    }

    async fn account_sign_out(
        &self,
        ctx: &CommandCtx,
        args: SignOutArgs,
    ) -> Result<AccountsView, CoreError> {
        self.sign_out(ctx, args).await
    }

    async fn cli_install(
        &self,
        _ctx: &CommandCtx,
        args: CliInstallArgs,
    ) -> Result<JobAccepted, CoreError> {
        self.queue_install(args.tool)
    }

    async fn app_snapshot(
        &self,
        ctx: &CommandCtx,
        _args: NoArgs,
    ) -> Result<AppSnapshot, CoreError> {
        Ok(app::app_snapshot(self, ctx))
    }

    async fn stream_ack(&self, _ctx: &CommandCtx, args: StreamAckArgs) -> Result<Ack, CoreError> {
        Ok(hub::stream_ack(self, args))
    }

    async fn stream_unsubscribe(
        &self,
        _ctx: &CommandCtx,
        args: UnsubscribeArgs,
    ) -> Result<Ack, CoreError> {
        Ok(hub::stream_unsubscribe(self, args))
    }

    async fn banner_dismiss(
        &self,
        _ctx: &CommandCtx,
        args: BannerDismissArgs,
    ) -> Result<BannerSet, CoreError> {
        app::banner_dismiss(self, args).await
    }

    async fn log_ui(&self, ctx: &CommandCtx, args: UiLogArgs) -> Result<Ack, CoreError> {
        log::log_ui(self, ctx, args)
    }
}
