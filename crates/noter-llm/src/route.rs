//! Routing by task, privacy and availability (`cpt-noter-algo-core-llm-gate-route`).

use std::time::Duration;

use noter_protocol::{CoreError, Effort, ErrorCode, ErrorDetail, PrivacyMode, RuntimeChoice};

use noter_protocol::error::RuntimeUnavailableReason;

use crate::runtime::{
    runtime_name, Availability, Budget, Failure, Privacy, TaskKind, TaskSettings,
};

/// How the gate redacts. M2 has no pinned local redaction model, so the regex path is the
/// whole of it (TL-19); it always runs on the Mac.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Redaction {
    Regex,
}

/// An allowed runtime choice and how to run it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Choice {
    pub runtime: RuntimeChoice,
    pub model: String,
    pub effort: Effort,
    pub tools: Vec<String>,
    pub timeout: Duration,
    pub redaction: Redaction,
}

pub(crate) struct Route<'a> {
    pub task: &'a TaskKind,
    pub settings: &'a TaskSettings,
    pub available: &'a [Availability],
    pub privacy: Privacy,
    /// Two consecutive runtime failures switched the call to local.
    pub switched_to_local: bool,
    pub budget: &'a Budget,
    /// What this request's API-key attempts have cost so far.
    pub spent_usd: f64,
    /// The validated fallback prefers local where it is available.
    pub prefer_local: bool,
}

/// PRD fallback order after the configured runtime: Claude Code, Codex, local.
const ORDER: [RuntimeChoice; 5] = [
    RuntimeChoice::ClaudeApiKey,
    RuntimeChoice::ClaudeAccount,
    RuntimeChoice::CodexApiKey,
    RuntimeChoice::ChatgptAccount,
    RuntimeChoice::Local,
];

pub(crate) fn is_api_key(runtime: RuntimeChoice) -> bool {
    matches!(
        runtime,
        RuntimeChoice::ClaudeApiKey | RuntimeChoice::CodexApiKey
    )
}

pub(crate) fn is_cloud(runtime: RuntimeChoice) -> bool {
    runtime != RuntimeChoice::Local
}

/// Whether privacy keeps the request on the Mac, and why.
pub(crate) fn forced_local(privacy: Privacy) -> Option<RuntimeUnavailableReason> {
    if privacy.offline {
        Some(RuntimeUnavailableReason::Offline)
    } else if privacy.sensitive || privacy.mode == PrivacyMode::LocalOnly {
        Some(RuntimeUnavailableReason::SensitiveCallNeedsLocal)
    } else {
        None
    }
}

pub(crate) fn unavailable(runtime: RuntimeChoice, reason: RuntimeUnavailableReason) -> CoreError {
    CoreError::new(
        ErrorCode::RuntimeUnavailable,
        format!("{} is unavailable: {reason:?}", runtime_name(runtime)),
    )
    .with_detail(ErrorDetail::Runtime {
        runtime,
        reason,
        fix: None,
    })
}

pub(crate) fn timeout(task: &TaskKind) -> Duration {
    match task {
        // The spec gives handoff no timeout of its own: it is a post-call-sized run.
        TaskKind::PostCall | TaskKind::Handoff { .. } => Duration::from_secs(600),
        TaskKind::Ask => Duration::from_secs(60),
        TaskKind::Live => Duration::from_secs(8),
    }
}

// @cpt-algo:cpt-noter-algo-core-llm-gate-route:p1
pub(crate) fn route(r: &Route) -> Result<Choice, Failure> {
    // @cpt-begin:cpt-noter-algo-core-llm-gate-route:p1:inst-route-local
    let switched = r
        .switched_to_local
        .then_some(RuntimeUnavailableReason::SensitiveCallNeedsLocal);
    let forced = forced_local(r.privacy).or(switched);
    // @cpt-end:cpt-noter-algo-core-llm-gate-route:p1:inst-route-local
    // @cpt-begin:cpt-noter-algo-core-llm-gate-route:p1:inst-route-order
    let preferred: Vec<RuntimeChoice> = match (forced, r.task) {
        (Some(_), _) => vec![RuntimeChoice::Local],
        (None, TaskKind::Handoff { target }) => vec![*target, RuntimeChoice::Local],
        (None, _) => r.settings.configured.into_iter().chain(ORDER).collect(),
    };
    let local_first = r.prefer_local.then_some(RuntimeChoice::Local);
    let mut candidates: Vec<RuntimeChoice> = Vec::new();
    for c in local_first.into_iter().chain(preferred) {
        if !candidates.contains(&c) {
            candidates.push(c);
        }
    }
    // @cpt-end:cpt-noter-algo-core-llm-gate-route:p1:inst-route-order
    let mut refusal: Option<CoreError> = None;
    for runtime in candidates {
        let Some(a) = r.available.iter().find(|a| a.runtime == runtime) else {
            continue;
        };
        if let Some(reason) = a.unavailable {
            // A sensitive call whose local model is down says why it cannot go to the cloud.
            let reason = forced
                .filter(|_| runtime == RuntimeChoice::Local)
                .unwrap_or(reason);
            refusal.get_or_insert_with(|| unavailable(runtime, reason));
            continue;
        }
        // @cpt-begin:cpt-noter-algo-core-llm-gate-route:p1:inst-route-version
        if let Some(found) = &a.version {
            let major = found.split('.').next().and_then(|m| m.parse::<u64>().ok());
            if !major.is_some_and(|m| a.tested_majors.contains(&m)) {
                refusal.get_or_insert_with(|| version_unsupported(runtime, found, a));
                continue;
            }
        }
        // @cpt-end:cpt-noter-algo-core-llm-gate-route:p1:inst-route-version
        // @cpt-begin:cpt-noter-algo-core-llm-gate-route:p1:inst-route-failover
        let capped = r.budget.max_cost_usd.is_some_and(|cap| r.spent_usd >= cap);
        if is_api_key(runtime) && capped {
            return Err(Failure::Budget);
        }
        let tools = r.settings.tools.clone();
        // @cpt-end:cpt-noter-algo-core-llm-gate-route:p1:inst-route-failover
        // @cpt-begin:cpt-noter-algo-core-llm-gate-route:p1:inst-route-redaction
        let redaction = Redaction::Regex;
        // @cpt-end:cpt-noter-algo-core-llm-gate-route:p1:inst-route-redaction
        // @cpt-begin:cpt-noter-algo-core-llm-gate-route:p1:inst-route-return
        let configured_model = r
            .settings
            .model
            .clone()
            .filter(|_| r.settings.configured == Some(runtime));
        let model = configured_model
            .or_else(|| a.models.first().cloned())
            .unwrap_or_default();
        return Ok(Choice {
            runtime,
            model,
            effort: r.settings.effort,
            tools,
            timeout: timeout(r.task),
            redaction,
        });
        // @cpt-end:cpt-noter-algo-core-llm-gate-route:p1:inst-route-return
    }
    // @cpt-begin:cpt-noter-algo-core-llm-gate-route:p1:inst-route-none
    let reason = forced.unwrap_or(RuntimeUnavailableReason::LocalModelNotReady);
    let refusal = refusal.unwrap_or_else(|| unavailable(RuntimeChoice::Local, reason));
    Err(Failure::Unavailable(refusal))
    // @cpt-end:cpt-noter-algo-core-llm-gate-route:p1:inst-route-none
}

fn version_unsupported(runtime: RuntimeChoice, found: &str, a: &Availability) -> CoreError {
    let supported = a
        .tested_majors
        .iter()
        .map(|m| format!("{m}.x"))
        .collect::<Vec<_>>()
        .join(", ");
    CoreError::new(
        ErrorCode::CliVersionUnsupported,
        format!(
            "{} {found} is outside the tested range",
            runtime_name(runtime)
        ),
    )
    .with_detail(ErrorDetail::CliVersion {
        tool: runtime_name(runtime).into(),
        found: found.into(),
        supported,
    })
}
