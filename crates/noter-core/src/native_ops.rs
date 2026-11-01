//! What the core's commands ask of macOS beyond `NativeServices` (TL-15): one trait that grows as
//! its consumers land, so every native ask is in one place. The real implementation is 2.21
//! native-services; the harness answers scripted.

use std::path::PathBuf;

use noter_protocol::model::{HandoffTarget, LaunchPath, LaunchPlan};
use noter_protocol::ErrorCode;

use crate::BoxFuture;

/// What the save panel is for: it picks the file type the panel offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveKind {
    Markdown,
    Json,
    /// Choose a folder (a repository mapping) instead of naming a file.
    Folder,
}

/// A launch `handoff_open` asks for: the tool opens in `cwd`, pre-filled with a short instruction
/// to read `prompt_file`. Only the file's path travels, never the prompt's text.
#[derive(Debug, Clone, PartialEq)]
pub struct LaunchRequest {
    pub target: HandoffTarget,
    pub cwd: PathBuf,
    pub prompt_file: PathBuf,
}

/// What a clipboard write carries: plain text always, the rich forms when the caller has them.
#[derive(Debug, Clone, PartialEq)]
pub struct ClipboardText {
    pub plain: String,
    pub markdown: Option<String>,
    pub html: Option<String>,
}

/// Native asks of the commands. Still to come, added by the command that needs it:
/// `share_test(..)` (`share_test_run`).
pub trait NativeOps: Send + Sync {
    /// Shows the save panel named `suggested_name`; `None` when the user cancels.
    fn save_panel<'a>(
        &'a self,
        suggested_name: &'a str,
        kind: SaveKind,
    ) -> BoxFuture<'a, Option<PathBuf>>;

    /// The path a launch for `target` would take now (URL handlers, terminals, Automation as
    /// macOS reports it). Opens and asks nothing. Without a Mac nothing can launch.
    fn launch_plan(&self, _target: HandoffTarget) -> LaunchPlan {
        LaunchPlan {
            path: LaunchPath::None,
            needs_automation: false,
            automation_denied: false,
        }
    }

    /// Launches `req` by `path`: pre-filled, never sent. May wait while macOS asks for
    /// Automation.
    fn launch<'a>(
        &'a self,
        _path: LaunchPath,
        _req: &'a LaunchRequest,
    ) -> BoxFuture<'a, Result<(), ErrorCode>> {
        Box::pin(async { Err(ErrorCode::NoLinkHandler) })
    }

    /// Replaces the clipboard; `Ok` only once the pasteboard took the text.
    fn clipboard_write<'a>(
        &'a self,
        _text: &'a ClipboardText,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async { Err("no clipboard".into()) })
    }
}

/// No Mac behind the core (unit tests, tools): every panel is cancelled.
pub(crate) struct NoNativeOps;

impl NativeOps for NoNativeOps {
    fn save_panel<'a>(&'a self, _: &'a str, _: SaveKind) -> BoxFuture<'a, Option<PathBuf>> {
        Box::pin(async { None })
    }
}
