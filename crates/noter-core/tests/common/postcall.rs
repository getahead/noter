use noter_core::Core;
use serde_json::json;

#[path = "row.rs"]
mod row;

pub fn seed_live_call(core: &Core, id: &str, segments: i64, now: i64, speaker_name: Option<&str>) {
    let mut speaker = vec![
        ("id", json!(format!("{id}_spk"))),
        ("call_id", json!(id)),
        ("label", json!("spk_1")),
        ("n", json!(1)),
        ("channel", json!("sys")),
        ("pass", json!("live")),
    ];
    if let Some(name) = speaker_name {
        speaker.extend([
            ("name", json!(name)),
            ("named_by", json!("you")),
            ("person_id", json!("per_anna")),
        ]);
    }

    let mut rows = vec![
        row::row(
            "calls",
            &[
                ("id", json!(id)),
                ("rev", json!(1)),
                ("started_at", json!(now - 3_600_000)),
                ("ended_at", json!(now - 60_000)),
                ("title", json!("Planning")),
                ("call_type", json!("planning")),
                ("status", json!("processing")),
                ("mode_used", json!("cloud")),
            ],
        ),
        row::row("speakers", &speaker),
    ];
    for n in 0..segments {
        rows.push(row::row(
            "segments",
            &[
                ("id", json!(format!("{id}_seg_{n}"))),
                ("call_id", json!(id)),
                ("speaker_id", json!(format!("{id}_spk"))),
                ("channel", json!("sys")),
                ("t0_ms", json!(n * 10_000)),
                ("t1_ms", json!(n * 10_000 + 5_000)),
                ("text", json!(format!("We agree on step {n}."))),
                ("text_norm", json!(format!("we agree on step {n}."))),
                ("lang", json!("en")),
                ("pass", json!("live")),
            ],
        ));
    }
    core.store().insert_batch(rows).unwrap();
}
