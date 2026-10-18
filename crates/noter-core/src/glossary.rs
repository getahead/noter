//! The glossary: terms with their variants and spoken forms, each with its `rev`.

use noter_db::rusqlite::{Connection, OptionalExtension};
use noter_db::{Logged, Mutation};
use noter_protocol::error::ValidationRule;
use noter_protocol::ipc::CommandCtx;
use noter_protocol::model::*;
use noter_protocol::*;
use serde_json::{json, Map, Value};

use crate::settings::invalid;
use crate::{internal, lock, Core};

const COLUMNS: &str =
    "id, rev, term, variants_latin, variants_cyrillic, spoken_forms, lang, always_apply, added_from";

fn read_terms(c: &Connection) -> noter_db::rusqlite::Result<Vec<GlossaryTerm>> {
    let mut stmt = c.prepare(&format!("SELECT {COLUMNS} FROM glossary ORDER BY rowid"))?;
    let rows = stmt.query_map([], |r| {
        let json = |i: usize| -> noter_db::rusqlite::Result<Value> {
            let text: Option<String> = r.get(i)?;
            Ok(text
                .and_then(|t| serde_json::from_str(&t).ok())
                .unwrap_or(Value::Null))
        };
        let term = json!({
            "id": r.get::<_, String>(0)?,
            "rev": r.get::<_, u32>(1)?,
            "term": r.get::<_, String>(2)?,
            "variants_latin": json(3)?,
            "variants_cyrillic": json(4)?,
            "spoken_forms": json(5)?,
            "lang": json(6)?,
            "always_apply": r.get::<_, bool>(7)?,
            "added_from": json(8)?,
        });
        serde_json::from_value(term)
            .map_err(|e| noter_db::rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
    })?;
    rows.collect()
}

/// A stored column value as JSON (lists and the language stay the JSON text the table keeps).
fn stored(v: noter_db::rusqlite::types::ValueRef<'_>) -> Value {
    use noter_db::rusqlite::types::ValueRef;
    match v {
        ValueRef::Integer(i) => i.into(),
        ValueRef::Real(f) => f.into(),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into(),
        ValueRef::Null | ValueRef::Blob(_) => Value::Null,
    }
}

/// A list or the language, as the JSON text the table keeps.
fn text<T: serde::Serialize>(v: &T) -> Value {
    Value::String(serde_json::to_string(v).unwrap_or_default())
}

impl Core {
    pub(crate) fn glossary(&self) -> Result<GlossaryList, CoreError> {
        Ok(GlossaryList {
            terms: self.store().read(read_terms)?,
        })
    }

    /// Hears every glossary change after it committed (the capture session hands the new glossary
    /// to a live engine, M1). Hooks run after the write, outside any core lock.
    pub fn on_glossary_changed(&self, hook: impl Fn(&GlossaryList) + Send + Sync + 'static) {
        lock(&self.glossary_hooks).push(Box::new(hook));
    }

    // @cpt-flow:cpt-noter-flow-core-settings-glossary:p2
    // @cpt-dod:cpt-noter-dod-core-settings-glossary:p2
    pub(crate) fn upsert_term(
        &self,
        ctx: &CommandCtx,
        args: GlossaryUpsertArgs,
    ) -> Result<GlossaryList, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-settings-glossary:p2:inst-glossary-call
        let terms = self.glossary()?.terms;
        // @cpt-end:cpt-noter-flow-core-settings-glossary:p2:inst-glossary-call
        // @cpt-begin:cpt-noter-flow-core-settings-glossary:p2:inst-glossary-validate
        let term = args.term.trim().to_string();
        if term.is_empty() {
            return Err(invalid("term", ValidationRule::Required));
        }
        if args
            .id
            .as_ref()
            .is_some_and(|id| !terms.iter().any(|t| &t.id == id))
        {
            return Err(CoreError::new(ErrorCode::NotFound, "glossary term"));
        }
        let same = |t: &GlossaryTerm| {
            t.term.to_lowercase() == term.to_lowercase() && Some(&t.id) != args.id.as_ref()
        };
        if terms.iter().any(same) {
            return Err(invalid("term", ValidationRule::Duplicate));
        }
        // @cpt-end:cpt-noter-flow-core-settings-glossary:p2:inst-glossary-validate
        // @cpt-begin:cpt-noter-flow-core-settings-glossary:p2:inst-glossary-write
        let id = args
            .id
            .clone()
            .unwrap_or_else(|| GlossaryTermId::new(format!("gls_{}", ulid::Ulid::generate())));
        let mutation = Mutation {
            entity_type: "glossary",
            table: "glossary",
            id: id.0,
            base_rev: args.id.as_ref().and(args.rev),
            bump_rev: true,
            values: vec![
                ("term", Value::String(term.clone())),
                ("variants_latin", text(&args.variants_latin)),
                ("variants_cyrillic", text(&args.variants_cyrillic)),
                ("spoken_forms", text(&args.spoken_forms)),
                ("lang", args.lang.as_ref().map_or(Value::Null, text)),
                ("always_apply", Value::Bool(args.always_apply)),
            ],
        };
        let meta = self.change_meta(ctx, format!("Glossary term {term}"), "glossary_upsert");
        // Another window may add the same term between the check above and this write.
        self.store()
            .write(mutation, meta)
            .map_err(|e| match e.detail {
                Some(ErrorDetail::Validation {
                    rule: ValidationRule::Duplicate,
                    ..
                }) => invalid("term", ValidationRule::Duplicate),
                _ => e,
            })?;
        // @cpt-end:cpt-noter-flow-core-settings-glossary:p2:inst-glossary-write
        self.glossary_written()
    }

    pub(crate) fn remove_term(
        &self,
        ctx: &CommandCtx,
        args: GlossaryIdArgs,
    ) -> Result<GlossaryList, CoreError> {
        let meta = self.change_meta(ctx, "Removed a glossary term".into(), "glossary_remove");
        self.store().write_with(meta, move |tx| {
            let found = tx
                .query_row(
                    &format!("SELECT {COLUMNS} FROM glossary WHERE id = ?1"),
                    [args.id.as_str()],
                    |r| {
                        COLUMNS
                            .split(", ")
                            .enumerate()
                            .map(|(i, name)| Ok((name.to_string(), stored(r.get_ref(i)?))))
                            .collect()
                    },
                )
                .optional()
                .map_err(internal)?;
            let Some(row): Option<Map<String, Value>> = found else {
                return Err(CoreError::new(ErrorCode::NotFound, "glossary term"));
            };
            tx.execute("DELETE FROM glossary WHERE id = ?1", [args.id.as_str()])
                .map_err(internal)?;
            // Every value the row had, so the delete can be undone.
            let delta: Map<String, Value> = row
                .into_iter()
                .map(|(k, v)| (k, json!([v, null])))
                .collect();
            let logged = Logged {
                entity_type: "glossary",
                entity_id: args.id.0,
                field: None,
                before: None,
                after: None,
                delta: Some(Value::Object(delta)),
            };
            Ok(((), vec![logged]))
        })?;
        self.glossary_written()
    }

    fn glossary_written(&self) -> Result<GlossaryList, CoreError> {
        let list = self.glossary()?;
        // @cpt-begin:cpt-noter-flow-core-settings-glossary:p2:inst-glossary-live
        for hook in lock(&self.glossary_hooks).iter() {
            hook(&list);
        }
        // @cpt-end:cpt-noter-flow-core-settings-glossary:p2:inst-glossary-live
        // @cpt-begin:cpt-noter-flow-core-settings-glossary:p2:inst-glossary-return
        Ok(list)
        // @cpt-end:cpt-noter-flow-core-settings-glossary:p2:inst-glossary-return
    }
}
