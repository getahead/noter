//! The Q7 engine-kill drill on a Mac (`cpt-noter-dod-core-engine-capture-restart`; steps in
//! `.plans/backend/m1-week-one-runbook.md`): the real supervisor captures a call through the
//! real engine, kills the engine with SIGKILL `kills` times during it, stops, and prints every
//! gap the supervisor reported and `timeline.json` kept. It passes when the session came back
//! after every kill and each `engine_restart` gap is at most 2 s.
//!
//! `cargo run -p noter-engine-client --example kill_drill -- <noter-engine> [seconds=60] [kills=1]
//! [engine args…]`: with `--mic a.wav --sys b.wav` the engine replays a recorded call (file mode),
//! without them it captures live.

use std::process::{exit, Command};
use std::time::{Duration, Instant};

use noter_engine_client::{CaptureFact, Config, EngineClient, EngineSession, ProcessLauncher};
use noter_protocol::engine::{AsrBackend, StartSession};
use noter_protocol::model::GapReason;
use noter_protocol::CallId;

const GAP_BOUND_MS: u32 = 2000;

/// Waits up to 10 s for the session to reach `want`; how long it took.
async fn reach(client: &EngineClient<ProcessLauncher>, want: EngineSession) -> Option<Duration> {
    let since = Instant::now();
    while since.elapsed() < Duration::from_secs(10) {
        if client.session() == want {
            return Some(since.elapsed());
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    None
}

/// The engine is this process's only child: kill exactly it, never by name.
fn kill_engine() {
    let me = std::process::id().to_string();
    let out = Command::new("pgrep")
        .args(["-P", &me])
        .output()
        .expect("pgrep");
    for pid in String::from_utf8_lossy(&out.stdout).split_whitespace() {
        let _ = Command::new("kill").args(["-9", pid]).status();
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(engine) = args.first() else {
        eprintln!("usage: kill_drill <noter-engine> [seconds=60] [kills=1] [engine args…]");
        exit(2);
    };
    let seconds: u64 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(60);
    let kills: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1);
    let dir = std::env::temp_dir().join(format!("noter-drill-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("drill folder");
    let client = EngineClient::new(
        ProcessLauncher::new(engine)
            .args(args.iter().skip(3))
            .app_group(&dir),
        Config::default(),
    );
    let mut facts = client.capture_facts();
    let start = StartSession {
        call_id: CallId::new("drill"),
        session_dir: "audio/drill".into(),
        store_audio: true,
        mic_device_uid: None,
        exclude_bundle_ids: vec![],
        languages: vec![],
        backend: AsrBackend::WhisperTurbo,
        glossary: vec![],
        speaker_priors: vec![],
        enrolled_embeddings_path: None,
        resume_from_ms: None,
    };
    if let Err(e) = client.start_session(start).await {
        eprintln!("FAIL: start_session: {e:?}");
        exit(1);
    }
    let mut ok = reach(&client, EngineSession::Capturing).await.is_some();
    println!("capturing: {ok}  (folder {})", dir.display());
    let step = Duration::from_secs(seconds / (kills + 1));
    for i in 1..=kills {
        tokio::time::sleep(step).await;
        kill_engine();
        println!("kill {i}: engine killed");
        tokio::time::sleep(Duration::from_millis(50)).await;
        match reach(&client, EngineSession::Capturing).await {
            Some(t) => println!("kill {i}: capturing again after {} ms", t.as_millis() + 50),
            None => {
                println!("kill {i}: session is {:?}, not capturing", client.session());
                ok = false;
            }
        }
    }
    tokio::time::sleep(step).await;
    let stopped = client.stop_session().await.is_ok()
        && reach(&client, EngineSession::Stopped).await.is_some();
    println!("stopped: {stopped}");
    ok &= stopped;
    let mut restarts = 0;
    while let Ok(fact) = facts.try_recv() {
        if let CaptureFact::Gap(gap) = fact {
            let ms = gap.t1_ms.0.saturating_sub(gap.t0_ms.0);
            println!(
                "supervisor gap {:?}: {} → {} ms ({ms} ms)",
                gap.reason, gap.t0_ms.0, gap.t1_ms.0
            );
            if gap.reason == GapReason::EngineRestart {
                restarts += 1;
                ok &= ms <= GAP_BOUND_MS;
            }
        }
    }
    ok &= restarts == kills;
    let timeline = dir.join("audio/drill/timeline.json");
    println!(
        "timeline.json: {}",
        std::fs::read_to_string(&timeline).unwrap_or_else(|e| format!("unreadable ({e})"))
    );
    println!(
        "{}: {restarts} engine_restart gap(s) for {kills} kill(s), bound {GAP_BOUND_MS} ms",
        if ok { "PASS" } else { "FAIL" }
    );
    exit(if ok { 0 } else { 1 });
}
