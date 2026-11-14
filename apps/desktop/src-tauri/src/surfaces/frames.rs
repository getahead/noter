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

impl<R: Runtime> TauriSurfaces<R> {
    /// The record prompt on the display without the call app, 12 pt inside its visible frame.
    pub(super) fn place_prompt(&self, prompt: &WebviewWindow<R>, call_display: Option<&DisplayId>) {
        let (w, h) = *lock(&self.prompt_size);
        let displays = noter_native::displays();
        let Some(display) = prompt_display(&displays, call_display) else {
            return;
        };
        let id = display.id.clone();
        let app = self.app.clone();
        let prompt = prompt.clone();
        let _ = app.run_on_main_thread(move || {
            if let Some(screen) = noter_native::display_visible_frame(&id) {
                Self::place(&prompt, prompt_frame(&screen, (w, h)));
            }
        });
    }

    pub(super) fn place(window: &WebviewWindow<R>, (x, y, w, h): (f64, f64, f64, f64)) {
        let _ = window.set_size(LogicalSize::new(w, h));
        let _ = window.set_position(LogicalPosition::new(x, y));
    }

    pub(super) fn place_call(&self, placement: &Placement, collapsed: bool) {
        let Some(window) = self.window(WindowLabel::CallScreen) else {
            return;
        };
        let layout = placement.layout;
        let displays = noter_native::displays();
        let Some(display) =
            display_for(placement.display_id.as_ref(), &displays).map(|d| d.id.clone())
        else {
            return;
        };
        let saved = self.frames.get(&display, layout);
        let app = self.app.clone();
        let window = window.clone();
        let frame_display = display.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(visible) = noter_native::display_visible_frame(&frame_display) else {
                return;
            };
            // @cpt-begin:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame
            let frame = bounded_call_frame(
                if collapsed {
                    collapsed_frame(saved.unwrap_or_else(|| call_frame(layout, false, &visible)))
                } else {
                    saved.unwrap_or_else(|| call_frame(layout, false, &visible))
                },
                layout,
                collapsed,
                &visible,
            );
            // @cpt-end:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame
            match layout {
                CallLayout::Floating if collapsed => {
                    let _ = window.set_min_size(Some(LogicalSize::new(300.0, STRIP.1)));
                    let _ = window.set_max_size(Some(LogicalSize::new(600.0, STRIP.1)));
                }
                CallLayout::Floating => {
                    let _ = window.set_min_size(Some(LogicalSize::new(340.0, 300.0)));
                    let _ = window.set_max_size(Some(LogicalSize::new(600.0, f64::MAX)));
                }
                CallLayout::Dedicated => {
                    let _ = window.set_min_size(None::<LogicalSize<f64>>);
                    let _ = window.set_max_size(None::<LogicalSize<f64>>);
                }
            }
            Self::place(&window, frame);
        });
        *lock(&self.placed) = (!collapsed).then_some((display, layout));
    }

    /// On quit: the frames the user left are written.
    pub fn save_frames(&self) {
        self.frames.save();
    }

    /// The user moved or resized the call window: its frame is saved for that display and layout.
    // @cpt-begin:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame
    pub fn call_window_changed(&self, window: &tauri::Window<R>) {
        let Some((display, layout)) = lock(&self.placed).clone() else {
            return;
        };
        let scale = window.scale_factor().unwrap_or(1.0);
        let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) else {
            return;
        };
        let (pos, size) = (pos.to_logical::<f64>(scale), size.to_logical::<f64>(scale));
        self.frames
            .remember(&display, layout, (pos.x, pos.y, size.width, size.height));
    }
    // @cpt-end:cpt-noter-algo-core-native-surfaces-placement:p1:inst-frame
}

impl<R: Runtime> TauriSurfaces<R> {
    // @cpt-begin:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-core-detect
    pub(super) fn show_record_prompt_impl(&self, placement: &Placement) {
        let Some(prompt) = self.window(WindowLabel::RecordPrompt) else {
            return;
        };
        *lock(&self.prompt_call_display) = placement.display_id.clone();
        self.place_prompt(&prompt, placement.display_id.as_ref());
        show(&prompt, false);
    }
    // @cpt-end:cpt-noter-flow-ui-record-prompt-start-recording:p1:inst-core-detect

    // @cpt-begin:cpt-noter-algo-core-native-surfaces-panels:p1:inst-fit
    pub(super) fn fit_record_prompt_impl(&self, width: u32, height: u32) {
        *lock(&self.prompt_size) = (f64::from(width), f64::from(height));
        if let Some(prompt) = self
            .app
            .get_webview_window(WindowLabel::RecordPrompt.as_str())
        {
            let call_display = lock(&self.prompt_call_display).clone();
            self.place_prompt(&prompt, call_display.as_ref());
        }
    }
    // @cpt-end:cpt-noter-algo-core-native-surfaces-panels:p1:inst-fit

    pub(super) fn show_call_window_impl(&self, placement: &Placement) {
        self.place_call(placement, false);
        if let Some(window) = self.window(WindowLabel::CallScreen) {
            show(&window, false);
        }
    }

    pub(super) fn place_call_window_impl(&self, placement: &Placement, collapsed: bool) {
        self.place_call(placement, collapsed);
    }
}
