//! Settings: each section of `Settings` is one row of `settings` (JSON), with one settings
//! revision for all of them; a write replaces one whole section (DESIGN-core › Settings).

// @cpt-component:cpt-noter-component-core-settings:p1

use noter_db::rusqlite::{params, OptionalExtension, Transaction};
use noter_db::{Logged, Store};
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::{event_names, CommandCtx};
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{Map, Value};

use crate::app::WholeState;
use crate::{internal, lock, Core};

impl WholeState for Settings {
    fn version(&mut self) -> &mut StateVersion {
        &mut self.version
    }
}

/// Every section at its default (PRD › 14 Settings), at version 1 and rev 1.
pub fn default_settings() -> Settings {
    Settings {
        version: StateVersion(1),
        rev: Rev(1),
        general: GeneralSettings {
            storage_path: "~/Library/Application Support/Noter".into(),
            storage_in_cloud_folder: false,
            ignored_apps: vec![],
            summary_language: SummaryLanguage::En,
            notifications_enabled: false,
            launch_at_login: true,
            offer_to_record: true,
        },
        audio: AudioSettings {
            live_backend: TranscriptionBackend::WhisperTurboNoterLoop,
            offline_backend: TranscriptionBackend::WhisperLargeV3,
            output: AudioOutputSettings {
                headphones_devices: vec![],
            },
            exclude_own_sounds: true,
            retention: AudioRetention::Days30,
            retention_next_run_deletes: 0,
            mic_device: None,
        },
        privacy: PrivacySettings {
            mode: PrivacyMode::CloudRedacted,
            pseudonymise_names: false,
            behaviour_metrics: false,
        },
        runtimes: RuntimeSettings {
            live_copilot: RuntimeChoice::ClaudeApiKey,
            post_call: RuntimeChoice::ClaudeApiKey,
            search_answers: RuntimeChoice::ClaudeApiKey,
            local_model: None,
        },
        copilot: CopilotSettings {
            card_keys: default_card_keys(),
            dismiss_with_keys: false,
            default_cap_usd: 1.0,
            muted_call_types: vec![],
            default_council_live: CouncilMode::Fused,
            default_council_post_call: CouncilMode::Parallel,
        },
        call_screen: CallScreenSettings {
            display_id: None,
            layout: CallLayoutPreference::Auto,
            open_automatically: true,
        },
        menu_bar: MenuBarSettings {
            title: MenuBarTitle::None,
            hidden_actions: vec![],
        },
        today: TodaySettings {
            horizon: DashboardHorizon::ThisWeek,
            hidden_calendars: vec![],
            ranking: TodayRanking::OwedToTodaysPeople,
        },
        performance: PerformanceSettings {
            near_pct: 90,
            over_pct: 105,
            retention_days: 365,
            sampled_stages: vec![],
        },
        maintenance: MaintenanceSettings {
            window_start: "02:00".into(),
            window_end: "05:00".into(),
            allow_on_battery: false,
            backups_kept: 7,
        },
        evidence: EvidenceSettings {
            jira: true,
            bitbucket: true,
            github: true,
            later_calls: true,
        },
        updates: UpdateSettings {
            channel: UpdateChannel::Stable,
            install_automatically: true,
        },
    }
}

/// Card keys: on, with ⌃⌥⌘.
pub(crate) fn default_card_keys() -> CardKeySettings {
    CardKeySettings {
        enabled: true,
        modifiers: Modifiers {
            control: true,
            option: true,
            command: true,
        },
    }
}

/// The stored settings, each section of the current shape.
// @cpt-algo:cpt-noter-algo-core-settings-validate:p1
pub(crate) fn load(store: &Store) -> Result<Settings, CoreError> {
    let rows: Vec<(String, String)> = store.read(|c| {
        let mut stmt = c.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect()
    })?;
    // @cpt-begin:cpt-noter-algo-core-settings-validate:p1:inst-defaults
    let mut settings = default_settings();
    let defaults = serde_json::to_value(&settings).map_err(internal)?;
    // @cpt-end:cpt-noter-algo-core-settings-validate:p1:inst-defaults
    for (key, value) in rows {
        if key == "rev" {
            settings.rev = Rev(value.parse().map_err(internal)?);
            continue;
        }
        let Some(default) = defaults
            .get(&key)
            .filter(|_| !matches!(key.as_str(), "version" | "rev"))
        else {
            continue; // hotkeys, setup and other rows belong to other readers
        };
        // @cpt-begin:cpt-noter-algo-core-settings-validate:p1:inst-migrate-shape
        let Ok(stored) = serde_json::from_str::<Value>(&value) else {
            continue;
        };
        let current = merged(default, &stored);
        // @cpt-end:cpt-noter-algo-core-settings-validate:p1:inst-migrate-shape
        // @cpt-begin:cpt-noter-algo-core-settings-validate:p1:inst-check-values
        let tagged = serde_json::json!({ "section": key, "value": current });
        let section = serde_json::from_value::<SettingsSection>(tagged);
        // @cpt-end:cpt-noter-algo-core-settings-validate:p1:inst-check-values
        // @cpt-begin:cpt-noter-algo-core-settings-validate:p1:inst-return-section
        if let Ok(section) = section {
            apply(&mut settings, section);
        }
        // @cpt-end:cpt-noter-algo-core-settings-validate:p1:inst-return-section
    }
    Ok(settings)
}

/// A stored value over its default: fields the default has keep the stored value, missing
/// ones take the default, and fields the current shape no longer has are left out.
fn merged(default: &Value, stored: &Value) -> Value {
    match (default, stored) {
        (Value::Object(d), Value::Object(s)) => {
            let fields: Map<String, Value> = d
                .iter()
                .map(|(k, dv)| {
                    (
                        k.clone(),
                        s.get(k).map_or_else(|| dv.clone(), |sv| merged(dv, sv)),
                    )
                })
                .collect();
            Value::Object(fields)
        }
        (_, stored) => stored.clone(),
    }
}

/// A submitted section: values outside their ranges are `invalid_input` naming the field.
pub(crate) fn check(section: &SettingsSection) -> Result<(), CoreError> {
    match section {
        SettingsSection::Copilot(c) => {
            let m = c.card_keys.modifiers;
            if !(m.control || m.option || m.command) {
                return Err(invalid("card_keys.modifiers", ValidationRule::NoModifier));
            }
            if !(c.default_cap_usd.is_finite() && c.default_cap_usd >= 0.0) {
                return Err(invalid("default_cap_usd", ValidationRule::OutOfRange));
            }
        }
        SettingsSection::Performance(p) if p.near_pct >= p.over_pct => {
            return Err(invalid("over_pct", ValidationRule::OutOfRange));
        }
        SettingsSection::Maintenance(m) => {
            for (field, time) in [
                ("window_start", &m.window_start),
                ("window_end", &m.window_end),
            ] {
                if !is_clock_time(time) {
                    return Err(invalid(field, ValidationRule::InvalidFormat));
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// `HH:MM`, 00:00 to 23:59.
fn is_clock_time(t: &str) -> bool {
    let Some((h, m)) = t.split_once(':') else {
        return false;
    };
    let two_digits = |s: &str| s.len() == 2 && s.bytes().all(|b| b.is_ascii_digit());
    two_digits(h) && two_digits(m) && h < "24" && m < "60"
}

pub(crate) fn invalid(field: &str, rule: ValidationRule) -> CoreError {
    CoreError::new(ErrorCode::InvalidInput, format!("{field}: {rule:?}")).with_detail(
        ErrorDetail::Validation {
            field: field.into(),
            rule,
        },
    )
}

/// The section's row key and its value, as stored.
fn parts(section: &SettingsSection) -> Result<(String, Value), CoreError> {
    let tagged = serde_json::to_value(section).map_err(internal)?;
    let key = tagged["section"]
        .as_str()
        .ok_or_else(|| internal("section without a name"))?
        .to_string();
    Ok((key, tagged["value"].clone()))
}

pub(crate) fn section_of(settings: &Settings, key: &str) -> Result<Value, CoreError> {
    Ok(serde_json::to_value(settings).map_err(internal)?[key].clone())
}

pub(crate) fn apply(settings: &mut Settings, section: SettingsSection) {
    match section {
        SettingsSection::General(v) => settings.general = v,
        SettingsSection::Audio(v) => settings.audio = v,
        SettingsSection::Privacy(v) => settings.privacy = v,
        SettingsSection::Runtimes(v) => settings.runtimes = v,
        SettingsSection::Copilot(v) => settings.copilot = v,
        SettingsSection::CallScreen(v) => settings.call_screen = v,
        SettingsSection::MenuBar(v) => settings.menu_bar = v,
        SettingsSection::Today(v) => settings.today = v,
        SettingsSection::Performance(v) => settings.performance = v,
        SettingsSection::Maintenance(v) => settings.maintenance = v,
        SettingsSection::Evidence(v) => settings.evidence = v,
        SettingsSection::Updates(v) => settings.updates = v,
    }
}

/// The settings revision inside a write: the `rev` row, 1 before the first write.
pub(crate) fn current_rev(tx: &Transaction<'_>) -> Result<u32, CoreError> {
    let stored: Option<String> = tx
        .query_row("SELECT value FROM settings WHERE key = 'rev'", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(internal)?;
    stored.map_or(Ok(1), |v| v.parse().map_err(internal))
}

/// Writes one settings row (and the next revision, when given); the change row names the row.
pub(crate) fn put(
    tx: &Transaction<'_>,
    key: &str,
    before: &Value,
    after: &Value,
    next_rev: Option<u32>,
) -> Result<Logged, CoreError> {
    let text = after.to_string();
    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, text],
    )
    .map_err(internal)?;
    if let Some(rev) = next_rev {
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('rev', ?1)",
            [rev.to_string()],
        )
        .map_err(internal)?;
    }
    Ok(Logged {
        entity_type: "setting",
        entity_id: "settings".into(),
        field: Some(key.into()),
        before: Some(before.to_string()),
        after: Some(text),
        delta: None,
    })
}

impl Core {
    /// Hears every section a write changed, after it committed (first run applies the login
    /// item and the detection rule from it; settings never calls into other features). Hooks run
    /// under the settings lock, before `settings:changed`: they must not call back into settings.
    pub fn on_settings_changed(&self, hook: impl Fn(&SettingsSection) + Send + Sync + 'static) {
        lock(&self.settings_hooks).push(Box::new(hook));
    }

    // @cpt-flow:cpt-noter-flow-core-settings-update:p1
    // @cpt-dod:cpt-noter-dod-core-settings-sections:p1
    pub(crate) fn update_settings(
        &self,
        ctx: &CommandCtx,
        args: SettingsUpdateArgs,
    ) -> Result<Settings, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-settings-update:p1:inst-update-call
        let mut section = args.section;
        let mut settings = lock(&self.settings);
        if let SettingsSection::Audio(audio) = &mut section {
            audio.retention_next_run_deletes = settings.audio.retention_next_run_deletes;
            // the core's count
        }
        // @cpt-end:cpt-noter-flow-core-settings-update:p1:inst-update-call
        // @cpt-begin:cpt-noter-flow-core-settings-update:p1:inst-validate
        check(&section)?;
        // @cpt-end:cpt-noter-flow-core-settings-update:p1:inst-validate
        // @cpt-begin:cpt-noter-flow-core-settings-update:p1:inst-write-section
        let written =
            self.write_section(ctx, &settings, &section, Some(args.rev), "settings_update");
        // @cpt-end:cpt-noter-flow-core-settings-update:p1:inst-write-section
        let rev = match written {
            // @cpt-begin:cpt-noter-flow-core-settings-update:p1:inst-if-conflict
            Err(e) if e.code == ErrorCode::Conflict => {
                // @cpt-begin:cpt-noter-flow-core-settings-update:p1:inst-return-conflict
                return Err(e);
                // @cpt-end:cpt-noter-flow-core-settings-update:p1:inst-return-conflict
            }
            // @cpt-end:cpt-noter-flow-core-settings-update:p1:inst-if-conflict
            other => other?,
        };
        let audio = matches!(section, SettingsSection::Audio(_));
        let stamped = self.settings_written(&mut settings, section, rev);
        drop(settings);
        // The output route follows the headphones list (`audio_play` reads it from the environment).
        if audio {
            self.refresh_environment_now();
        }
        Ok(stamped)
    }

    pub(crate) fn unignore_app(
        &self,
        ctx: &CommandCtx,
        args: AppIdArgs,
    ) -> Result<Settings, CoreError> {
        let mut settings = lock(&self.settings);
        let mut general = settings.general.clone();
        general
            .ignored_apps
            .retain(|app| app.bundle_id != args.bundle_id);
        if general.ignored_apps.len() == settings.general.ignored_apps.len() {
            return Err(CoreError::new(
                ErrorCode::NotFound,
                format!("app {}", args.bundle_id),
            ));
        }
        let section = SettingsSection::General(general);
        let rev = self.write_section(ctx, &settings, &section, None, "settings_unignore_app")?;
        Ok(self.settings_written(&mut settings, section, rev))
    }

    /// One section and the next settings revision in one change-logged write; a stale `rev`
    /// is `conflict` with the current one.
    pub(crate) fn write_section(
        &self,
        ctx: &CommandCtx,
        settings: &Settings,
        section: &SettingsSection,
        base_rev: Option<Rev>,
        command: &str,
    ) -> Result<Rev, CoreError> {
        let (key, after) = parts(section)?;
        let before = section_of(settings, &key)?;
        let meta = self.change_meta(ctx, format!("Changed {key} settings"), command);
        let written = self.store().write_with(meta, move |tx| {
            let current = current_rev(tx)?;
            if base_rev.is_some_and(|base| base.0 != current) {
                return Err(
                    CoreError::new(ErrorCode::Conflict, "settings changed since rev").with_detail(
                        ErrorDetail::Conflict {
                            current_rev: Rev(current),
                        },
                    ),
                );
            }
            let logged = put(tx, &key, &before, &after, Some(current + 1))?;
            Ok((Rev(current + 1), vec![logged]))
        })?;
        Ok(written.value)
    }

    /// After a committed section write: the new state, the hooks, `settings:changed`.
    pub(crate) fn settings_written(
        &self,
        settings: &mut Settings,
        section: SettingsSection,
        rev: Rev,
    ) -> Settings {
        apply(settings, section.clone());
        settings.rev = rev;
        // @cpt-begin:cpt-noter-flow-core-settings-update:p1:inst-side-effects
        for hook in lock(&self.settings_hooks).iter() {
            hook(&section);
        }
        // @cpt-end:cpt-noter-flow-core-settings-update:p1:inst-side-effects
        // @cpt-begin:cpt-noter-flow-core-settings-update:p1:inst-emit-settings
        let stamped = self.publish(event_names::SETTINGS_CHANGED, settings);
        // The tray reads the settings and hotkeys locks a write holds: it follows once it is done.
        if let Some(core) = self.this() {
            self.spawn(async move { core.refresh_tray() });
        }
        self.follow_call_screen(&stamped.call_screen);
        // @cpt-end:cpt-noter-flow-core-settings-update:p1:inst-emit-settings
        // @cpt-begin:cpt-noter-flow-core-settings-update:p1:inst-return-settings
        stamped
        // @cpt-end:cpt-noter-flow-core-settings-update:p1:inst-return-settings
    }
}
