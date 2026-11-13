//! Permission requests run in the host process, so the engine's bundle metadata is insufficient.
use std::path::Path;
use std::process::Command;

fn plist_value(path: &Path, key: &str) -> String {
    let output = Command::new("/usr/bin/plutil")
        .args(["-extract", key, "raw", "-o", "-"])
        .arg(path)
        .output()
        .expect("read the host's property list with plutil");
    assert!(output.status.success(), "{}: missing {key}", path.display());
    String::from_utf8(output.stdout)
        .expect("UTF-8 property-list value")
        .trim()
        .to_owned()
}

// @cpt-dod:cpt-noter-dod-core-first-run-permissions:p1
#[test]
fn host_bundle_declares_microphone_and_calendar_access() {
    let host = Path::new(env!("CARGO_MANIFEST_DIR"));
    for key in [
        "NSMicrophoneUsageDescription",
        "NSCalendarsFullAccessUsageDescription",
    ] {
        assert!(
            !plist_value(&host.join("Info.plist"), key).is_empty(),
            "{key} explains the request"
        );
    }
    for key in [
        "com.apple.security.device.audio-input",
        "com.apple.security.personal-information.calendars",
    ] {
        // Escape dots: plutil's key path syntax otherwise treats them as nested dictionaries.
        assert_eq!(
            plist_value(&host.join("Noter.entitlements"), &key.replace('.', "\\.")),
            "true",
            "{key}"
        );
    }
}
