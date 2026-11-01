//! What the core's commands ask of macOS beyond `NativeServices` (TL-15): one trait that grows as
//! its consumers land, so every native ask is in one place. The real implementation is 2.21
//! native-services; the harness answers scripted.

use std::path::PathBuf;

use crate::BoxFuture;

/// What the save panel is for: it picks the file type the panel offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveKind {
    Markdown,
    Json,
}

/// Native asks of the commands. Still to come, each added by the command that needs it:
/// `clipboard_write(ShareText)` (`share_copy`, `handoff_copy`), `launch(LaunchPlan)`
/// (`handoff_open`) and `share_test(..)` (`share_test_run`).
pub trait NativeOps: Send + Sync {
    /// Shows the save panel named `suggested_name`; `None` when the user cancels.
    fn save_panel<'a>(
        &'a self,
        suggested_name: &'a str,
        kind: SaveKind,
    ) -> BoxFuture<'a, Option<PathBuf>>;
}

/// No Mac behind the core (unit tests, tools): every panel is cancelled.
pub(crate) struct NoNativeOps;

impl NativeOps for NoNativeOps {
    fn save_panel<'a>(&'a self, _: &'a str, _: SaveKind) -> BoxFuture<'a, Option<PathBuf>> {
        Box::pin(async { None })
    }
}
