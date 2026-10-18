//! How an engine is started: the seam `noter-core-harness` and the tests use to replace the
//! Swift engine with a scripted one (S12), and the real launcher over `tokio::process`.

use std::ffi::OsString;
use std::future::Future;
use std::io;
use std::path::PathBuf;
use std::pin::Pin;
use std::process::Stdio;
use std::task::{Context, Poll};

use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::process::{Child, ChildStdout, Command};

/// The two pipes of one engine: the core writes command lines to `stdin` and reads event
/// lines from `stdout`. Dropping `stdout` ends the engine.
pub struct EngineIo {
    pub stdin: Box<dyn AsyncWrite + Unpin + Send>,
    pub stdout: Box<dyn AsyncRead + Unpin + Send>,
}

/// Starts one engine process (or a scripted stand-in) and hands back its pipes.
pub trait EngineLauncher: Send + Sync + 'static {
    fn launch(&self) -> impl Future<Output = io::Result<EngineIo>> + Send;
}

/// The real engine: the bundled `noter-engine` binary run with `tokio::process`.
#[derive(Debug, Clone)]
pub struct ProcessLauncher {
    program: PathBuf,
    args: Vec<OsString>,
    app_group: Option<PathBuf>,
}

impl ProcessLauncher {
    pub fn new(program: impl Into<PathBuf>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            app_group: None,
        }
    }

    // @cpt-begin:cpt-noter-flow-core-engine-foundation-start:p1:inst-resolve
    /// The engine inside the app bundle, or `NOTER_ENGINE_PATH` in development.
    pub fn from_env(bundled: impl Into<PathBuf>) -> Self {
        let dev = std::env::var_os("NOTER_ENGINE_PATH").map(PathBuf::from);
        Self::new(Self::resolve(bundled, dev))
    }

    pub fn resolve(bundled: impl Into<PathBuf>, dev_override: Option<PathBuf>) -> PathBuf {
        dev_override.unwrap_or_else(|| bundled.into())
    }

    /// The App Group container the app and the sandboxed engine share; every path the
    /// supervisor sends is relative to it.
    pub fn app_group(mut self, dir: impl Into<PathBuf>) -> Self {
        self.app_group = Some(dir.into());
        self
    }
    // @cpt-end:cpt-noter-flow-core-engine-foundation-start:p1:inst-resolve

    /// Extra arguments, for file mode (`--mic`, `--sys`) and for tests.
    pub fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<OsString>,
    {
        self.args.extend(args.into_iter().map(Into::into));
        self
    }
}

impl EngineLauncher for ProcessLauncher {
    // @cpt-begin:cpt-noter-flow-core-engine-foundation-start:p1:inst-spawn
    async fn launch(&self) -> io::Result<EngineIo> {
        let mut cmd = Command::new(&self.program);
        // stderr is the engine's log and goes to the core's log; stdout carries protocol only.
        cmd.args(&self.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);
        if let Some(dir) = &self.app_group {
            cmd.env("NOTER_APP_GROUP_DIR", dir);
        }
        let mut child = cmd.spawn()?;
        let stdin = child.stdin.take().expect("stdin is piped");
        let stdout = child.stdout.take().expect("stdout is piped");
        Ok(EngineIo {
            stdin: Box::new(stdin),
            stdout: Box::new(OwnedStdout {
                stdout,
                _child: child,
            }),
        })
    }
    // @cpt-end:cpt-noter-flow-core-engine-foundation-start:p1:inst-spawn
}

/// The stdout pipe owns the child, so dropping the reader kills the process (`kill_on_drop`).
struct OwnedStdout {
    stdout: ChildStdout,
    _child: Child,
}

impl AsyncRead for OwnedStdout {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stdout).poll_read(cx, buf)
    }
}
