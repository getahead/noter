//! The launch order (`cpt-noter-algo-core-handoff-launch`): the plan's URL handler, then the
//! terminal fallback. Opening is `NativeOps`'s; this decides what to try and what to report.

use std::future::Future;

use noter_protocol::model::{LaunchPath, LaunchPlan};
use noter_protocol::ErrorCode;

/// Tries `plan.path` with `attempt`, and after a URL handler that did not open, iTerm then
/// Terminal. Returns the path that opened, or the most useful error: `automation_denied` (the
/// user can allow it) over the others.
// @cpt-algo:cpt-noter-algo-core-handoff-launch:p1
pub async fn launch<F, Fut>(plan: &LaunchPlan, mut attempt: F) -> Result<LaunchPath, ErrorCode>
where
    F: FnMut(LaunchPath) -> Fut,
    Fut: Future<Output = Result<(), ErrorCode>>,
{
    use LaunchPath::*;
    // @cpt-begin:cpt-noter-algo-core-handoff-launch:p1:inst-launch-refused
    let order: &[LaunchPath] = match plan.path {
        None => return Err(ErrorCode::NoLinkHandler),
        Terminal | Iterm if plan.automation_denied => return Err(ErrorCode::AutomationDenied),
        Terminal => &[Terminal],
        Iterm => &[Iterm],
        // @cpt-begin:cpt-noter-algo-core-handoff-launch:p1:inst-launch-terminal
        ClaudeCliLink => &[ClaudeCliLink, Iterm, Terminal],
        ClaudeDesktop => &[ClaudeDesktop, Iterm, Terminal],
        CodexApp => &[CodexApp, Iterm, Terminal],
        // @cpt-end:cpt-noter-algo-core-handoff-launch:p1:inst-launch-terminal
    };
    // @cpt-end:cpt-noter-algo-core-handoff-launch:p1:inst-launch-refused
    let mut error = ErrorCode::NoLinkHandler;
    for &path in order {
        // @cpt-begin:cpt-noter-algo-core-handoff-launch:p1:inst-launch-link
        match attempt(path).await {
            Ok(()) => return Ok(path),
            Err(e) if error != ErrorCode::AutomationDenied => error = e,
            Err(_) => {}
        }
        // @cpt-end:cpt-noter-algo-core-handoff-launch:p1:inst-launch-link
    }
    Err(error)
}
