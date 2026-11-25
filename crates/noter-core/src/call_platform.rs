//! Display names for the audio processes that identify a call. Detection keeps the original bundle ID.
const APPS: &[(&str, &str)] = &[
    ("com.microsoft.teams2", "Microsoft Teams"),
    ("com.microsoft.teams", "Microsoft Teams"),
    ("com.tinyspeck.slackmacgap", "Slack"),
    ("us.zoom.xos", "Zoom"),
    ("com.apple.facetime", "FaceTime"),
    ("com.cisco.webexmeetingsapp", "Webex"),
    ("cisco-systems.spark", "Webex"),
    ("com.hnc.discord", "Discord"),
    ("com.google.chrome", "Google Chrome"),
    ("org.chromium.chromium", "Chromium"),
    ("com.apple.safari", "Safari"),
    ("com.microsoft.edgemac", "Microsoft Edge"),
    ("org.mozilla.firefox", "Firefox"),
    ("company.thebrowser.browser", "Arc"),
    ("com.brave.browser", "Brave"),
    ("com.operasoftware.opera", "Opera"),
    ("com.vivaldi.vivaldi", "Vivaldi"),
];

fn recognized(raw: &str) -> Option<&'static str> {
    let lower = raw.trim().to_ascii_lowercase();
    if matches!(lower.as_str(), "zoom.us" | "zoom workplace") {
        return Some("Zoom");
    }
    if matches!(lower.as_str(), "google meet" | "meet.google.com") {
        return Some("Google Meet");
    }
    APPS.iter().find_map(|&(bundle, label)| {
        let named = lower.strip_prefix(&label.to_ascii_lowercase());
        (lower == bundle
            || lower
                .strip_prefix(bundle)
                .is_some_and(|tail| tail.starts_with('.'))
            || named.is_some_and(|tail| {
                tail.is_empty() || tail.starts_with(" helper") || tail.starts_with(" modulehost")
            }))
        .then_some(label)
    })
}

// @cpt-algo:cpt-noter-algo-core-capture-session-detection:p1
pub(crate) fn display_name(bundle: &str, name: &str) -> String {
    if let Some(label) = recognized(name).or_else(|| recognized(bundle)) {
        return label.into();
    }
    let name = name.trim();
    let lower = name.to_ascii_lowercase();
    if name.is_empty()
        || name.contains('.')
        || lower.contains("helper")
        || lower.contains("modulehost")
    {
        "Other app".into()
    } else {
        name.into()
    }
}

#[cfg(test)]
mod tests {
    use super::display_name;

    #[test]
    fn cpt_noter_seq_record_prompt_start_recording_shows_friendly_platforms() {
        for (bundle, name, label) in [
            ("", "Microsoft Teams ModuleHost", "Microsoft Teams"),
            ("", "com.tinyspeck.slackmacgap.helper", "Slack"),
            ("us.zoom.xos", "ZoomOpener", "Zoom"),
            ("com.apple.FaceTime", "", "FaceTime"),
            ("com.google.Chrome.helper", "Google Meet", "Google Meet"),
            ("com.google.Chrome.helper", "", "Google Chrome"),
            ("", "org.unknown.helper", "Other app"),
            ("", "A meeting app", "A meeting app"),
        ] {
            assert_eq!(display_name(bundle, name), label);
        }
    }
}
