//! The menu bar extra's content (docs/features/ui/menu-bar.md): the glyph, title and VoiceOver
//! label of the status item and the ordered menu MB-R2 to MB-R7, built from the core's state. The
//! native layer behind [`crate::Surfaces`] only draws it.

use noter_protocol::model::*;
use noter_protocol::*;

/// The template glyph: idle, recording, paused, or copilot muted (copilot arrives in M4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayGlyph {
    Idle,
    Recording,
    Paused,
    CopilotMuted,
}

/// What a menu item does when clicked; the app maps each to a core command as `Caller::Native`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayAction {
    /// **Call Detected · Start Recording** in MB-R2.
    StartDetected,
    FinishSetup,
    KeepRecording,
    StopNow,
    /// The new-meeting answers shown while hidden for presenting.
    StartAsNewCall,
    KeepInThisCall,
    TryAgain,
    ContinueRecording,
    StartRecording,
    StopRecording,
    Pause,
    Resume,
    MarkMoment,
    OpenCallScreen,
    UseFloatingPanel,
    HideForPresenting,
    ShowAfterPresenting,
    OpenNoter,
    OpenSettings,
    QuitNoter,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayItem {
    pub action: TrayAction,
    pub label: String,
    pub enabled: bool,
    /// A checkmark item (**Use Floating Panel**) and whether it is checked.
    pub checked: Option<bool>,
    /// The key it shows, in Tauri accelerator syntax; none when its hotkey did not register.
    pub key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrayEntry {
    /// An info line, drawn as a disabled item.
    Line(String),
    Item(TrayItem),
    Separator,
}

/// Everything the status item shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayModel {
    pub glyph: TrayGlyph,
    /// Hidden for presenting: the glyph carries the eye-slash badge.
    pub hidden: bool,
    /// The text beside the glyph (the **Menu bar title** setting).
    pub title: Option<String>,
    /// The VoiceOver label: "Noter, recording, 23 minutes".
    pub label: String,
    pub entries: Vec<TrayEntry>,
}

impl TrayModel {
    pub fn item(&self, action: TrayAction) -> Option<&TrayItem> {
        self.entries.iter().find_map(|e| match e {
            TrayEntry::Item(i) if i.action == action => Some(i),
            _ => None,
        })
    }

    pub fn lines(&self) -> Vec<&str> {
        self.entries
            .iter()
            .filter_map(|e| match e {
                TrayEntry::Line(l) => Some(l.as_str()),
                _ => None,
            })
            .collect()
    }
}

/// What the menu is built from.
pub(crate) struct TrayInputs<'a> {
    pub capture: &'a CaptureState,
    pub hidden: bool,
    pub privacy: PrivacyMode,
    pub title: MenuBarTitle,
    pub layout: CallLayoutPreference,
    /// A call is detected and not recorded.
    pub detected: bool,
    pub degraded: &'a [DegradedState],
    pub hotkeys: &'a [HotkeyBinding],
    /// Under 500 MB free or without the speech model: a start would be refused.
    pub start_blocked: bool,
    pub speakers: usize,
    /// Recorded time so far, pauses excluded (as the call window counts it).
    pub elapsed_ms: i64,
    pub now: i64,
}

/// "23:14", or "1:02:03" past an hour.
fn clock(ms: i64) -> String {
    let s = ms.max(0) / 1000;
    let (h, m, s) = (s / 3600, s / 60 % 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

fn plural(n: i64, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

fn privacy_text(mode: PrivacyMode) -> &'static str {
    match mode {
        PrivacyMode::CloudAllowed => "Cloud allowed",
        PrivacyMode::CloudRedacted => "Cloud, redacted",
        PrivacyMode::LocalOnly => "Local only",
    }
}

/// The key of the hotkey bound to an item, when it registered.
fn key_of(hotkeys: &[HotkeyBinding], action: HotkeyAction) -> Option<String> {
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-no-key
    hotkeys
        .iter()
        .find(|b| b.action == action)
        .filter(|b| {
            matches!(
                b.status,
                HotkeyStatus::Registered | HotkeyStatus::RegisteredDuringCapture
            )
        })
        .and_then(|b| b.shortcut.clone())
    // @cpt-end:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-no-key
}

fn entry(action: TrayAction, label: &str, enabled: bool, key: Option<String>) -> TrayEntry {
    TrayEntry::Item(TrayItem {
        action,
        label: label.into(),
        enabled,
        checked: None,
        key,
    })
}

// @cpt-dod:cpt-noter-dod-ui-menu-bar-content:p2
// @cpt-algo:cpt-noter-algo-ui-menu-bar-glyph:p1
// @cpt-algo:cpt-noter-algo-ui-menu-bar-build-menu:p1
// @cpt-state:cpt-noter-state-ui-menu-bar-status-item:p1
pub(crate) fn tray_model(i: &TrayInputs) -> TrayModel {
    let c = i.capture;
    let phase = c.phase;
    let live = matches!(
        phase,
        CapturePhase::Starting | CapturePhase::Recording | CapturePhase::Paused
    );
    let idle = matches!(phase, CapturePhase::Idle | CapturePhase::Stopped);
    let elapsed = i.elapsed_ms;
    // The 5 minutes after any stop: the closing line and **Continue Recording**.
    let closing =
        phase == CapturePhase::Stopped && c.continue_until.is_some_and(|until| i.now <= until.0);
    let ended = matches!(
        c.notice,
        Some(CaptureNotice::CallEnded { .. } | CaptureNotice::CallSeemsEnded { .. })
    );
    let new_meeting = i.hidden && matches!(c.notice, Some(CaptureNotice::NewMeeting { .. }));
    let key = |action| key_of(i.hotkeys, action);
    let named = |head: &str| match &c.title {
        Some(t) => format!("{head} · {t}"),
        None => head.into(),
    };

    // @cpt-begin:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-match-glyph
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-idle-recording
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-recording-paused
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-paused-recording
    // The muted glyph (inst-case-muted) waits for the copilot (M4, behind its flag).
    let glyph = match phase {
        // @cpt-begin:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-case-paused
        CapturePhase::Paused => TrayGlyph::Paused,
        // @cpt-end:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-case-paused
        // @cpt-begin:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-case-recording
        CapturePhase::Starting | CapturePhase::Recording => TrayGlyph::Recording,
        // @cpt-end:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-case-recording
        // @cpt-begin:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-case-idle
        _ => TrayGlyph::Idle,
        // @cpt-end:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-case-idle
    };
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-paused-recording
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-recording-paused
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-idle-recording
    // @cpt-end:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-match-glyph
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-hidden-badge
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-title
    // Hidden for presenting clears the title; Newest Card is the copilot's (M4): no title yet.
    let title = (i.title == MenuBarTitle::ElapsedTime && live && !i.hidden).then(|| clock(elapsed));
    // @cpt-end:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-title
    // @cpt-end:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-hidden-badge
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-vo-label
    let state = match glyph {
        TrayGlyph::Recording => format!(
            "recording, {}",
            plural(elapsed.max(0) / 60_000, "minute", "minutes")
        ),
        TrayGlyph::Paused => "paused".into(),
        TrayGlyph::CopilotMuted => "copilot muted".into(),
        TrayGlyph::Idle => "not recording".into(),
    };
    let hidden_part = if i.hidden {
        ", hidden for presenting"
    } else {
        ""
    };
    let label = format!("Noter, {state}{hidden_part}");
    // @cpt-end:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-vo-label

    // MB-R2
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr2-first
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-recording-ended
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-recording-engine
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-recording-closing
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-ended-closing
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-closing-idle
    let reminded = c
        .pause
        .as_ref()
        .and_then(|p| p.remind_at)
        .is_some_and(|at| i.now >= at.0);
    let first = match &c.notice {
        _ if phase == CapturePhase::Failed => "Not recording · engine stopped".to_string(),
        Some(CaptureNotice::CallEnded { stops_at: Some(at) }) if live => {
            let left = ((at.0 - i.now).max(0) + 999) / 1000;
            format!("Call seems to have ended · stopping in {left} s")
        }
        _ if live && ended => "Call seems to have ended".into(),
        Some(CaptureNotice::NewMeeting { event, .. }) if live && i.hidden => match event {
            Some(e) => format!("A new meeting may have started: {}", e.title),
            None => "A new meeting may have started".into(),
        },
        _ if phase == CapturePhase::Paused && reminded => "Paused for 5 min".into(),
        _ if phase == CapturePhase::Paused => named("Paused"),
        _ if live => format!("{} · {}", named("Recording"), clock(elapsed)),
        notice if closing => {
            let minutes = plural(
                ((i64::from(c.recorded_ms.0) + 30_000) / 60_000).max(1),
                "min",
                "min",
            );
            match notice {
                Some(CaptureNotice::StoppedAutomatically { .. }) => {
                    format!("Stopped · the call had ended · {minutes} saved")
                }
                // The summary estimate comes with the post-call summary (M2).
                _ => format!("Saved · {minutes}"),
            }
        }
        _ => "Noter — Not recording".into(),
    };
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-closing-idle
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-ended-closing
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-recording-closing
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-recording-engine
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-recording-ended
    let mut entries = vec![TrayEntry::Line(first)];
    if phase == CapturePhase::Failed {
        let call = c.title.as_deref().unwrap_or("This call");
        let saved = format!("{call} · saved up to {}", clock(c.recorded_ms.0.into()));
        entries.push(TrayEntry::Line(saved));
    } else if live {
        // No call languages are known in M1 (the engine detects them): speakers and privacy.
        let speakers = match i.speakers {
            0 => String::new(),
            n => format!("{} · ", plural(n as i64, "speaker", "speakers")),
        };
        let second = format!("{speakers}{}", privacy_text(i.privacy));
        entries.push(TrayEntry::Line(second));
    }
    // @cpt-end:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr2-first
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr2-degraded
    let degraded = i.degraded.iter().find_map(|d| match d {
        DegradedState::SwitchedToLocal { .. } => Some("Switched to local"),
        DegradedState::SystemAudioSilent { .. } => Some("System audio silent"),
        DegradedState::MicrophoneOff { .. } => Some("Microphone off"),
        _ => None,
    });
    if let Some(d) = degraded {
        entries.push(TrayEntry::Line(d.into()));
    }
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-recording-hidden
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-hidden-recording
    if i.hidden && live {
        entries.push(TrayEntry::Line("Hidden for presenting".into()));
    }
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-hidden-recording
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-recording-hidden
    // @cpt-end:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr2-degraded
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr2-detected
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-idle-detected
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-detected-recording
    // Never while a capture runs (D-1): the core refuses a second capture.
    if i.detected && idle {
        let start = "Call Detected · Start Recording";
        entries.push(entry(
            TrayAction::StartDetected,
            start,
            !i.start_blocked,
            None,
        ));
    }
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-detected-recording
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-idle-detected
    // @cpt-end:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr2-detected
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr2-setup
    if idle && i.degraded.contains(&DegradedState::SetupIncomplete) {
        let setup = "Setup incomplete · call detection off";
        entries.push(TrayEntry::Line(setup.into()));
        entries.push(entry(TrayAction::FinishSetup, "Finish Setup…", true, None));
    }
    // @cpt-end:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr2-setup
    entries.push(TrayEntry::Separator);

    // MB-R3
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr3
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-ended-recording
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-engine-recording
    // @cpt-begin:cpt-noter-state-ui-menu-bar-status-item:p1:inst-closing-recording
    let start_stop = || key(HotkeyAction::StartStop);
    if phase == CapturePhase::Failed {
        entries.push(entry(TrayAction::TryAgain, "Try Again", true, None));
        let stop = "Stop Recording";
        entries.push(entry(TrayAction::StopRecording, stop, true, start_stop()));
    } else if live {
        if ended {
            entries.push(entry(
                TrayAction::KeepRecording,
                "Keep Recording",
                true,
                None,
            ));
            entries.push(entry(TrayAction::StopNow, "Stop Now", true, None));
        }
        if new_meeting {
            entries.push(entry(
                TrayAction::StartAsNewCall,
                "Start as New Call",
                true,
                None,
            ));
            entries.push(entry(
                TrayAction::KeepInThisCall,
                "Keep in This Call",
                true,
                None,
            ));
        }
        let stop = "Stop Recording";
        entries.push(entry(TrayAction::StopRecording, stop, true, start_stop()));
        let pause = key(HotkeyAction::Pause);
        entries.push(match phase {
            CapturePhase::Paused => entry(TrayAction::Resume, "Resume", true, pause),
            _ => entry(
                TrayAction::Pause,
                "Pause",
                phase == CapturePhase::Recording,
                pause,
            ),
        });
    } else {
        if closing {
            let label = "Continue Recording";
            entries.push(entry(TrayAction::ContinueRecording, label, true, None));
        }
        // Dimmed only below 500 MB or without the speech model, never for the setup state.
        let enabled = idle && !i.start_blocked;
        let start = "Start Recording";
        entries.push(entry(
            TrayAction::StartRecording,
            start,
            enabled,
            start_stop(),
        ));
    }
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-closing-recording
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-engine-recording
    // @cpt-end:cpt-noter-state-ui-menu-bar-status-item:p1:inst-ended-recording
    // @cpt-end:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr3
    entries.push(TrayEntry::Separator);

    // MB-R4: the copilot's items wait for it (M4, behind its flag).
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr4
    if live {
        let recording = phase == CapturePhase::Recording;
        let mark = key(HotkeyAction::MarkMoment);
        entries.push(entry(
            TrayAction::MarkMoment,
            "Mark Moment",
            recording,
            mark,
        ));
        entries.push(TrayEntry::Separator);
    }
    // @cpt-end:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr4

    // MB-R5: Open Last Summary waits for the post-call summary (M2): absent until one exists.
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr5
    let open_call = key(HotkeyAction::OpenCallScreen);
    entries.push(entry(
        TrayAction::OpenCallScreen,
        "Open Call Screen",
        true,
        open_call,
    ));
    entries.push(TrayEntry::Item(TrayItem {
        action: TrayAction::UseFloatingPanel,
        label: "Use Floating Panel".into(),
        enabled: true,
        checked: Some(i.layout == CallLayoutPreference::Floating),
        key: None,
    }));
    let hide = key(HotkeyAction::HideForPresenting);
    entries.push(if i.hidden {
        entry(TrayAction::ShowAfterPresenting, "Show Noter", true, hide)
    } else {
        entry(
            TrayAction::HideForPresenting,
            "Hide for Presenting",
            true,
            hide,
        )
    });
    // @cpt-end:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr5
    entries.push(TrayEntry::Separator);

    // MB-R6 (**Next:**) is Today's in M2 (menu-bar.md, owner decision A). MB-R7:
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr6-7
    entries.push(entry(TrayAction::OpenNoter, "Open Noter", true, None));
    let settings = Some("Super+Comma".to_string());
    entries.push(entry(TrayAction::OpenSettings, "Settings…", true, settings));
    let quit = Some("Super+Q".to_string());
    entries.push(entry(TrayAction::QuitNoter, "Quit Noter", true, quit));
    // @cpt-end:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-mbr6-7

    // @cpt-begin:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-return-glyph
    // @cpt-begin:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-return-menu
    TrayModel {
        glyph,
        hidden: i.hidden,
        title,
        label,
        entries,
    }
    // @cpt-end:cpt-noter-algo-ui-menu-bar-build-menu:p1:inst-return-menu
    // @cpt-end:cpt-noter-algo-ui-menu-bar-glyph:p1:inst-return-glyph
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_792_137_600_000;

    /// One prototype `MB_STATES` entry: the capture and the rest of the inputs.
    struct State {
        capture: CaptureState,
        hidden: bool,
        title: MenuBarTitle,
        detected: bool,
        degraded: Vec<DegradedState>,
        hotkeys: Vec<HotkeyBinding>,
        start_blocked: bool,
        speakers: usize,
        elapsed_ms: i64,
    }

    fn idle() -> State {
        let hotkeys = crate::DEFAULT_HOTKEYS
            .iter()
            .map(|(action, chord)| HotkeyBinding {
                action: *action,
                shortcut: Some((*chord).into()),
                default_shortcut: Some((*chord).into()),
                status: HotkeyStatus::Registered,
            })
            .collect();
        State {
            capture: crate::app::fresh_snapshot("0").capture,
            hidden: false,
            title: MenuBarTitle::None,
            detected: false,
            degraded: vec![],
            hotkeys,
            start_blocked: false,
            speakers: 0,
            elapsed_ms: 0,
        }
    }

    fn recording() -> State {
        let mut s = idle();
        s.capture.phase = CapturePhase::Recording;
        s.capture.call_id = Some(CallId::new("call_x"));
        s.capture.title = Some("Planning: VHI 8.0 drawer redesign".into());
        s.elapsed_ms = (23 * 60 + 14) * 1000;
        s.speakers = 4;
        s
    }

    fn model(s: &State) -> TrayModel {
        tray_model(&TrayInputs {
            capture: &s.capture,
            hidden: s.hidden,
            privacy: PrivacyMode::CloudRedacted,
            title: s.title,
            layout: CallLayoutPreference::Floating,
            detected: s.detected,
            degraded: &s.degraded,
            hotkeys: &s.hotkeys,
            start_blocked: s.start_blocked,
            speakers: s.speakers,
            elapsed_ms: s.elapsed_ms,
            now: NOW,
        })
    }

    /// The menu as text: lines as they read, items as `[label key]`, dimmed `(label)`, `-`.
    fn menu(m: &TrayModel) -> Vec<String> {
        m.entries
            .iter()
            .map(|e| match e {
                TrayEntry::Line(l) => l.clone(),
                TrayEntry::Separator => "-".into(),
                TrayEntry::Item(i) => {
                    let check = match i.checked {
                        Some(true) => "✓ ",
                        _ => "",
                    };
                    let key = i
                        .key
                        .as_deref()
                        .map(|k| format!(" {k}"))
                        .unwrap_or_default();
                    if i.enabled {
                        format!("[{check}{}{key}]", i.label)
                    } else {
                        format!("({}{key})", i.label)
                    }
                }
            })
            .collect()
    }

    const SURFACES: [&str; 7] = [
        "[Open Call Screen Ctrl+Alt+Super+N]",
        "[✓ Use Floating Panel]",
        "[Hide for Presenting Ctrl+Alt+Super+0]",
        "-",
        "[Open Noter]",
        "[Settings… Super+Comma]",
        "[Quit Noter Super+Q]",
    ];

    fn with_surfaces(head: &[&str]) -> Vec<String> {
        head.iter()
            .chain(SURFACES.iter())
            .map(|s| s.to_string())
            .collect()
    }

    #[test]
    fn idle_reads_not_recording_with_start_and_its_key() {
        let m = model(&idle());
        assert_eq!(m.glyph, TrayGlyph::Idle);
        assert_eq!(m.label, "Noter, not recording");
        assert_eq!(m.title, None);
        let want = [
            "Noter — Not recording",
            "-",
            "[Start Recording Ctrl+Alt+Super+R]",
            "-",
        ];
        assert_eq!(menu(&m), with_surfaces(&want));
    }

    #[test]
    fn recording_shows_the_call_its_clock_speakers_privacy_and_hotkeys() {
        let m = model(&recording());
        assert_eq!(m.glyph, TrayGlyph::Recording);
        assert_eq!(m.label, "Noter, recording, 23 minutes");
        let want = [
            "Recording · Planning: VHI 8.0 drawer redesign · 23:14",
            "4 speakers · Cloud, redacted",
            "-",
            "[Stop Recording Ctrl+Alt+Super+R]",
            "[Pause Ctrl+Alt+Super+P]",
            "-",
            "[Mark Moment Ctrl+Alt+Super+M]",
            "-",
        ];
        assert_eq!(menu(&m), with_surfaces(&want));
    }

    #[test]
    fn the_elapsed_title_follows_the_setting_and_clears_while_hidden() {
        let mut s = recording();
        s.title = MenuBarTitle::ElapsedTime;
        assert_eq!(model(&s).title.as_deref(), Some("23:14"));
        s.elapsed_ms = 3_723_000;
        assert_eq!(model(&s).title.as_deref(), Some("1:02:03"));
        s.hidden = true;
        assert_eq!(model(&s).title, None);
        s.hidden = false;
        s.title = MenuBarTitle::NewestCard;
        assert_eq!(model(&s).title, None, "Newest Card is the copilot's (M4)");
    }

    #[test]
    fn paused_resumes_and_says_paused_for_5_min_after_the_reminder() {
        let mut s = recording();
        s.capture.phase = CapturePhase::Paused;
        s.capture.pause = Some(PauseInfo {
            since: TimestampMs(NOW - 60_000),
            remind_at: Some(TimestampMs(NOW + 1)),
        });
        let m = model(&s);
        assert_eq!(m.glyph, TrayGlyph::Paused);
        assert_eq!(m.label, "Noter, paused");
        assert_eq!(m.lines()[0], "Paused · Planning: VHI 8.0 drawer redesign");
        assert!(m.item(TrayAction::Resume).is_some_and(|i| i.enabled));
        assert!(m.item(TrayAction::Pause).is_none());
        assert!(m.item(TrayAction::MarkMoment).is_some_and(|i| !i.enabled));
        s.capture.pause.as_mut().unwrap().remind_at = Some(TimestampMs(NOW));
        assert_eq!(model(&s).lines()[0], "Paused for 5 min");
    }

    #[test]
    fn degraded_lines_show_under_the_call_and_while_idle() {
        let mut s = recording();
        s.degraded = vec![DegradedState::SwitchedToLocal {
            call_id: None,
            reason: noter_protocol::error::RuntimeUnavailableReason::Offline,
            retry_at: None,
        }];
        assert_eq!(model(&s).lines()[2], "Switched to local");
        let mut s = idle();
        s.degraded = vec![DegradedState::SwitchedToLocal {
            call_id: None,
            reason: noter_protocol::error::RuntimeUnavailableReason::Offline,
            retry_at: None,
        }];
        assert_eq!(model(&s).lines()[1], "Switched to local");
        let call_id = CallId::new("call_x");
        for (state, line) in [
            (
                DegradedState::SystemAudioSilent {
                    call_id: call_id.clone(),
                    since: TimestampMs(NOW),
                    confidence: 0.9,
                },
                "System audio silent",
            ),
            (DegradedState::MicrophoneOff { call_id }, "Microphone off"),
        ] {
            let mut s = recording();
            s.degraded = vec![state];
            assert_eq!(model(&s).lines()[2], line);
        }
    }

    #[test]
    fn setup_incomplete_adds_finish_setup_and_start_still_works() {
        let mut s = idle();
        s.degraded = vec![DegradedState::SetupIncomplete];
        let want = [
            "Noter — Not recording",
            "Setup incomplete · call detection off",
            "[Finish Setup…]",
            "-",
            "[Start Recording Ctrl+Alt+Super+R]",
            "-",
        ];
        assert_eq!(menu(&model(&s)), with_surfaces(&want));
    }

    #[test]
    fn a_missed_call_offers_call_detected_start_recording_never_while_recording() {
        let mut s = idle();
        s.detected = true;
        let m = model(&s);
        assert_eq!(menu(&m)[1], "[Call Detected · Start Recording]");
        s.hidden = true;
        assert!(model(&s).item(TrayAction::StartDetected).is_some());
        let mut s = recording();
        s.detected = true;
        s.hidden = true;
        assert!(model(&s).item(TrayAction::StartDetected).is_none(), "D-1");
    }

    #[test]
    fn start_is_dimmed_only_when_a_start_would_be_refused() {
        let mut s = idle();
        s.start_blocked = true;
        s.detected = true;
        s.degraded = vec![DegradedState::SetupIncomplete];
        let m = model(&s);
        assert!(m
            .item(TrayAction::StartRecording)
            .is_some_and(|i| !i.enabled));
        assert!(m
            .item(TrayAction::StartDetected)
            .is_some_and(|i| !i.enabled));
        assert!(m.item(TrayAction::FinishSetup).is_some_and(|i| i.enabled));
    }

    #[test]
    fn the_call_ended_notice_counts_down_and_offers_keep_or_stop() {
        let mut s = recording();
        s.capture.notice = Some(CaptureNotice::CallEnded {
            stops_at: Some(TimestampMs(NOW + 7_200)),
        });
        let m = model(&s);
        assert_eq!(m.lines()[0], "Call seems to have ended · stopping in 8 s");
        let r3: Vec<String> = menu(&m)[3..6].to_vec();
        assert_eq!(
            r3,
            [
                "[Keep Recording]",
                "[Stop Now]",
                "[Stop Recording Ctrl+Alt+Super+R]"
            ]
        );
        // Held by the pointer, or hidden for presenting: no countdown.
        s.capture.notice = Some(CaptureNotice::CallEnded { stops_at: None });
        assert_eq!(model(&s).lines()[0], "Call seems to have ended");
        s.hidden = true;
        s.capture.notice = Some(CaptureNotice::CallSeemsEnded {
            stops_at: TimestampMs(NOW + 600_000),
        });
        let m = model(&s);
        assert_eq!(m.lines()[0], "Call seems to have ended");
        assert!(m.item(TrayAction::KeepRecording).is_some());
    }

    #[test]
    fn hidden_for_presenting_badges_the_glyph_and_offers_show_noter() {
        let mut s = recording();
        s.hidden = true;
        let m = model(&s);
        assert!(m.hidden);
        assert_eq!(
            m.label,
            "Noter, recording, 23 minutes, hidden for presenting"
        );
        assert!(m.lines().contains(&"Hidden for presenting"));
        assert!(m.item(TrayAction::ShowAfterPresenting).is_some());
        assert!(m.item(TrayAction::HideForPresenting).is_none());
        let mut s = idle();
        s.hidden = true;
        let m = model(&s);
        assert_eq!(m.label, "Noter, not recording, hidden for presenting");
        assert!(!m.lines().contains(&"Hidden for presenting"));
    }

    #[test]
    fn a_new_meeting_while_hidden_asks_to_start_a_new_call_or_keep_it() {
        let mut s = recording();
        s.hidden = true;
        s.capture.notice = Some(CaptureNotice::NewMeeting {
            event: Some(CalendarEventRef {
                id: CalendarEventId::new("ev_1"),
                title: "1:1 with Anna K.".into(),
                starts_at: TimestampMs(NOW),
                ends_at: TimestampMs(NOW + 1_800_000),
            }),
            app_name: None,
            detected_at: TimestampMs(NOW),
            expires_at: TimestampMs(NOW + 60_000),
            default_choice: NewMeetingChoice::StartAsNewCall,
        });
        let m = model(&s);
        assert_eq!(
            m.lines()[0],
            "A new meeting may have started: 1:1 with Anna K."
        );
        assert!(m.item(TrayAction::StartAsNewCall).is_some());
        assert!(m.item(TrayAction::KeepInThisCall).is_some());
        // Visible, the call window asks: the menu reads as recording.
        s.hidden = false;
        let m = model(&s);
        assert!(m.lines()[0].starts_with("Recording · "));
        assert!(m.item(TrayAction::StartAsNewCall).is_none());
    }

    #[test]
    fn engine_stopped_offers_try_again_with_the_idle_glyph() {
        let mut s = recording();
        s.capture.phase = CapturePhase::Failed;
        s.capture.recorded_ms = DurationMs(31 * 60_000 + 40_000);
        let m = model(&s);
        assert_eq!(m.glyph, TrayGlyph::Idle);
        let want = [
            "Not recording · engine stopped",
            "Planning: VHI 8.0 drawer redesign · saved up to 31:40",
            "-",
            "[Try Again]",
            "[Stop Recording Ctrl+Alt+Super+R]",
            "-",
        ];
        assert_eq!(menu(&m), with_surfaces(&want));
    }

    #[test]
    fn after_a_stop_the_closing_line_and_continue_show_for_5_minutes() {
        let mut s = recording();
        s.capture.phase = CapturePhase::Stopped;
        s.capture.recorded_ms = DurationMs(48 * 60_000);
        s.capture.continue_until = Some(TimestampMs(NOW + 1));
        let want = [
            "Saved · 48 min",
            "-",
            "[Continue Recording]",
            "[Start Recording Ctrl+Alt+Super+R]",
            "-",
        ];
        assert_eq!(menu(&model(&s)), with_surfaces(&want));
        s.capture.notice = Some(CaptureNotice::StoppedAutomatically {
            call_id: CallId::new("call_x"),
        });
        assert_eq!(
            model(&s).lines()[0],
            "Stopped · the call had ended · 48 min saved"
        );
        s.capture.continue_until = Some(TimestampMs(NOW - 1));
        let m = model(&s);
        assert_eq!(m.lines()[0], "Noter — Not recording");
        assert!(m.item(TrayAction::ContinueRecording).is_none());
    }

    #[test]
    fn an_item_whose_hotkey_did_not_register_shows_no_key() {
        let mut s = recording();
        for b in &mut s.hotkeys {
            if b.action == HotkeyAction::OpenCallScreen {
                b.status = HotkeyStatus::Conflict { owner: None };
            }
            if b.action == HotkeyAction::Pause {
                b.shortcut = None;
                b.status = HotkeyStatus::NotSet;
            }
        }
        let m = model(&s);
        assert_eq!(m.item(TrayAction::OpenCallScreen).unwrap().key, None);
        assert_eq!(m.item(TrayAction::Pause).unwrap().key, None);
        let mark = m.item(TrayAction::MarkMoment).unwrap().key.clone();
        assert_eq!(mark.as_deref(), Some("Ctrl+Alt+Super+M"));
    }

    #[test]
    fn counts_are_plural_and_the_clock_pads() {
        let mut s = recording();
        s.speakers = 1;
        s.elapsed_ms = 61_000;
        let m = model(&s);
        assert_eq!(m.lines()[1], "1 speaker · Cloud, redacted");
        assert_eq!(m.label, "Noter, recording, 1 minute");
        assert!(m.lines()[0].ends_with(" · 01:01"));
        s.speakers = 0;
        s.capture.title = None;
        let m = model(&s);
        assert_eq!(m.lines()[..2], ["Recording · 01:01", "Cloud, redacted"]);
    }
}
