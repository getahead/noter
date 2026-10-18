// @cpt-component:cpt-noter-component-core-privacy:p1
//! # noter-llm — the egress gate
//!
//! The only crate allowed to reach the network (`just arch`, decision C12). In M0 it holds
//! what model downloads need: the allow-list check over `noter_protocol::egress`
//! (`ALLOW_WITHOUT_AUDIT`, group `model_downloads`) and an HTTP range fetcher that never leaves it,
//! not even through a redirect. The LLM runtimes and the audited provider path join it in M2.
//! The caller (noter-core's download task) verifies each bundle's sha256.

use std::time::Duration;

use noter_protocol::egress::ALLOW_WITHOUT_AUDIT;
use reqwest::header::{CONTENT_RANGE, RANGE};
use reqwest::redirect::Policy;
use reqwest::{StatusCode, Url};

#[cfg(test)]
mod fetch_tests;

fn model_hosts() -> &'static [&'static str] {
    ALLOW_WITHOUT_AUDIT
        .iter()
        .find(|g| g.name == "model_downloads")
        .expect("noter_protocol::egress names a model_downloads group")
        .hosts
}

/// An https URL, without credentials, on a host the allow-list names for model downloads.
pub fn allowed_download_url(url: &str) -> bool {
    Url::parse(url).is_ok_and(|u| allowed(&u))
}

fn allowed(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|h| model_hosts().contains(&h))
}

/// One file of a pinned model bundle: a bundle is the set of its files at a pinned Hugging
/// Face commit, each verified by its sha256 (the file's LFS oid).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PinnedFile {
    pub bundle: &'static str,
    pub url: &'static str,
    pub size_bytes: u64,
    pub sha256: &'static str,
    pub required_for_capture: bool,
}

/// The pinned model files, compiled in. shortcut: empty until the generator under
/// scripts/models/ writes the entries from the Hugging Face API (decision D11, option A);
/// never hand-written.
pub const MANIFEST: &[PinnedFile] = &[];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FetchError {
    /// No connection, or it timed out.
    Offline,
    /// The URL, or a redirect, leaves the allow-list; nothing was sent there.
    NotAllowed,
    /// The server answered with this status.
    Http(u16),
    Io(String),
}

/// Downloads a URL from a byte offset, chunk by chunk.
pub struct RangeFetcher {
    client: reqwest::Client,
    allow: fn(&Url) -> bool,
}

impl Default for RangeFetcher {
    fn default() -> Self {
        Self::new()
    }
}

impl RangeFetcher {
    /// The real fetcher: the model-download allow-list, for the URL and every redirect.
    pub fn new() -> Self {
        Self::with_allow(allowed, Duration::from_secs(30))
    }

    #[cfg(test)]
    pub(crate) fn for_local_tests() -> Self {
        Self::with_allow(
            |u| u.host_str() == Some("127.0.0.1"),
            Duration::from_millis(500),
        )
    }

    /// `stall`: how long a connection may send nothing before the fetch ends offline.
    fn with_allow(allow: fn(&Url) -> bool, stall: Duration) -> Self {
        let policy = Policy::custom(move |attempt| {
            if attempt.previous().len() >= 10 {
                attempt.error("too many redirects")
            } else if allow(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("redirect off the model-download allow-list")
            }
        });
        // No proxy: a system proxy would be a host off the allow-list (the network-monitor gate).
        let client = reqwest::Client::builder()
            .redirect(policy)
            .no_proxy()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(stall)
            .build()
            .expect("a client with rustls and a redirect policy always builds");
        Self { client, allow }
    }

    /// Streams `url` from `from_byte` into `chunk`, which returns false to stop. A server that
    /// ignores the range, or answers from an earlier byte, is handled by skipping the bytes
    /// already held; 416 means the file is already complete. A connection that stalls ends
    /// offline.
    pub async fn fetch(
        &self,
        url: &str,
        from_byte: u64,
        chunk: &mut (dyn FnMut(&[u8]) -> bool + Send),
    ) -> Result<(), FetchError> {
        let url = Url::parse(url).map_err(|_| FetchError::NotAllowed)?;
        if !(self.allow)(&url) {
            return Err(FetchError::NotAllowed);
        }
        let mut request = self.client.get(url);
        if from_byte > 0 {
            request = request.header(RANGE, format!("bytes={from_byte}-"));
        }
        let mut response = request.send().await.map_err(transport)?;
        let status = response.status();
        if status == StatusCode::RANGE_NOT_SATISFIABLE && from_byte > 0 {
            return Ok(());
        }
        if !status.is_success() {
            return Err(FetchError::Http(status.as_u16()));
        }
        let start = if status == StatusCode::PARTIAL_CONTENT {
            range_start(&response)
        } else {
            Some(0)
        };
        let mut skip = match start {
            Some(start) if start <= from_byte => from_byte - start,
            _ => {
                return Err(FetchError::Io(format!(
                    "206 does not cover byte {from_byte}"
                )))
            }
        };
        while let Some(bytes) = response.chunk().await.map_err(transport)? {
            let held = usize::try_from(skip).unwrap_or(usize::MAX).min(bytes.len());
            skip -= held as u64;
            let rest = &bytes[held..];
            if !rest.is_empty() && !chunk(rest) {
                return Ok(());
            }
        }
        Ok(())
    }
}

/// The first byte of a 206, from `Content-Range: bytes START-END/TOTAL`.
fn range_start(response: &reqwest::Response) -> Option<u64> {
    let value = response.headers().get(CONTENT_RANGE)?.to_str().ok()?;
    value
        .strip_prefix("bytes ")?
        .split('-')
        .next()?
        .parse()
        .ok()
}

fn transport(e: reqwest::Error) -> FetchError {
    if e.is_redirect() {
        FetchError::NotAllowed
    } else if e.is_connect() || e.is_timeout() {
        FetchError::Offline
    } else {
        FetchError::Io(e.to_string())
    }
}
