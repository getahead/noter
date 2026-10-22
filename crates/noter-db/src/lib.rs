//! noter-db: one SQLite file, one writer task, a read-only pool, numbered migrations and the
//! change-log write path. The only crate that touches SQLite (`just arch`).
//!
//! Callers read with plain SQL through `rusqlite` (re-exported) and write only through
//! [`Store::write`] / [`Store::write_batch`], which commit each row with its `changes` row.

// @cpt-component:cpt-noter-component-core-storage:p1
// @cpt-component:cpt-noter-component-core-changelog:p1

mod change;
mod migrate;

use std::fs::{DirBuilder, OpenOptions};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex, MutexGuard, Once};
use std::thread::JoinHandle;
use std::time::Duration;

use noter_protocol::{CoreError, ErrorCode};
use rusqlite::{Connection, ErrorCode as SqliteCode, OpenFlags};

pub use change::{ChangeMeta, Custom, Insert, Logged, Mutation, Written};
pub use migrate::{Migration, MIGRATIONS};
pub use rusqlite;

/// Read-only connections opened with the store; more are opened when all are busy.
const READERS: usize = 2;
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// `~/Library/Application Support/Noter/noter.db`.
pub fn default_path() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support/Noter/noter.db"))
}

/// Store lifecycle (closed → opening → migrating → ready → shutting_down → closed, or failed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreState {
    Closed,
    Opening,
    Migrating,
    Ready,
    Failed,
    ShuttingDown,
}

impl StoreState {
    // @cpt-state:cpt-noter-state-core-storage-lifecycle:p1
    fn advance(&mut self, next: StoreState) {
        use StoreState::*;
        let allowed = matches!(
            (*self, next),
            (Closed, Opening)
                | (Opening, Migrating)
                | (Opening, Failed)
                | (Migrating, Ready)
                | (Migrating, Failed)
                | (Ready, ShuttingDown)
                | (ShuttingDown, Closed)
        );
        debug_assert!(allowed, "store state {self:?} cannot become {next:?}");
        *self = next;
    }
}

/// Why the store did not open. In every case nothing was written and no writes are accepted.
#[derive(Debug)]
pub enum OpenError {
    Io(std::io::Error),
    /// The file is not a database or `PRAGMA quick_check` failed; carries the check's result, never record text.
    Corrupt(String),
    /// The file has a migration this binary does not know: it belongs to a newer app version.
    SchemaAhead {
        owner: String,
        version: u32,
    },
    /// The migration rolled back; the database stays at the previous version.
    Migration {
        owner: &'static str,
        version: u32,
        message: String,
    },
    /// The migration lists given to `open` are duplicated or out of order.
    InvalidMigrations(String),
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "cannot create the database file: {e}"),
            Self::Corrupt(check) => write!(f, "the database failed its quick check: {check}"),
            Self::SchemaAhead { owner, version } => {
                write!(
                    f,
                    "the database has {owner} migration {version}, newer than this app"
                )
            }
            Self::Migration {
                owner,
                version,
                message,
            } => write!(f, "{owner} migration {version} failed: {message}"),
            Self::InvalidMigrations(why) => f.write_str(why),
            Self::Sqlite(e) => write!(f, "cannot open the database: {e}"),
        }
    }
}

impl std::error::Error for OpenError {}

impl From<std::io::Error> for OpenError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

type Job = Box<dyn FnOnce(&mut Connection) + Send>;

/// The open database: the writer task owns the only read-write connection.
pub struct Store {
    path: PathBuf,
    state: Mutex<StoreState>,
    queue: Mutex<Option<mpsc::Sender<Job>>>,
    writer: Mutex<Option<JoinHandle<()>>>,
    readers: Mutex<Vec<Connection>>,
}

impl Store {
    /// Open (or create) the database at `path` and bring it to the newest schema of `migrations`
    /// (one list per crate that owns tables, `MIGRATIONS` first).
    // @cpt-flow:cpt-noter-flow-core-storage-open:p1
    // @cpt-dod:cpt-noter-dod-core-storage-single-writer:p1
    pub fn open(path: &Path, migrations: &[&[Migration]]) -> Result<Store, OpenError> {
        let mut state = StoreState::Closed;
        // @cpt-begin:cpt-noter-state-core-storage-lifecycle:p1:inst-st-open
        state.advance(StoreState::Opening);
        // @cpt-end:cpt-noter-state-core-storage-lifecycle:p1:inst-st-open
        // @cpt-begin:cpt-noter-flow-core-storage-open:p1:inst-resolve-path
        create_private(path)?;
        // @cpt-end:cpt-noter-flow-core-storage-open:p1:inst-resolve-path
        // @cpt-begin:cpt-noter-flow-core-storage-open:p1:inst-open-writer
        let mut conn = open_writer(path).map_err(sqlite_err)?;
        // @cpt-end:cpt-noter-flow-core-storage-open:p1:inst-open-writer
        // @cpt-begin:cpt-noter-flow-core-storage-open:p1:inst-quick-check
        let check = conn.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0));
        // @cpt-end:cpt-noter-flow-core-storage-open:p1:inst-quick-check
        // @cpt-begin:cpt-noter-flow-core-storage-open:p1:inst-if-corrupt
        if check.as_deref() != Ok("ok") {
            // @cpt-begin:cpt-noter-flow-core-storage-open:p1:inst-return-corrupt
            // @cpt-begin:cpt-noter-state-core-storage-lifecycle:p1:inst-st-corrupt
            state.advance(StoreState::Failed);
            // @cpt-end:cpt-noter-state-core-storage-lifecycle:p1:inst-st-corrupt
            return Err(OpenError::Corrupt(check.unwrap_or_else(|e| e.to_string())));
            // @cpt-end:cpt-noter-flow-core-storage-open:p1:inst-return-corrupt
        }
        // @cpt-end:cpt-noter-flow-core-storage-open:p1:inst-if-corrupt
        // @cpt-begin:cpt-noter-state-core-storage-lifecycle:p1:inst-st-migrate
        state.advance(StoreState::Migrating);
        // @cpt-end:cpt-noter-state-core-storage-lifecycle:p1:inst-st-migrate
        // @cpt-begin:cpt-noter-flow-core-storage-open:p1:inst-run-migrations
        let migrated = migrate::run(&mut conn, migrations);
        // @cpt-end:cpt-noter-flow-core-storage-open:p1:inst-run-migrations
        if let Err(e) = migrated {
            // @cpt-begin:cpt-noter-state-core-storage-lifecycle:p1:inst-st-migrate-fail
            state.advance(StoreState::Failed);
            // @cpt-end:cpt-noter-state-core-storage-lifecycle:p1:inst-st-migrate-fail
            return Err(e);
        }
        // @cpt-begin:cpt-noter-flow-core-storage-open:p1:inst-start-writer
        let readers = (0..READERS)
            .map(|_| open_reader(path))
            .collect::<Result<Vec<_>, _>>()
            .map_err(sqlite_err)?;
        let (queue, jobs) = mpsc::channel::<Job>();
        let writer = std::thread::Builder::new()
            .name("noter-db-writer".into())
            .spawn(move || writer_task(conn, jobs))?;
        // @cpt-end:cpt-noter-flow-core-storage-open:p1:inst-start-writer
        // @cpt-begin:cpt-noter-state-core-storage-lifecycle:p1:inst-st-ready
        state.advance(StoreState::Ready);
        // @cpt-end:cpt-noter-state-core-storage-lifecycle:p1:inst-st-ready
        // @cpt-begin:cpt-noter-flow-core-storage-open:p1:inst-return-ready
        Ok(Store {
            path: path.to_owned(),
            state: Mutex::new(state),
            queue: Mutex::new(Some(queue)),
            writer: Mutex::new(Some(writer)),
            readers: Mutex::new(readers),
        })
        // @cpt-end:cpt-noter-flow-core-storage-open:p1:inst-return-ready
    }

    pub fn state(&self) -> StoreState {
        *lock(&self.state)
    }

    /// Read on a pooled read-only connection (read models).
    // @cpt-algo:cpt-noter-algo-core-storage-snapshot-read:p2
    pub fn read<T>(
        &self,
        f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, CoreError> {
        if self.state() != StoreState::Ready {
            return Err(internal("the store is not open"));
        }
        // @cpt-begin:cpt-noter-algo-core-storage-snapshot-read:p2:inst-read-pool
        let conn = match lock(&self.readers).pop() {
            Some(conn) => conn,
            None => open_reader(&self.path).map_err(internal)?,
        };
        let result = f(&conn).map_err(internal);
        lock(&self.readers).push(conn);
        // @cpt-end:cpt-noter-algo-core-storage-snapshot-read:p2:inst-read-pool
        // @cpt-begin:cpt-noter-algo-core-storage-snapshot-read:p2:inst-return-read
        result
        // @cpt-end:cpt-noter-algo-core-storage-snapshot-read:p2:inst-return-read
    }

    /// Read for a stream snapshot: on the writer connection between two writer jobs, so the
    /// result matches what has been published. The caller holds the stream hub lock.
    pub fn read_snapshot<T: Send + 'static>(
        &self,
        f: impl FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
    ) -> Result<T, CoreError> {
        // @cpt-begin:cpt-noter-algo-core-storage-snapshot-read:p2:inst-if-snapshot
        // @cpt-begin:cpt-noter-algo-core-storage-snapshot-read:p2:inst-read-writer
        self.on_writer(move |conn| {
            conn.pragma_update(None, "query_only", true)
                .map_err(internal)?;
            let _writable_again = QueryOnly(conn);
            f(conn).map_err(internal)
        })
        // @cpt-end:cpt-noter-algo-core-storage-snapshot-read:p2:inst-read-writer
        // @cpt-end:cpt-noter-algo-core-storage-snapshot-read:p2:inst-if-snapshot
    }

    /// Shut down: the writer drains its queue and checkpoints, then every connection closes.
    /// Later calls answer `internal`. Idempotent; also runs on drop.
    pub fn close(&self) {
        {
            let mut state = lock(&self.state);
            if *state != StoreState::Ready {
                return;
            }
            // @cpt-begin:cpt-noter-state-core-storage-lifecycle:p1:inst-st-shutdown
            state.advance(StoreState::ShuttingDown);
            // @cpt-end:cpt-noter-state-core-storage-lifecycle:p1:inst-st-shutdown
        }
        drop(lock(&self.queue).take());
        if let Some(writer) = lock(&self.writer).take() {
            let _ = writer.join();
        }
        lock(&self.readers).clear();
        // @cpt-begin:cpt-noter-state-core-storage-lifecycle:p1:inst-st-closed
        lock(&self.state).advance(StoreState::Closed);
        // @cpt-end:cpt-noter-state-core-storage-lifecycle:p1:inst-st-closed
    }

    /// Run `f` on the writer task and wait for its result.
    fn on_writer<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Connection) -> Result<T, CoreError> + Send + 'static,
    ) -> Result<T, CoreError> {
        let (reply, result) = mpsc::sync_channel(1);
        {
            let queue = lock(&self.queue);
            let queue = queue
                .as_ref()
                .ok_or_else(|| internal("the store is not open"))?;
            queue
                .send(Box::new(move |conn| {
                    let _ = reply.send(f(conn));
                }))
                .map_err(|_| internal("the writer task stopped"))?;
        }
        result
            .recv()
            .map_err(|_| internal("the writer task stopped"))?
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        self.close();
    }
}

/// Turns `query_only` off again when a snapshot read ends, even by a panic.
struct QueryOnly<'a>(&'a Connection);

impl Drop for QueryOnly<'_> {
    fn drop(&mut self) {
        let _ = self.0.pragma_update(None, "query_only", false);
    }
}

/// The only read-write connection: jobs run one at a time, in order, until the store closes.
/// A job that panics answers `internal` (its reply is dropped) and the writer goes on.
fn writer_task(mut conn: Connection, jobs: mpsc::Receiver<Job>) {
    for job in jobs {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| job(&mut conn)));
    }
    let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
}

/// The folder with mode 0700 and the file with mode 0600, when missing.
fn create_private(path: &Path) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    }
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
    {
        Err(e) if e.kind() != std::io::ErrorKind::AlreadyExists => Err(e),
        _ => Ok(()),
    }
}

fn open_writer(path: &Path) -> rusqlite::Result<Connection> {
    load_extensions();
    let conn = Connection::open(path)?;
    // Before the first table exists, or it has no effect.
    conn.pragma_update(None, "auto_vacuum", "INCREMENTAL")?;
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

fn open_reader(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    Ok(conn)
}

/// FTS5 is compiled into the bundled SQLite; sqlite-vec registers itself for every connection.
fn load_extensions() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // SAFETY: the documented way to register the statically linked sqlite-vec entry point;
        // its signature is the extension-init signature sqlite3_auto_extension expects.
        unsafe {
            #[allow(clippy::missing_transmute_annotations)]
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        }
    });
}

fn sqlite_err(e: rusqlite::Error) -> OpenError {
    match e.sqlite_error_code() {
        Some(SqliteCode::NotADatabase | SqliteCode::DatabaseCorrupt) => {
            OpenError::Corrupt(e.to_string())
        }
        _ => OpenError::Sqlite(e),
    }
}

/// `internal`: developer text for the log only, never record text.
fn internal(e: impl std::fmt::Display) -> CoreError {
    CoreError::new(ErrorCode::Internal, e.to_string())
}

fn now_ms() -> i64 {
    let since = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    since.as_millis() as i64
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[should_panic(expected = "cannot become")]
    fn the_lifecycle_refuses_a_skipped_state() {
        StoreState::Closed.advance(StoreState::Ready);
    }

    #[test]
    fn open_errors_say_what_failed() {
        let cases = [
            (
                OpenError::Io(std::io::Error::other("denied")),
                "cannot create",
            ),
            (OpenError::Corrupt("page 3".into()), "quick check"),
            (
                OpenError::SchemaAhead {
                    owner: "x".into(),
                    version: 9,
                },
                "newer than this app",
            ),
            (
                OpenError::Migration {
                    owner: "x",
                    version: 2,
                    message: "no".into(),
                },
                "migration 2 failed",
            ),
            (OpenError::InvalidMigrations("dup".into()), "dup"),
            (
                OpenError::Sqlite(rusqlite::Error::InvalidQuery),
                "cannot open",
            ),
        ];
        for (e, text) in cases {
            assert!(e.to_string().contains(text), "{e}");
        }
    }
}
