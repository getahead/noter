//! Unit tests for the few helper functions the contract crate carries
//! (error constructors, identifier newtypes, the Channel sink).

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use noter_protocol::ipc::Sink;
use noter_protocol::{CallId, CoreError, ErrorCode, ErrorDetail};

#[test]
fn core_error_takes_retryable_from_the_code() {
    let e = CoreError::new(ErrorCode::Offline, "no network");
    assert!(e.retryable);
    assert_eq!(e.detail, None);
    assert_eq!(e.message, "no network");

    let e = CoreError::new(ErrorCode::NotFound, "gone");
    assert!(!e.retryable);
}

#[test]
fn core_error_carries_detail_and_displays_code_and_message() {
    let e = CoreError::new(ErrorCode::DiskFull, "disk")
        .with_detail(ErrorDetail::DiskSpace { free_mb: 12 });
    assert_eq!(e.detail, Some(ErrorDetail::DiskSpace { free_mb: 12 }));
    assert_eq!(e.to_string(), "DiskFull: disk");
    let as_std: &dyn std::error::Error = &e;
    assert!(as_std.source().is_none());
}

#[test]
fn only_transient_codes_are_retryable_by_default() {
    let mut retryable: Vec<String> = ErrorCode::ALL
        .iter()
        .filter(|c| c.default_retryable())
        .map(|c| format!("{c:?}"))
        .collect();
    retryable.sort();
    assert_eq!(
        retryable,
        [
            "ChangeLogUnreadable",
            "EngineUnavailable",
            "Internal",
            "KeychainLocked",
            "NotReady",
            "Offline",
            "SearchFailed",
            "SourceSyncFailed",
        ]
    );
}

#[test]
fn identifiers_are_opaque_strings_with_a_prefix() {
    let id = CallId::new("call_01JABC");
    assert_eq!(id.as_str(), "call_01JABC");
    assert_eq!(id.to_string(), "call_01JABC");
    assert_eq!(CallId::PREFIX, "call");
    assert_eq!(serde_json::to_string(&id).unwrap(), "\"call_01JABC\"");
}

#[test]
fn sink_forwards_messages_and_reports_a_closed_receiver() {
    let seen = Arc::new(AtomicUsize::new(0));
    let s = seen.clone();
    let open = Sink::new(move |n: usize| {
        s.fetch_add(n, Ordering::SeqCst);
        true
    });
    assert!(open.send(2));
    assert!(open.clone().send(3));
    assert_eq!(seen.load(Ordering::SeqCst), 5);

    let closed = Sink::new(|_: usize| false);
    assert!(!closed.send(1));
    assert_eq!(format!("{closed:?}"), "Sink");
}
