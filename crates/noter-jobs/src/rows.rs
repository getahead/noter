//! The `jobs` and `job_runs` tables as the scheduler reads and writes them, through noter-db only.

use noter_db::{ChangeMeta, Mutation, Store};
use noter_protocol::model::{Actor, CountEntry, JobKind, JobRunRow};
use noter_protocol::{CoreError, ErrorCode, JobId, JobRunId, TimestampMs};
use serde_json::{json, Value};

/// What starts a job (`jobs.trigger`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    Startup,
    AfterCall,
    Hourly,
    NightlyWindow,
    SourceChange,
    OnDemand,
}

impl Trigger {
    pub fn as_str(self) -> &'static str {
        match self {
            Trigger::Startup => "startup",
            Trigger::AfterCall => "after_call",
            Trigger::Hourly => "hourly",
            Trigger::NightlyWindow => "nightly_window",
            Trigger::SourceChange => "source_change",
            Trigger::OnDemand => "on_demand",
        }
    }

    fn parse(s: &str) -> Option<Trigger> {
        [
            Trigger::Startup,
            Trigger::AfterCall,
            Trigger::Hourly,
            Trigger::NightlyWindow,
            Trigger::SourceChange,
            Trigger::OnDemand,
        ]
        .into_iter()
        .find(|t| t.as_str() == s)
    }
}

/// One row of `jobs`: a job's settings.
#[derive(Debug, Clone)]
pub(crate) struct Def {
    pub id: JobId,
    pub kind: JobKind,
    pub trigger: Trigger,
    /// Hours "HH-HH" (UTC) of the nightly window.
    pub schedule: Option<String>,
    pub enabled: bool,
    pub allow_on_battery: bool,
    pub last_run_at: Option<i64>,
}

/// A run and what it works on.
#[derive(Debug, Clone)]
pub(crate) struct Stored {
    pub row: JobRunRow,
    pub subject: Option<String>,
}

pub(crate) fn kind_str(kind: JobKind) -> String {
    serde_json::to_value(kind)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default()
}

fn parse<T: serde::de::DeserializeOwned>(s: String) -> Option<T> {
    serde_json::from_value(Value::String(s)).ok()
}

/// The name a run shows (`JobRunRow.name`).
pub(crate) fn name_of(kind: JobKind) -> String {
    match kind {
        JobKind::PostCall => "Post-call analysis".into(),
        JobKind::ArchivePass => "Archive pass".into(),
        JobKind::Regeneration => "Regeneration".into(),
        JobKind::ModelDownload => "Model download".into(),
        JobKind::CliInstall => "CLI install".into(),
        other => {
            let s = kind_str(other).replace('_', " ");
            let mut c = s.chars();
            c.next()
                .map(|f| f.to_uppercase().chain(c).collect())
                .unwrap_or(s)
        }
    }
}

/// Smaller runs first (`cpt-noter-algo-core-jobs-scheduler-admit`, priority).
pub(crate) fn priority(kind: JobKind) -> u8 {
    match kind {
        JobKind::PostCall => 0,
        JobKind::ModelDownload | JobKind::CliInstall => 1,
        // The archive pass replaces the live transcript that a regeneration then reads.
        JobKind::ArchivePass => 2,
        JobKind::Regeneration => 3,
        _ => 4,
    }
}

/// The settings a job starts with: its trigger and whether it may run on battery.
pub(crate) fn default_def(kind: JobKind) -> (Trigger, bool) {
    match kind {
        JobKind::PostCall => (Trigger::AfterCall, true),
        JobKind::ArchivePass => (Trigger::AfterCall, false),
        JobKind::ModelDownload | JobKind::CliInstall => (Trigger::OnDemand, true),
        _ => (Trigger::OnDemand, false),
    }
}

pub(crate) fn job_id(kind: JobKind) -> JobId {
    JobId::new(format!("job_{}", kind_str(kind)))
}

pub(crate) fn defs(store: &Store) -> Result<Vec<Def>, CoreError> {
    let raw = store.read(|c| {
        let mut st = c.prepare(
            "SELECT id, kind, trigger, schedule, enabled, allow_on_battery, last_run_at FROM jobs",
        )?;
        let rows = st.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, bool>(4)?,
                r.get::<_, bool>(5)?,
                r.get::<_, Option<i64>>(6)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })?;
    Ok(raw
        .into_iter()
        .filter_map(
            |(id, kind, trigger, schedule, enabled, allow_on_battery, last_run_at)| {
                Some(Def {
                    id: JobId::new(id),
                    kind: parse(kind)?,
                    trigger: Trigger::parse(&trigger)?,
                    schedule,
                    enabled,
                    allow_on_battery,
                    last_run_at,
                })
            },
        )
        .collect())
}

pub(crate) fn runs(store: &Store) -> Result<Vec<Stored>, CoreError> {
    let raw = store.read(|c| {
        let mut st = c.prepare(
            "SELECT r.id, r.job_id, j.kind, r.subject, r.started_at, r.finished_at, r.status,
                    r.counts, r.error_code, r.progress
             FROM job_runs r JOIN jobs j ON j.id = r.job_id ORDER BY r.started_at, r.id",
        )?;
        let rows = st.query_map([], |r| {
            Ok((
                (
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ),
                (
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                ),
                (r.get::<_, String>(6)?, r.get::<_, String>(7)?),
                (r.get::<_, Option<String>>(8)?, r.get::<_, Option<f64>>(9)?),
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()
    })?;
    Ok(raw
        .into_iter()
        .filter_map(
            |(
                (id, job, kind),
                (subject, started, finished),
                (status, counts),
                (error, progress),
            )| {
                let kind: JobKind = parse(kind)?;
                Some(Stored {
                    subject,
                    row: JobRunRow {
                        id: JobRunId::new(id),
                        job_id: JobId::new(job),
                        kind,
                        name: name_of(kind),
                        started_at: TimestampMs(started),
                        finished_at: finished.map(TimestampMs),
                        status: parse(status)?,
                        counts: serde_json::from_str::<Vec<CountEntry>>(&counts).ok()?,
                        error: error.and_then(parse::<ErrorCode>),
                        progress: progress.map(|p| p as f32),
                    },
                })
            },
        )
        .collect())
}

/// The change row's metadata: the run's job is the actor.
pub(crate) fn meta(row: &JobRunRow, summary: &str) -> ChangeMeta {
    ChangeMeta {
        actor: Actor::Job {
            job_id: row.job_id.clone(),
            name: row.name.clone(),
        },
        summary: format!("{}: {summary}", row.name),
        reason: "job".into(),
        evidence_ids: vec![],
        batch_id: None,
        undoable: false,
        surface: None,
    }
}

/// The run as a mutation of `job_runs`: every column, so the first write inserts it.
pub(crate) fn run_mutation(row: &JobRunRow, subject: &Option<String>) -> Mutation {
    let enum_str = |v: Value| {
        v.as_str()
            .map(String::from)
            .map_or(Value::Null, Value::String)
    };
    Mutation {
        entity_type: "job_run",
        table: "job_runs",
        id: row.id.0.clone(),
        base_rev: None,
        bump_rev: false,
        values: vec![
            ("job_id", json!(row.job_id.0)),
            ("subject", json!(subject)),
            ("started_at", json!(row.started_at.0)),
            ("finished_at", json!(row.finished_at.map(|t| t.0))),
            (
                "status",
                enum_str(serde_json::to_value(row.status).unwrap_or_default()),
            ),
            (
                "counts",
                json!(serde_json::to_string(&row.counts).unwrap_or_else(|_| "[]".into())),
            ),
            (
                "error_code",
                row.error.map_or(Value::Null, |e| {
                    enum_str(serde_json::to_value(e).unwrap_or_default())
                }),
            ),
            ("progress", json!(row.progress.map(f64::from))),
        ],
    }
}

pub(crate) fn save(
    store: &Store,
    row: &JobRunRow,
    subject: &Option<String>,
) -> Result<(), CoreError> {
    store
        .write(
            run_mutation(row, subject),
            meta(row, &format!("{:?}", row.status).to_lowercase()),
        )
        .map(|_| ())
}
