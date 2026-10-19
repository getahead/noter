//! The app's model source (`PinnedModels`): the pinned manifest of scripts/models/ grouped into
//! bundles (decision D12), each file fetched through noter-llm's `RangeFetcher` (D11), here
//! against a local server that honours `Range`.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;

use noter_core::{allowed_download_url, BundleFile, FetchError, ModelSource, PinnedModels};
use noter_llm::{PinnedFile, RangeFetcher};

/// Serves `body` at any path, from the `Range` start when one is asked.
fn server(body: &'static [u8]) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut from = 0usize;
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap() > 0 && line != "\r\n" {
                if let Some(v) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                    from = v.trim().trim_end_matches('-').parse().unwrap();
                }
                line.clear();
            }
            let (status, range) = if from > 0 {
                let r = format!(
                    "Content-Range: bytes {from}-{}/{}\r\n",
                    body.len() - 1,
                    body.len()
                );
                ("206 Partial Content", r)
            } else {
                ("200 OK", String::new())
            };
            let head = format!(
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{range}\r\n",
                body.len() - from
            );
            let mut out = stream;
            let _ = out.write_all(head.as_bytes());
            let _ = out.write_all(&body[from..]);
        }
    });
    port
}

fn local(url: String) -> PinnedModels {
    PinnedModels::with(
        vec![PinnedFile {
            bundle: "whisper-turbo".into(),
            path: "model.bin".into(),
            url,
            size_bytes: 0,
            sha256: String::new(),
            required_for_capture: true,
        }],
        RangeFetcher::for_local_tests(),
    )
}

async fn fetch(models: &PinnedModels, from: u64) -> (Result<(), FetchError>, Vec<u8>) {
    let file: BundleFile = models.manifest()[0].files[0].clone();
    let mut got = Vec::new();
    let result = models
        .fetch(
            &file,
            from,
            Box::new(|bytes: &[u8]| {
                got.extend_from_slice(bytes);
                true
            }),
        )
        .await;
    (result, got)
}

#[test]
fn the_pinned_manifest_groups_its_files_into_bundles_on_the_allow_list() {
    let pinned = noter_llm::manifest();
    assert!(
        !pinned.is_empty(),
        "scripts/models/manifest.json pins the capture model"
    );
    let bundles = PinnedModels::new().manifest();
    assert_eq!(
        bundles.iter().map(|b| b.files.len()).sum::<usize>(),
        pinned.len(),
        "every pinned file is in a bundle"
    );
    let whisper = bundles.iter().find(|b| b.name == "whisper-turbo").unwrap();
    assert!(whisper.required_for_capture);
    for f in bundles.iter().flat_map(|b| &b.files) {
        assert!(allowed_download_url(&f.url), "{}", f.url);
        assert!(f.size_bytes > 0 && f.sha256.len() == 64, "{}", f.url);
        assert!(!f.path.is_empty() && !f.path.starts_with('/'), "{}", f.path);
    }
    let mut names: Vec<_> = bundles.iter().map(|b| b.name.clone()).collect();
    names.dedup();
    assert_eq!(names.len(), bundles.len(), "one bundle per name");
}

#[tokio::test]
async fn a_file_is_fetched_whole_and_resumed_from_a_byte() {
    static BODY: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let port = server(BODY);
    let models = local(format!("http://127.0.0.1:{port}/model.bin"));
    let (whole, got) = fetch(&models, 0).await;
    assert_eq!(whole, Ok(()));
    assert_eq!(got, BODY);
    let (rest, got) = fetch(&models, 10).await;
    assert_eq!(rest, Ok(()));
    assert_eq!(got, &BODY[10..]);
}

#[tokio::test]
async fn no_server_is_offline_and_a_host_off_the_list_is_refused_without_a_request() {
    let closed = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let (offline, _) = fetch(&local(format!("http://127.0.0.1:{closed}/m")), 0).await;
    assert_eq!(offline, Err(FetchError::Offline));
    // The real fetcher: an unlisted host never gets a request (the core then fails the bundle).
    let off_list = PinnedModels::with(
        vec![PinnedFile {
            bundle: "odd".into(),
            path: "m.bin".into(),
            url: "https://models.example.com/m.bin".into(),
            size_bytes: 1,
            sha256: String::new(),
            required_for_capture: false,
        }],
        RangeFetcher::new(),
    );
    let (refused, got) = fetch(&off_list, 0).await;
    assert!(matches!(refused, Err(FetchError::Io(_))), "{refused:?}");
    assert!(got.is_empty());
}
