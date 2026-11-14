// Responsibilities from the core native surfaces feature.
use super::*;
use noter_native::Frame;
use noter_protocol::model::{CallLayout, DisplayInfo};
use noter_protocol::DisplayId;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};


/// The frame of the call display: the chosen display by identity, else (none chosen, or
/// unplugged) the main display; frames come from noter-native's AppKit visible-frame query.
// @cpt-begin:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-read-displays
pub fn frame_of(
    chosen: Option<&DisplayId>,
    displays: &[DisplayInfo],
    frame: impl Fn(&DisplayId) -> Option<Frame>,
) -> Option<(DisplayId, Frame)> {
    let display = display_for(chosen, displays)?;
    Some((display.id.clone(), frame(&display.id)?))
}

pub(super) fn display_for<'a>(
    chosen: Option<&DisplayId>,
    displays: &'a [DisplayInfo],
) -> Option<&'a DisplayInfo> {
    let main = || displays.iter().find(|d| d.is_main).or(displays.first());
    let display = chosen
        .and_then(|id| displays.iter().find(|d| d.id == *id))
        .or_else(main)?;
    Some(display)
}
// @cpt-end:cpt-noter-flow-core-native-surfaces-display-change:p1:inst-read-displays

/// A frame kept inside the display's visible area.
pub fn clamp_frame((x, y, w, h): (f64, f64, f64, f64), visible: &Frame) -> (f64, f64, f64, f64) {
    let (w, h) = (w.min(visible.width), h.min(visible.height));
    let x = x.clamp(visible.x, visible.x + visible.width - w);
    let y = y.clamp(visible.y, visible.y + visible.height - h);
    (x, y, w, h)
}

/// The call window's frames the user left, per display and layout, in a small JSON file beside
/// the data folder; a missing or damaged file is no saved frame.
pub struct SavedFrames {
    path: PathBuf,
    frames: Mutex<BTreeMap<String, (f64, f64, f64, f64)>>,
    dirty: AtomicBool,
}

fn frame_key(display: &DisplayId, layout: CallLayout) -> String {
    format!("{}/{layout:?}", display.as_str())
}

impl SavedFrames {
    pub fn load(path: &Path) -> Self {
        let read: Option<BTreeMap<String, [f64; 4]>> = std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok());
        let frames = read
            .unwrap_or_default()
            .into_iter()
            .map(|(k, [x, y, w, h])| (k, (x, y, w, h)))
            .collect();
        Self {
            path: path.to_path_buf(),
            frames: Mutex::new(frames),
            dirty: AtomicBool::new(false),
        }
    }

    pub fn get(&self, display: &DisplayId, layout: CallLayout) -> Option<(f64, f64, f64, f64)> {
        let frames = lock(&self.frames);
        frames.get(&frame_key(display, layout)).copied()
    }

    /// In memory only: a drag reports many frames; `save` writes the last one.
    pub fn remember(&self, display: &DisplayId, layout: CallLayout, frame: (f64, f64, f64, f64)) {
        let mut frames = lock(&self.frames);
        if frames.insert(frame_key(display, layout), frame) != Some(frame) {
            self.dirty.store(true, Ordering::Relaxed);
        }
    }

    /// Writes the frames when they changed since the last save.
    pub fn save(&self) {
        if !self.dirty.swap(false, Ordering::Relaxed) {
            return;
        }
        let frames = lock(&self.frames);
        let file: BTreeMap<&String, [f64; 4]> = frames
            .iter()
            .map(|(k, &(x, y, w, h))| (k, [x, y, w, h]))
            .collect();
        // Losing a saved frame only costs the default placement next time.
        let _ = std::fs::write(&self.path, serde_json::to_string(&file).unwrap_or_default());
    }
}

/// Where the call window goes: the whole display (dedicated) or a panel in its top-right corner.
pub fn call_frame(layout: CallLayout, collapsed: bool, screen: &Frame) -> (f64, f64, f64, f64) {
    match layout {
        CallLayout::Dedicated => (screen.x, screen.y, screen.width, screen.height),
        CallLayout::Floating => {
            let (w, h) = if collapsed { STRIP } else { PANEL };
            let x = screen.x + screen.width - w - MARGIN;
            (x, screen.y + MARGIN, w, h)
        }
    }
}

// @cpt-begin:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame
pub fn collapsed_frame((x, y, w, _): (f64, f64, f64, f64)) -> (f64, f64, f64, f64) {
    (x, y, w, STRIP.1)
}
// @cpt-end:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame

// @cpt-begin:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame
pub fn bounded_call_frame(
    (x, y, w, h): (f64, f64, f64, f64),
    layout: CallLayout,
    collapsed: bool,
    visible: &Frame,
) -> (f64, f64, f64, f64) {
    if layout == CallLayout::Dedicated {
        return clamp_frame((x, y, w, h), visible);
    }
    let min_width = if collapsed { 300.0 } else { 340.0 };
    let max_width = 600.0;
    let (w, h) = if collapsed {
        (w.clamp(min_width, max_width), STRIP.1)
    } else {
        (w.clamp(min_width, max_width), h.max(300.0))
    };
    clamp_frame((x, y, w, h), visible)
}
// @cpt-end:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame

// @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-core-detect
pub fn prompt_display<'a>(
    displays: &'a [DisplayInfo],
    call_display: Option<&DisplayId>,
) -> Option<&'a DisplayInfo> {
    let Some(call_display) = call_display
        .and_then(|id| display_for(Some(id), displays))
        .map(|display| display.id.clone())
    else {
        return displays
            .iter()
            .find(|display| display.is_main)
            .or_else(|| displays.first());
    };
    displays
        .iter()
        .find(|display| display.id != call_display)
        .or_else(|| displays.iter().find(|display| display.is_main))
        .or_else(|| displays.first())
}

pub fn prompt_frame(screen: &Frame, (w, h): (f64, f64)) -> (f64, f64, f64, f64) {
    (screen.x + screen.width - w - 12.0, screen.y + 12.0, w, h)
}
// @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-core-detect
