//! Word boundaries shared by every keyword-index trigger, including migration backfills.

use std::ffi::{c_char, c_int};

use rusqlite::{ffi, functions::FunctionFlags, Connection};

pub(crate) unsafe extern "C" fn init(
    db: *mut ffi::sqlite3,
    error: *mut *mut c_char,
    _: *const ffi::sqlite3_api_routines,
) -> c_int {
    // SAFETY: SQLite supplies the live handle and error pointer; `register` only adds a
    // scalar function. rusqlite's bridge borrows the connection and catches panics.
    unsafe { rusqlite::auto_extension::init_auto_extension(db, error, register) }
}

// @cpt-algo:cpt-noter-algo-core-retrieval-ask-retrieve:p1
fn register(conn: Connection) -> rusqlite::Result<()> {
    // @cpt-begin:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-keywords
    conn.create_scalar_function(
        "noter_word_boundaries",
        1,
        FunctionFlags::SQLITE_UTF8
            | FunctionFlags::SQLITE_DETERMINISTIC
            | FunctionFlags::SQLITE_INNOCUOUS,
        |ctx| {
            let text = ctx.get::<String>(0)?;
            Ok(text
                .chars()
                .map(|c| if c.is_alphanumeric() { c } else { ' ' })
                .collect::<String>())
        },
    )
    // @cpt-end:cpt-noter-algo-core-retrieval-ask-retrieve:p1:inst-retrieve-keywords
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_connection_uses_unicode_alphanumeric_boundaries() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::Store::open(&dir.path().join("noter.db"), &[crate::MIGRATIONS]).unwrap();
        let text = "**Kubernetes**\tself.store_42🙂Решили—Überblick/中文";
        let expected = "  Kubernetes   self store 42 Решили Überblick 中文";
        let value = store
            .read(move |conn| {
                conn.query_row("SELECT noter_word_boundaries(?1)", [text], |r| {
                    r.get::<_, String>(0)
                })
            })
            .unwrap();
        assert_eq!(value, expected);
        let conn = Connection::open(dir.path().join("noter.db")).unwrap();
        assert_eq!(
            conn.query_row("SELECT noter_word_boundaries('')", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            ""
        );
        assert!(conn
            .query_row("SELECT noter_word_boundaries(NULL)", [], |r| r
                .get::<_, String>(0))
            .is_err());
    }
}
