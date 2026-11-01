//! noter-handoff on its own: rendering, versions, repository mappings, the generation registry
//! and the launch order (core-handoff.md §3, §4, DoD tests).

use std::cell::RefCell;

use noter_db::{ChangeMeta, Migration, Store};
use noter_handoff::{
    append, checked, launch, remove_repo, render, repos, resolve, upsert_repo, versions, Begin,
    Generations, NewVersion,
};
use noter_protocol::error::ValidationRule;
use noter_protocol::model::*;
use noter_protocol::skills::HandoffPromptOutput;
use noter_protocol::*;

/// The two tables noter-handoff writes beside: `items` (noter-core's) reduced to its key, and
/// `settings`.
const HOST: &[Migration] = &[Migration {
    owner: "test-host",
    version: 1,
    name: "items and settings",
    sql: "CREATE TABLE items (id TEXT PRIMARY KEY);
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          INSERT INTO items (id) VALUES ('itm_a'), ('itm_b');",
}];

fn store(dir: &tempfile::TempDir) -> Store {
    Store::open(
        &dir.path().join("noter.db"),
        &[noter_db::MIGRATIONS, HOST, noter_handoff::MIGRATIONS],
    )
    .unwrap()
}

fn meta() -> ChangeMeta {
    ChangeMeta {
        actor: Actor::You,
        summary: "test".into(),
        reason: "test".into(),
        evidence_ids: vec![],
        batch_id: None,
        undoable: true,
        surface: None,
    }
}

fn output() -> HandoffPromptOutput {
    HandoffPromptOutput {
        goal: "Fix the drawer focus".into(),
        context: "Anna asked at 12:04.".into(),
        constraints: vec!["Keep the API".into()],
        acceptance: vec!["Focus returns to the list".into()],
        links: vec!["VSTOR-12".into(), "https://evil.example/x".into()],
        repo: Some("VSTOR".into()),
        guardrails: "Touch only the drawer.".into(),
    }
}

#[test]
fn render_writes_every_section_and_ends_with_the_scope_question() {
    let md = render(&output());
    for part in [
        "# Fix the drawer focus",
        "## Context\n\nAnna asked at 12:04.",
        "## Constraints\n\n- Keep the API",
        "## Acceptance criteria\n\n- Focus returns to the list",
        "## Links\n\n- VSTOR-12",
        "## Repository\n\nVSTOR",
        "## Guardrails\n\nTouch only the drawer.",
    ] {
        assert!(md.contains(part), "missing {part:?} in:\n{md}");
    }
    assert!(md
        .trim_end()
        .ends_with("Ask before touching anything outside this scope."));

    let bare = HandoffPromptOutput {
        constraints: vec![],
        acceptance: vec![],
        links: vec![],
        repo: None,
        ..output()
    };
    let md = render(&bare);
    assert!(!md.contains("## Constraints") && !md.contains("## Links"));
    assert!(!md.contains("## Repository"));
}

#[test]
fn checked_keeps_only_permitted_links() {
    let out = checked(output(), &["VSTOR-12".to_string()]);
    assert_eq!(out.links, vec!["VSTOR-12".to_string()]);
}

#[test]
fn versions_number_up_and_keep_the_edit_beside_the_generated_body() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(&dir);
    assert!(versions(&store, "itm_a").unwrap().is_empty());
    let out = serde_json::to_value(output()).unwrap();
    let v1 = append(
        &store,
        meta(),
        NewVersion {
            item_id: "itm_a",
            kind: VersionKind::Generated,
            output: Some(&out),
            body_md: "generated",
            now: TimestampMs(1_000),
            base_n: None,
        },
    )
    .unwrap();
    let v2 = append(
        &store,
        meta(),
        NewVersion {
            item_id: "itm_a",
            kind: VersionKind::UserEdit,
            output: None,
            body_md: "edited",
            now: TimestampMs(2_000),
            base_n: Some(1),
        },
    )
    .unwrap();
    assert_eq!((v1.meta.n, v2.meta.n), (1, 2));
    // An edit on a stale rev is refused inside the write.
    let stale = append(
        &store,
        meta(),
        NewVersion {
            item_id: "itm_a",
            kind: VersionKind::UserEdit,
            output: None,
            body_md: "late",
            now: TimestampMs(2_500),
            base_n: Some(1),
        },
    )
    .unwrap_err();
    assert_eq!(
        stale.detail,
        Some(ErrorDetail::Conflict {
            current_rev: Rev(2)
        })
    );
    assert_eq!(v1.meta.created_at, TimestampMs(1_000));
    assert!(v1.meta.id.as_str().starts_with("ver_"));
    assert_eq!(v1.file_path, "handoffs/itm_a.md");
    let all = versions(&store, "itm_a").unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].meta.kind, VersionKind::Generated);
    assert_eq!(all[0].output.as_ref(), Some(&out));
    assert_eq!(all[1].meta.kind, VersionKind::UserEdit);
    assert_eq!(all[1].body_md, "edited");
    // Another item numbers on its own.
    let b = append(
        &store,
        meta(),
        NewVersion {
            item_id: "itm_b",
            kind: VersionKind::Generated,
            output: Some(&out),
            body_md: "b",
            now: TimestampMs(3_000),
            base_n: None,
        },
    )
    .unwrap();
    assert_eq!(b.meta.n, 1);
    // Each version is a logged change of the item's handoff, never undoable.
    let rows: Vec<(String, String, bool)> = store
        .read(|c| {
            c.prepare("SELECT entity_type, entity_id, undoable FROM changes ORDER BY rowid")?
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
                .collect()
        })
        .unwrap();
    assert_eq!(rows.len(), 3);
    assert!(rows
        .iter()
        .all(|(t, _, undoable)| t == "handoff" && !undoable));
    assert_eq!(rows[0].1, "itm_a");
}

#[test]
fn a_version_of_a_deleted_item_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(&dir);
    let err = append(
        &store,
        meta(),
        NewVersion {
            item_id: "itm_gone",
            kind: VersionKind::Generated,
            output: None,
            body_md: "x",
            now: TimestampMs(1),
            base_n: None,
        },
    )
    .unwrap_err();
    assert_eq!(err.code, ErrorCode::NotFound);
    assert!(versions(&store, "itm_gone").unwrap().is_empty());
}

#[test]
fn repository_mappings_are_validated_saved_and_removed() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(&dir);
    let repo = tempfile::tempdir().unwrap();
    let path = repo.path().to_string_lossy().into_owned();
    assert!(repos(&store).unwrap().is_empty());

    let list = upsert_repo(&store, meta(), None, "VSTOR", &path, HandoffTarget::Codex).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].key, "VSTOR");
    assert_eq!(list[0].default_tool, HandoffTarget::Codex);
    assert!(list[0].path_exists);
    assert!(list[0].id.as_str().starts_with("rep_"));
    let id = list[0].id.clone();

    // A second mapping for the same key is a duplicate; a bad key or a missing folder fails.
    let dup = upsert_repo(&store, meta(), None, "VSTOR", &path, HandoffTarget::Codex).unwrap_err();
    assert_eq!(
        dup.detail,
        Some(ErrorDetail::Validation {
            field: "key".into(),
            rule: ValidationRule::Duplicate
        })
    );
    let bad = upsert_repo(
        &store,
        meta(),
        None,
        "vstor ui",
        &path,
        HandoffTarget::Codex,
    )
    .unwrap_err();
    assert_eq!(bad.code, ErrorCode::InvalidInput);
    let slashes =
        upsert_repo(&store, meta(), None, "A/b/c", &path, HandoffTarget::Codex).unwrap_err();
    assert_eq!(slashes.code, ErrorCode::InvalidInput);
    // Keys match whatever case the user typed: `vstor` is the VSTOR mapping again.
    let same = upsert_repo(&store, meta(), None, "vstor", &path, HandoffTarget::Codex).unwrap_err();
    assert_eq!(same.code, ErrorCode::InvalidInput);
    let empty = upsert_repo(&store, meta(), None, " ", &path, HandoffTarget::Codex).unwrap_err();
    assert_eq!(
        empty.detail,
        Some(ErrorDetail::Validation {
            field: "key".into(),
            rule: ValidationRule::Required
        })
    );
    let missing = upsert_repo(
        &store,
        meta(),
        None,
        "UI",
        "/no/such/folder",
        HandoffTarget::Codex,
    )
    .unwrap_err();
    assert_eq!(missing.code, ErrorCode::RepoPathMissing);
    let relative = upsert_repo(
        &store,
        meta(),
        None,
        "UI",
        "relative/dir",
        HandoffTarget::Codex,
    )
    .unwrap_err();
    assert_eq!(relative.code, ErrorCode::InvalidInput);

    // Edit by id; a component key is fine.
    let list = upsert_repo(
        &store,
        meta(),
        Some(id.clone()),
        "VSTOR/ui",
        &path,
        HandoffTarget::ClaudeCode,
    )
    .unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, id);
    assert_eq!(list[0].key, "VSTOR/ui");
    let unknown = upsert_repo(
        &store,
        meta(),
        Some(RepoMappingId::new("rep_nope")),
        "X",
        &path,
        HandoffTarget::Codex,
    )
    .unwrap_err();
    assert_eq!(unknown.code, ErrorCode::NotFound);

    // The folder goes away: the mapping says so.
    drop(repo);
    assert!(!repos(&store).unwrap()[0].path_exists);

    assert!(remove_repo(&store, meta(), &id).unwrap().is_empty());
    assert_eq!(
        remove_repo(&store, meta(), &id).unwrap_err().code,
        ErrorCode::NotFound
    );
    // Every write is a logged settings change.
    let logged: i64 = store
        .read(|c| {
            c.query_row(
                "SELECT COUNT(*) FROM changes WHERE entity_type = 'setting' AND field = 'repos'",
                [],
                |r| r.get(0),
            )
        })
        .unwrap();
    assert_eq!(logged, 3);
}

fn mapping(key: &str) -> RepoMapping {
    RepoMapping {
        id: RepoMappingId::new(format!("rep_{key}")),
        key: key.into(),
        local_path: "/tmp".into(),
        default_tool: HandoffTarget::ClaudeCode,
        path_exists: true,
    }
}

#[test]
fn resolve_matches_the_project_key_then_one_of_its_components() {
    let maps = vec![mapping("UI/web"), mapping("VSTOR"), mapping("VSTOR/ui")];
    let (repo, unmapped) = resolve(&maps, Some("VSTOR-12"));
    assert_eq!(repo.unwrap().key, "VSTOR");
    assert_eq!(unmapped, None);
    let (repo, _) = resolve(&maps, Some("UI-7"));
    assert_eq!(repo.unwrap().key, "UI/web");
    let (repo, _) = resolve(&[mapping("noter")], Some("NOTER-3"));
    assert_eq!(repo.unwrap().key, "noter");
    let (repo, unmapped) = resolve(&maps, Some("CORE-1"));
    assert_eq!((repo, unmapped.as_deref()), (None, Some("CORE")));
    assert_eq!(resolve(&maps, None), (None, None));
}

#[test]
fn generations_coalesce_cancel_and_discard_late_results() {
    let g = Generations::default();
    assert_eq!(g.state("itm_a", false), PromptState::NotGenerated);
    let Begin::Started { id: first, cancel } = g.begin("itm_a") else {
        panic!("expected a new generation")
    };
    assert_eq!(g.state("itm_a", false), PromptState::Generating);
    assert!(matches!(g.begin("itm_a"), Begin::Running));

    // Cancel: the router request is cancelled and the state goes back.
    assert!(g.cancel("itm_a"));
    assert!(cancel.is_cancelled());
    assert_eq!(g.state("itm_a", false), PromptState::NotGenerated);
    assert!(!g.cancel("itm_a"));
    // The cancelled run's result is discarded: nothing is committed.
    let committed = RefCell::new(false);
    assert!(g
        .finish("itm_a", first, || {
            *committed.borrow_mut() = true;
            Ok(())
        })
        .is_none());
    assert!(!*committed.borrow());

    // A failure is kept; Try Again starts over; cancelling it restores the failure.
    let Begin::Started { id: second, .. } = g.begin("itm_a") else {
        panic!()
    };
    assert!(g.fail("itm_a", second, ErrorCode::RuntimeUnavailable));
    let failed = PromptState::Failed {
        code: ErrorCode::RuntimeUnavailable,
    };
    assert_eq!(g.state("itm_a", true), failed);
    let Begin::Started { id: third, .. } = g.begin("itm_a") else {
        panic!()
    };
    assert!(!g.fail("itm_a", second, ErrorCode::Internal), "stale id");
    g.cancel("itm_a");
    assert_eq!(g.state("itm_a", true), failed);
    assert!(g.finish("itm_a", third, || Ok(())).is_none());

    // The current run commits and clears the failure.
    let Begin::Started { id: fourth, .. } = g.begin("itm_a") else {
        panic!()
    };
    assert_eq!(g.finish("itm_a", fourth, || Ok(7)), Some(Ok(7)));
    assert_eq!(g.state("itm_a", true), PromptState::Ready);
    // A commit that fails is a failed attempt.
    let Begin::Started { id: fifth, .. } = g.begin("itm_a") else {
        panic!()
    };
    let gone = CoreError::new(ErrorCode::NotFound, "gone");
    assert_eq!(
        g.finish::<()>("itm_a", fifth, || Err(gone.clone())),
        Some(Err(gone))
    );
    assert_eq!(
        g.state("itm_a", true),
        PromptState::Failed {
            code: ErrorCode::NotFound
        }
    );

    // The wanted target is per item.
    assert_eq!(g.target("itm_b"), None);
    g.set_target("itm_b", HandoffTarget::Codex);
    assert_eq!(g.target("itm_b"), Some(HandoffTarget::Codex));
}

fn plan(path: LaunchPath, denied: bool) -> LaunchPlan {
    LaunchPlan {
        path,
        needs_automation: false,
        automation_denied: denied,
    }
}

/// Runs [`launch`] with scripted answers per path and records the order tried.
async fn run(
    plan: LaunchPlan,
    answer: impl Fn(LaunchPath) -> Result<(), ErrorCode>,
) -> (Result<LaunchPath, ErrorCode>, Vec<LaunchPath>) {
    let tried = RefCell::new(Vec::new());
    let result = launch(&plan, |p| {
        tried.borrow_mut().push(p);
        let r = answer(p);
        async move { r }
    })
    .await;
    (result, tried.into_inner())
}

#[tokio::test]
async fn launch_tries_the_link_then_the_terminal_fallback() {
    use LaunchPath::*;
    // The handler opens: nothing else is tried.
    let (r, tried) = run(plan(ClaudeCliLink, false), |_| Ok(())).await;
    assert_eq!((r, tried), (Ok(ClaudeCliLink), vec![ClaudeCliLink]));
    // The link fails: iTerm, then Terminal.
    let (r, tried) = run(plan(ClaudeCliLink, false), |p| match p {
        Terminal => Ok(()),
        _ => Err(ErrorCode::NoLinkHandler),
    })
    .await;
    assert_eq!(
        (r, tried),
        (Ok(Terminal), vec![ClaudeCliLink, Iterm, Terminal])
    );
    // Nothing opens; a denied terminal is the error the user can fix.
    let (r, _) = run(plan(ClaudeCliLink, false), |p| match p {
        Iterm => Err(ErrorCode::AutomationDenied),
        _ => Err(ErrorCode::NoLinkHandler),
    })
    .await;
    assert_eq!(r, Err(ErrorCode::AutomationDenied));
    // Claude Desktop ignores `cwd` and the Codex app `q` (D-33): only a terminal opens the
    // repository folder with the prompt pre-filled.
    for app in [ClaudeDesktop, CodexApp] {
        let (r, tried) = run(plan(app, false), |_| Ok(())).await;
        assert_eq!((r, tried), (Ok(Iterm), vec![Iterm]));
    }
    // The plan already says: no path, or the terminal's Automation is denied.
    let (r, tried) = run(plan(None, false), |_| Ok(())).await;
    assert_eq!((r, tried), (Err(ErrorCode::NoLinkHandler), vec![]));
    let (r, tried) = run(plan(Terminal, true), |_| Ok(())).await;
    assert_eq!((r, tried), (Err(ErrorCode::AutomationDenied), vec![]));
    // A terminal plan tries only that terminal.
    let (r, tried) = run(plan(Iterm, false), |_| Err(ErrorCode::Internal)).await;
    assert_eq!((r, tried), (Err(ErrorCode::Internal), vec![Iterm]));
}

#[test]
fn a_corrupt_mappings_row_is_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(&dir);
    let repo = tempfile::tempdir().unwrap();
    let path = repo.path().to_string_lossy().into_owned();
    upsert_repo(&store, meta(), None, "VSTOR", &path, HandoffTarget::Codex).unwrap();
    noter_db::rusqlite::Connection::open(dir.path().join("noter.db"))
        .unwrap()
        .execute(
            "UPDATE settings SET value = 'not json' WHERE key = 'repos'",
            [],
        )
        .unwrap();
    let err = upsert_repo(&store, meta(), None, "UI", &path, HandoffTarget::Codex).unwrap_err();
    assert_eq!(err.code, ErrorCode::Internal);
    assert!(repos(&store).is_err());
    let kept: String = store
        .read(|c| {
            c.query_row("SELECT value FROM settings WHERE key = 'repos'", [], |r| {
                r.get(0)
            })
        })
        .unwrap();
    assert_eq!(kept, "not json");
}
