// @cpt-dod:cpt-noter-dod-core-llm-gate-adapters:p1
//! Ollama on this Mac: `/api/chat` with the app-owned schema in `format`. Only a loopback host,
//! or a host `contracts/egress-hosts.json` lists for the local runtime, is ever reached; no
//! proxy, no redirect. The core keeps a session's context and resends it each call.

use noter_protocol::egress::PROVIDER_HOSTS;
use noter_protocol::error::RuntimeUnavailableReason;
use noter_protocol::{Effort, RuntimeChoice};
use reqwest::header::CONTENT_TYPE;
use reqwest::redirect::Policy;
use reqwest::Url;
use serde_json::{json, Value};
use std::sync::Mutex;

use super::{instructions, Invocation, Reply, RuntimeAdapter};
use crate::runtime::{lock, Availability, BoxFuture};

#[derive(Debug, Clone)]
pub struct OllamaConfig {
    /// Where Ollama listens, `http://127.0.0.1:11434` by default.
    pub url: String,
    /// The pulled models, preferred first; none means no local model is ready.
    pub models: Vec<String>,
}

pub(crate) struct Ollama {
    /// `None` when the configured URL is off this Mac: then nothing is ever sent.
    url: Option<Url>,
    models: Vec<String>,
    /// What `/api/tags` last answered: `None` before the first probe, `Some(None)` when Ollama
    /// did not answer, else the names of its pulled models.
    tags: Mutex<Option<Option<Vec<String>>>>,
    client: reqwest::Client,
}

impl Ollama {
    pub fn new(config: OllamaConfig) -> Self {
        let url = Url::parse(&config.url).ok().filter(on_this_mac);
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(Policy::none())
            .build()
            .expect("a client with rustls and no redirects always builds");
        Self {
            url,
            models: config.models,
            tags: Mutex::default(),
            client,
        }
    }
}

fn on_this_mac(url: &Url) -> bool {
    let listed = PROVIDER_HOSTS
        .iter()
        .find(|(runtime, _)| *runtime == "local")
        .map_or(&[][..], |(_, hosts)| *hosts);
    let host = url.host_str().unwrap_or_default();
    matches!(url.scheme(), "http" | "https")
        && (matches!(host, "localhost" | "127.0.0.1" | "[::1]") || listed.contains(&host))
}

impl RuntimeAdapter for Ollama {
    fn name(&self) -> &'static str {
        "ollama"
    }

    /// Until the first probe the configured models stand for what Ollama has pulled; after it,
    /// what `/api/tags` answered, the configured preference first.
    fn availability(&self, runtime: RuntimeChoice) -> Availability {
        let (models, path) = match lock(&self.tags).clone() {
            None => (self.models.clone(), None),
            Some(None) => (Vec::new(), None),
            Some(Some(tags)) => {
                let mut models: Vec<String> = (self.models.iter())
                    .filter(|m| tags.contains(m))
                    .cloned()
                    .collect();
                models.extend(tags.into_iter().filter(|t| !self.models.contains(t)));
                (
                    models,
                    self.url
                        .as_ref()
                        .map(|u| u.as_str().trim_end_matches('/').to_owned()),
                )
            }
        };
        let ready = self.url.is_some() && !models.is_empty();
        Availability {
            runtime,
            unavailable: (!ready).then_some(RuntimeUnavailableReason::LocalModelNotReady),
            version: None,
            path,
            tested: None,
            models,
        }
    }

    // @cpt-begin:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-clis
    fn probe(&self) -> BoxFuture<'_, ()> {
        Box::pin(async move {
            let url = self.url.as_ref().and_then(|u| u.join("api/tags").ok());
            let tags = match url {
                Some(url) => self.tags(url).await,
                None => None,
            };
            *lock(&self.tags) = Some(tags);
        })
    }
    // @cpt-end:cpt-noter-algo-core-credentials-privacy-availability:p1:inst-availability-clis

    fn invoke(&self, call: Invocation) -> BoxFuture<'static, Result<Reply, String>> {
        let Some(url) = self.url.as_ref().and_then(|u| u.join("api/chat").ok()) else {
            return Box::pin(async { Err("not_allowed".to_owned()) });
        };
        let body = json!({
            "model": call.model,
            "messages": [
                {"role": "system", "content": instructions(call.skill)},
                {"role": "user", "content": String::from_utf8_lossy(&call.packet)},
            ],
            "format": call.schema,
            "stream": false,
            "think": call.effort != Effort::Low,
        });
        let request = self
            .client
            .post(url)
            .header(CONTENT_TYPE, "application/json")
            .body(body.to_string());
        Box::pin(async move {
            let response = request
                .send()
                .await
                .map_err(|_| "local_unreachable".to_owned())?;
            if !response.status().is_success() {
                return Err(format!("http_{}", response.status().as_u16()));
            }
            let bytes = response
                .bytes()
                .await
                .map_err(|_| "local_unreachable".to_owned())?;
            let answer: Value =
                serde_json::from_slice(&bytes).map_err(|_| "local_output".to_owned())?;
            let content = answer["message"]["content"].as_str().unwrap_or_default();
            Ok(Reply {
                output: serde_json::from_str(content).unwrap_or(Value::Null),
                tokens_in: answer["prompt_eval_count"].as_u64().unwrap_or(0),
                tokens_out: answer["eval_count"].as_u64().unwrap_or(0),
                cost_usd: None,
                first_token_ms: None,
                session_id: None,
            })
        })
    }

    fn open_session(&self, _: RuntimeChoice, _: Option<&str>) -> Result<String, String> {
        Ok(format!("local_{}", ulid::Ulid::generate()))
    }

    fn close_session(&self, _: RuntimeChoice, _: &str) {}
}

impl Ollama {
    /// The models `/api/tags` lists, or `None` when Ollama does not answer.
    async fn tags(&self, url: Url) -> Option<Vec<String>> {
        let asked = async {
            let response = self.client.get(url).send().await.ok()?;
            response.error_for_status().ok()?.bytes().await.ok()
        };
        // Ollama on this Mac answers at once; a hung one is not running.
        let bytes = tokio::time::timeout(std::time::Duration::from_secs(2), asked)
            .await
            .ok()??;
        let body: Value = serde_json::from_slice(&bytes).ok()?;
        let models = body["models"].as_array()?;
        Some(
            models
                .iter()
                .filter_map(|m| m["name"].as_str().map(String::from))
                .collect(),
        )
    }
}
