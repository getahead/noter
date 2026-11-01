//! Repository mappings: the `repos` row of `settings`, written through the change log.

use std::path::Path;

use noter_db::rusqlite::{params, OptionalExtension, Transaction};
use noter_db::{ChangeMeta, Logged, Store};
use noter_protocol::error::ValidationRule;
use noter_protocol::model::{HandoffTarget, RepoMapping};
use noter_protocol::{CoreError, ErrorCode, ErrorDetail, RepoMappingId};
use serde::{Deserialize, Serialize};

use crate::internal;

/// A mapping as stored; `path_exists` is read from the disk each time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Stored {
    id: RepoMappingId,
    key: String,
    local_path: String,
    default_tool: HandoffTarget,
}

impl Stored {
    fn view(self) -> RepoMapping {
        RepoMapping {
            path_exists: Path::new(&self.local_path).is_dir(),
            id: self.id,
            key: self.key,
            local_path: self.local_path,
            default_tool: self.default_tool,
        }
    }
}

/// The stored list; a row that does not parse fails rather than reading as empty, so the next
/// write cannot drop every mapping.
fn parse(text: Option<String>) -> Result<Vec<Stored>, CoreError> {
    text.map_or(Ok(Vec::new()), |t| {
        serde_json::from_str(&t).map_err(internal)
    })
}

fn invalid(field: &str, rule: ValidationRule) -> CoreError {
    CoreError::new(ErrorCode::InvalidInput, format!("{field}: {rule:?}")).with_detail(
        ErrorDetail::Validation {
            field: field.into(),
            rule,
        },
    )
}

/// `VSTOR` or `VSTOR/ui`: a project key, optionally a component; no spaces, one slash at most.
fn key_ok(key: &str) -> bool {
    let mut parts = key.split('/');
    parts.clone().count() <= 2
        && parts.all(|p| {
            !p.is_empty()
                && p.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        })
}

// @cpt-begin:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-list
/// The mappings in the order they were added, with `path_exists` from the filesystem.
pub fn repos(store: &Store) -> Result<Vec<RepoMapping>, CoreError> {
    let text: Option<String> = store.read(|c| {
        c.query_row("SELECT value FROM settings WHERE key = 'repos'", [], |r| {
            r.get(0)
        })
        .optional()
    })?;
    Ok(parse(text)?.into_iter().map(Stored::view).collect())
}
// @cpt-end:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-list

/// Replaces the `repos` row inside `edit`'s writer transaction, logged as a settings change.
/// Mappings are not a settings section, so the change is not undoable.
fn write(
    store: &Store,
    mut meta: ChangeMeta,
    edit: impl FnOnce(&mut Vec<Stored>) -> Result<(), CoreError> + Send + 'static,
) -> Result<Vec<RepoMapping>, CoreError> {
    meta.undoable = false;
    let written = store.write_with(meta, move |tx: &Transaction<'_>| {
        let before: Option<String> = tx
            .query_row("SELECT value FROM settings WHERE key = 'repos'", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(internal)?;
        let mut list = parse(before.clone())?;
        edit(&mut list)?;
        let after = serde_json::to_string(&list).map_err(internal)?;
        tx.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('repos', ?1)",
            params![after],
        )
        .map_err(internal)?;
        let logged = Logged {
            entity_type: "setting",
            entity_id: "settings".into(),
            field: Some("repos".into()),
            before: Some(before.unwrap_or_else(|| "[]".into())),
            after: Some(after),
            delta: None,
        };
        Ok((list, vec![logged]))
    })?;
    Ok(written.value.into_iter().map(Stored::view).collect())
}

// @cpt-begin:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-save
/// Adds a mapping (`id: None`) or changes one. The key is `PROJECT` or `PROJECT/component`
/// and unique; the folder is an absolute path to an existing directory.
pub fn upsert_repo(
    store: &Store,
    meta: ChangeMeta,
    id: Option<RepoMappingId>,
    key: &str,
    local_path: &str,
    default_tool: HandoffTarget,
) -> Result<Vec<RepoMapping>, CoreError> {
    let key = key.trim().to_string();
    match key.chars().count() {
        0 => return Err(invalid("key", ValidationRule::Required)),
        n if n > 64 => return Err(invalid("key", ValidationRule::TooLong)),
        _ if !key_ok(&key) => return Err(invalid("key", ValidationRule::InvalidFormat)),
        _ => {}
    }
    if !Path::new(local_path).is_absolute() {
        return Err(invalid("local_path", ValidationRule::InvalidFormat));
    }
    if !Path::new(local_path).is_dir() {
        return Err(CoreError::new(
            ErrorCode::RepoPathMissing,
            "the folder does not exist",
        ));
    }
    let local_path = local_path.to_string();
    write(store, meta, move |list| {
        if list
            .iter()
            .any(|m| m.key.eq_ignore_ascii_case(&key) && Some(&m.id) != id.as_ref())
        {
            return Err(invalid("key", ValidationRule::Duplicate));
        }
        let stored = Stored {
            id: id
                .clone()
                .unwrap_or_else(|| RepoMappingId::new(format!("rep_{}", ulid::Ulid::generate()))),
            key,
            local_path,
            default_tool,
        };
        match id {
            None => list.push(stored),
            Some(id) => {
                let slot = list
                    .iter_mut()
                    .find(|m| m.id == id)
                    .ok_or_else(|| CoreError::new(ErrorCode::NotFound, "no such mapping"))?;
                *slot = stored;
            }
        }
        Ok(())
    })
}
// @cpt-end:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-save

// @cpt-begin:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-remove
pub fn remove_repo(
    store: &Store,
    meta: ChangeMeta,
    id: &RepoMappingId,
) -> Result<Vec<RepoMapping>, CoreError> {
    let id = id.clone();
    write(store, meta, move |list| {
        let before = list.len();
        list.retain(|m| m.id != id);
        if list.len() == before {
            return Err(CoreError::new(ErrorCode::NotFound, "no such mapping"));
        }
        Ok(())
    })
}
// @cpt-end:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-remove

// @cpt-begin:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-resolve
/// The mapping for an item's linked issue (`VSTOR-12`): the project's own key, else the first
/// of its components; with none, the project key to prefill **Add Mapping…**. An item without
/// a linked issue has neither (Copy Prompt still works).
pub fn resolve(
    mappings: &[RepoMapping],
    linked_issue: Option<&str>,
) -> (Option<RepoMapping>, Option<String>) {
    let Some(project) = linked_issue.and_then(|k| k.split_once('-')).map(|(p, _)| p) else {
        return (None, None);
    };
    let component = format!("{}/", project.to_ascii_lowercase());
    let found = mappings
        .iter()
        .find(|m| m.key.eq_ignore_ascii_case(project))
        .or_else(|| {
            mappings
                .iter()
                .find(|m| m.key.to_ascii_lowercase().starts_with(&component))
        });
    match found {
        Some(m) => (Some(m.clone()), None),
        None => (None, Some(project.to_string())),
    }
}
// @cpt-end:cpt-noter-flow-core-handoff-repositories:p1:inst-repo-resolve
