use std::path::PathBuf;

use super::{DisplayInfo, HandoffTarget, NotificationAuth, OutputDeviceInfo, OutputRoute};

/// The native environment fields shared by the host and core.
#[derive(Debug, Clone, PartialEq)]
pub struct EnvironmentReading {
    pub displays: Vec<DisplayInfo>,
    pub output_device: Option<OutputDeviceInfo>,
    pub output_route: OutputRoute,
    pub notifications: NotificationAuth,
    pub online: bool,
    pub disk_free_mb: u32,
}

impl Default for EnvironmentReading {
    fn default() -> Self {
        Self {
            displays: Vec::new(),
            output_device: None,
            output_route: OutputRoute::Unknown,
            notifications: NotificationAuth::NotDetermined,
            online: true,
            disk_free_mb: 0,
        }
    }
}

/// A validated native launch request. Only the saved prompt path crosses this seam.
#[derive(Debug, Clone, PartialEq)]
pub struct LaunchRequest {
    pub target: HandoffTarget,
    pub cwd: PathBuf,
    pub prompt_file: PathBuf,
}

/// Plain text always, with rich clipboard forms when the caller has them.
#[derive(Debug, Clone, PartialEq)]
pub struct ClipboardText {
    pub plain: String,
    pub markdown: Option<String>,
    pub html: Option<String>,
}
