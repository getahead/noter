//! FEATURE cpt-noter-feature-core-llm-gate, route failover: the production core observes the
//! router's per-call local switch and publishes it as effective privacy and degraded state.

use std::sync::Arc;

#[path = "common/events.rs"]
mod common_events;
use common_events::Events;

use noter_core::{Adapters, Core, CoreDeps, MemorySecrets, Scripted, Secret, SecretStore};
use noter_llm::{Packet, PacketContext, Privacy, RunRequest, Skill, SourceClass, TaskKind};
use noter_protocol::ipc::{event_names, CoreApi};
use noter_protocol::model::settings::AuditWhat;
use noter_protocol::model::*;
use noter_protocol::*;
use tokio::sync::watch;

#[tokio::test]
async fn two_runtime_failures_publish_local_mode_to_the_core() {
    let dir = tempfile::tempdir().unwrap();
    let events = Arc::new(Events::default());
    let secrets = Arc::new(MemorySecrets::default());
    secrets
        .set("anthropic", &Secret::new("test-api-key".into()))
        .unwrap();
    let fail = r#"{"on":"post-call","fail":"rate_limited"}"#;
    let script = Scripted::parse(&format!("{fail}\n{fail}")).unwrap();
    let deps = CoreDeps {
        llm: Adapters::scripted(&script),
        secrets,
        ..CoreDeps::new(Arc::new(TestClock), events.clone())
    };
    let core = Arc::new(Core::open(dir.path(), deps).unwrap());
    core.start_first_run();

    let (privacy, _) = watch::channel(Privacy {
        mode: PrivacyMode::CloudAllowed,
        sensitive: false,
        offline: false,
    });
    for _ in 0..2 {
        let mut request = request(&privacy);
        request.settings.configured = Some(RuntimeChoice::ClaudeApiKey);
        request.call_id = Some(CallId::new("call_route"));
        assert!(core.llm().run_once(request).await.is_err());
    }
    let mut local_request = request(&privacy);
    local_request.settings.configured = Some(RuntimeChoice::ClaudeApiKey);
    local_request.call_id = Some(CallId::new("call_route"));
    let result = core.llm().run_once(local_request).await.unwrap();
    assert_eq!(result.provenance.runtime, RuntimeChoice::Local);

    let snapshot = core
        .app_snapshot(
            &noter_protocol::ipc::CommandCtx {
                caller: noter_protocol::ipc::Caller::Window {
                    label: WindowLabel::Main,
                },
            },
            NoArgs {},
        )
        .await
        .unwrap();
    assert_eq!(snapshot.privacy.effective, EffectiveMode::SwitchedToLocal);
    assert!(snapshot.degraded.states.iter().any(|state| matches!(
        state,
        DegradedState::SwitchedToLocal {
            call_id: Some(call_id), ..
        } if *call_id == CallId::new("call_route")
    )));
    assert!(events
        .named(event_names::PRIVACY_CHANGED)
        .iter()
        .any(|payload| payload["effective"] == "switched_to_local"));
}

fn request(privacy: &watch::Sender<Privacy>) -> RunRequest {
    RunRequest::new(
        Skill::PostCall,
        "1.0.0",
        Packet {
            what: AuditWhat::FullTranscript,
            items: vec![noter_llm::PacketItem {
                id: "segment".into(),
                source: SourceClass::Normal,
                text: "text".into(),
            }],
            people: vec![],
            context: PacketContext::default(),
        },
        TaskKind::PostCall,
        privacy.subscribe(),
    )
}

struct TestClock;

impl noter_core::Clock for TestClock {
    fn now(&self) -> TimestampMs {
        TimestampMs(1_790_000_000_000)
    }
}
