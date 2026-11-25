//! `ask_scope_presets`: readable Ask scopes from the current library (PRD › Ask mode): all
//! sources, calls only, the last 30 days, a call type, a person, a topic and the latest call.

use noter_db::rusqlite::{params, Connection};
use noter_protocol::model::*;
use noter_protocol::*;

/// People and topics offered, the most frequent or recent first.
const EACH: i64 = 5;

fn preset(id: String, label: String, scope: AskScope) -> ScopePreset {
    ScopePreset {
        scope: AskScope {
            preset: Some(id.clone()),
            ..scope
        },
        id,
        label,
    }
}

/// The presets for the local last-30-days cutoff, with call-type labels from `call_types`.
pub fn scope_presets(
    conn: &Connection,
    since: TimestampMs,
    since_date: LocalDate,
    call_types: &[CallTypeInfo],
) -> noter_db::rusqlite::Result<ScopePresetList> {
    let month = Some(since_date);
    let mut presets = vec![
        preset(
            "all".into(),
            "All calls and all sources".into(),
            AskScope {
                include_documents: true,
                ..AskScope::default()
            },
        ),
        preset(
            "calls_only".into(),
            "All calls, no documents".into(),
            AskScope::default(),
        ),
        preset(
            "last_30_days".into(),
            "Calls in the last 30 days".into(),
            AskScope {
                from: month.clone(),
                ..AskScope::default()
            },
        ),
    ];
    let mut stmt = conn.prepare(
        "SELECT call_type FROM calls WHERE started_at >= ?1
         GROUP BY call_type ORDER BY count(*) DESC, call_type",
    )?;
    let used: Vec<String> = stmt
        .query_map(params![since.0], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for id in &used {
        let Some(t) = call_types.iter().find(|t| &t.id.0 == id) else {
            continue;
        };
        presets.push(preset(
            format!("type:{id}"),
            format!("{} calls in the last 30 days", t.label),
            AskScope {
                call_types: vec![t.id.clone()],
                from: month.clone(),
                ..AskScope::default()
            },
        ));
    }
    // shortcut: a person's name as the speaker rows carry it, until people (2.23) has its table.
    let mut stmt = conn.prepare(
        "SELECT person_id, max(COALESCE(name, label)) FROM speakers WHERE person_id IS NOT NULL
         GROUP BY person_id ORDER BY count(DISTINCT call_id) DESC, person_id LIMIT ?1",
    )?;
    let people: Vec<(String, String)> = stmt
        .query_map(params![EACH], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (id, name) in people {
        presets.push(preset(
            format!("person:{id}"),
            format!("Calls with {name}"),
            AskScope {
                people: vec![PersonId::new(id)],
                ..AskScope::default()
            },
        ));
    }
    let mut stmt =
        conn.prepare("SELECT id, name FROM topics ORDER BY last_seen DESC, id LIMIT ?1")?;
    let topics: Vec<(String, String)> = stmt
        .query_map(params![EACH], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    for (id, name) in topics {
        presets.push(preset(
            format!("topic:{id}"),
            format!("Topic: {name}"),
            AskScope {
                topic_id: Some(TopicId::new(id)),
                ..AskScope::default()
            },
        ));
    }
    let latest: Option<(String, String)> = conn
        .prepare(
            "SELECT id, title FROM calls WHERE status = 'ready'
             ORDER BY started_at DESC, id LIMIT 1",
        )?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .next()
        .transpose()?;
    if let Some((id, title)) = latest {
        presets.push(preset(
            format!("call:{id}"),
            format!("Latest call: {title}"),
            AskScope {
                call_id: Some(CallId::new(id)),
                ..AskScope::default()
            },
        ));
    }
    Ok(ScopePresetList { presets })
}
