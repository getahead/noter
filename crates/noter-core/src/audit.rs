//! FEATURE cpt-noter-feature-core-credentials-privacy (slice 1), the Privacy pane's reads:
//! `audit_list` pages the gate's append-only `audit_log`, `audit_export` writes the same rows
//! as Markdown or JSON through the save panel. Metadata only: no packet body, redaction map,
//! key or audio is ever read here.

use std::io::Write;

use noter_db::rusqlite::types::Value as Sql;
use noter_protocol::error::ValidationRule;
use noter_protocol::model::*;
use noter_protocol::*;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::settings::invalid;
use crate::{Core, SaveKind};

const DEFAULT_PAGE: u32 = 100;
const MAX_PAGE: u32 = 500;
/// Rows read per batch while an export streams to its file.
const EXPORT_BATCH: u32 = 500;

const COLUMNS: &str = "a.id, a.ts, a.kind, a.what, a.destination, a.runtime_choice, a.call_id, \
    a.llm_run_id, a.bytes_out, a.redaction_map_id, c.title, c.started_at, c.call_type";

fn parse<T: DeserializeOwned>(text: String) -> Result<T, CoreError> {
    serde_json::from_value(Value::String(text)).map_err(crate::internal)
}

fn entry(r: &noter_db::rusqlite::Row<'_>) -> noter_db::rusqlite::Result<RawEntry> {
    Ok(RawEntry {
        id: r.get(0)?,
        ts: r.get(1)?,
        kind: r.get(2)?,
        what: r.get(3)?,
        destination: r.get(4)?,
        runtime: r.get(5)?,
        call_id: r.get(6)?,
        llm_run_id: r.get(7)?,
        bytes_out: r.get(8)?,
        redacted: r.get::<_, Option<String>>(9)?.is_some(),
        call: match (r.get(10)?, r.get(11)?, r.get(12)?) {
            (Some(title), Some(at), Some(ty)) => Some((title, at, ty)),
            _ => None,
        },
    })
}

struct RawEntry {
    id: String,
    ts: i64,
    kind: String,
    what: String,
    destination: String,
    runtime: Option<String>,
    call_id: Option<String>,
    llm_run_id: Option<String>,
    bytes_out: i64,
    redacted: bool,
    call: Option<(String, i64, String)>,
}

impl RawEntry {
    // @cpt-begin:cpt-noter-flow-core-credentials-privacy-audit:p1:inst-audit-return
    fn into_entry(self) -> Result<AuditEntry, CoreError> {
        let call = match (self.call_id, self.call) {
            (Some(id), Some((title, at, ty))) => Some(CallRef {
                id: CallId::new(id),
                title,
                started_at: TimestampMs(at),
                call_type: CallTypeId(ty),
            }),
            _ => None,
        };
        Ok(AuditEntry {
            id: AuditId::new(self.id),
            kind: parse(self.kind)?,
            llm_run_id: self.llm_run_id.map(LlmRunId::new),
            at: TimestampMs(self.ts),
            call,
            runtime: self.runtime.map(parse).transpose()?,
            destination: self.destination,
            what: parse(self.what)?,
            bytes_out: u32::try_from(self.bytes_out).unwrap_or(u32::MAX),
            redacted: self.redacted,
        })
    }
    // @cpt-end:cpt-noter-flow-core-credentials-privacy-audit:p1:inst-audit-return
}

/// The date range both reads share: inclusive, `from` not after `to`.
fn range(from: Option<TimestampMs>, to: Option<TimestampMs>) -> Result<String, CoreError> {
    if from.zip(to).is_some_and(|(from, to)| from > to) {
        return Err(invalid("to", ValidationRule::OutOfRange));
    }
    Ok(String::new())
}

/// A cursor is the `(ts, id)` of the last row served.
fn cursor_of(row: &AuditEntry) -> Cursor {
    Cursor(format!("{}|{}", row.at.0, row.id.as_str()))
}

fn after(cursor: &Cursor) -> Result<(i64, String), CoreError> {
    cursor
        .0
        .split_once('|')
        .and_then(|(ts, id)| Some((ts.parse().ok()?, id.to_owned())))
        .ok_or_else(|| invalid("cursor", ValidationRule::InvalidFormat))
}

impl Core {
    /// Up to `limit` rows after `after`, in `(ts, id)` order, inside the range.
    fn audit_rows(
        &self,
        from: Option<TimestampMs>,
        to: Option<TimestampMs>,
        after: Option<(i64, String)>,
        limit: u32,
    ) -> Result<Vec<AuditEntry>, CoreError> {
        let mut clauses = vec!["1 = 1".to_owned()];
        let mut binds: Vec<Sql> = Vec::new();
        if let Some(from) = from {
            clauses.push("a.ts >= ?".into());
            binds.push(Sql::Integer(from.0));
        }
        if let Some(to) = to {
            clauses.push("a.ts <= ?".into());
            binds.push(Sql::Integer(to.0));
        }
        if let Some((ts, id)) = after {
            clauses.push("(a.ts, a.id) > (?, ?)".into());
            binds.push(Sql::Integer(ts));
            binds.push(Sql::Text(id));
        }
        binds.push(Sql::Integer(i64::from(limit)));
        let sql = format!(
            "SELECT {COLUMNS} FROM audit_log a LEFT JOIN calls c ON c.id = a.call_id \
             WHERE {} ORDER BY a.ts, a.id LIMIT ?",
            clauses.join(" AND ")
        );
        let raw = self.store().read(move |c| {
            let mut stmt = c.prepare(&sql)?;
            let rows = stmt.query_map(noter_db::rusqlite::params_from_iter(binds), entry)?;
            rows.collect::<Result<Vec<_>, _>>()
        })?;
        raw.into_iter().map(RawEntry::into_entry).collect()
    }

    // @cpt-flow:cpt-noter-flow-core-credentials-privacy-audit:p1
    pub(crate) fn audit_page(&self, args: AuditListArgs) -> Result<Page<AuditEntry>, CoreError> {
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-audit:p1:inst-audit-read
        self.ready()?;
        range(args.from, args.to)?;
        let limit = args.page.limit.unwrap_or(DEFAULT_PAGE).clamp(1, MAX_PAGE);
        let cursor = args.page.cursor.as_ref().map(after).transpose()?;
        let mut rows = self.audit_rows(args.from, args.to, cursor, limit + 1)?;
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-audit:p1:inst-audit-read
        let more = rows.len() > limit as usize;
        rows.truncate(limit as usize);
        let next_cursor = more.then(|| rows.last().map(cursor_of)).flatten();
        Ok(Page {
            rows,
            next_cursor,
            total: None,
        })
    }

    pub(crate) async fn export_audit(
        &self,
        args: AuditExportArgs,
    ) -> Result<ExportResult, CoreError> {
        self.ready()?;
        range(args.from, args.to)?;
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-audit:p1:inst-audit-export
        let (ext, kind) = match args.format {
            LogFormat::Markdown => ("md", SaveKind::Markdown),
            LogFormat::Json => ("json", SaveKind::Json),
        };
        let name = format!("noter-audit.{ext}");
        let Some(path) = self.deps.native_ops.save_panel(&name, kind).await else {
            return Err(CoreError::new(ErrorCode::Cancelled, "export cancelled"));
        };
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-audit:p1:inst-audit-export
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-audit:p1:inst-audit-write
        // Complete or absent: written beside the target, then renamed over it.
        let tmp = path.with_extension("noter-tmp");
        let written = self.write_audit(&tmp, &args);
        let done = written.and_then(|()| {
            std::fs::rename(&tmp, &path).map_err(|e| crate::internal(format!("export: {e}")))
        });
        if let Err(e) = done {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-audit:p1:inst-audit-write
        // @cpt-begin:cpt-noter-flow-core-credentials-privacy-audit:p1:inst-audit-complete
        Ok(ExportResult {
            path: path.display().to_string(),
            files: 1,
        })
        // @cpt-end:cpt-noter-flow-core-credentials-privacy-audit:p1:inst-audit-complete
    }

    /// Streams the range into `file` in batches of `EXPORT_BATCH` rows.
    fn write_audit(&self, file: &std::path::Path, args: &AuditExportArgs) -> Result<(), CoreError> {
        let io = |e: std::io::Error| crate::internal(format!("cannot write the export: {e}"));
        let mut out = std::io::BufWriter::new(std::fs::File::create(file).map_err(io)?);
        let json = args.format == LogFormat::Json;
        out.write_all(if json { b"[" } else { b"# Noter audit log\n\n" })
            .map_err(io)?;
        let mut cursor = None;
        let mut first = true;
        loop {
            let rows = self.audit_rows(args.from, args.to, cursor.take(), EXPORT_BATCH)?;
            for row in &rows {
                if json {
                    let sep = if first { "\n" } else { ",\n" };
                    let body = serde_json::to_string(row).map_err(crate::internal)?;
                    write!(out, "{sep}{body}").map_err(io)?;
                } else {
                    writeln!(out, "{}", markdown_row(row)).map_err(io)?;
                }
                first = false;
            }
            match rows.last() {
                Some(last) if rows.len() == EXPORT_BATCH as usize => {
                    cursor = Some((last.at.0, last.id.as_str().to_owned()));
                }
                _ => break,
            }
        }
        if json {
            out.write_all(b"\n]\n").map_err(io)?;
        }
        out.flush().map_err(io)
    }
}

fn markdown_row(r: &AuditEntry) -> String {
    let ms = r.at.0;
    let (h, m) = (
        ms.rem_euclid(86_400_000) / 3_600_000,
        ms.rem_euclid(3_600_000) / 60_000,
    );
    let runtime = r
        .runtime
        .and_then(|r| serde_json::to_value(r).ok())
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default();
    let what = serde_json::to_value(r.what)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default();
    let mut line = format!(
        "- {} {h:02}:{m:02} · {what} → {} ({runtime}) · {} bytes",
        crate::history::date_of(ms),
        r.destination,
        r.bytes_out
    );
    if r.redacted {
        line.push_str(" · redacted");
    }
    if let Some(call) = &r.call {
        line.push_str(&format!(" · {}", call.title));
    }
    line
}
