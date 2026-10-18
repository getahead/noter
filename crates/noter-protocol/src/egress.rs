//! Every host Noter's processes may reach, the source of `contracts/egress-hosts.json`
//! (`just contract-regen`). The network-monitor release gate and the egress gate in noter-llm
//! read that file; a new destination is added here, in the pull request that adds the code.

pub const COMMENT: &str = "Generated from crates/noter-protocol/src/egress.rs (just contract-regen). Every host Noter's processes may reach (docs/REVIEW-2026-10-17-design-core.md, R2 and R46). The network-monitor release gate checks recorded proxy lines against this file: a line to a provider_hosts host must match an audit_log run row by time window and run id header; a line to an allow_without_audit host needs no row; any other host fails the gate. Change it in the same pull request as the code that adds a destination.";

pub const VERSION: u32 = 1;

pub const PROVIDER_HOSTS_COMMENT: &str = "Where an LLM run's own HTTPS requests may go, per runtime. Each run has an audit_log row (kind run) and, for cloud runs, one row per noter-mcp tool result (kind tool_result). CLI runs are locked down (strict MCP config, no WebFetch, WebSearch or Bash, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1; Codex with an isolated CODEX_HOME), so no other host is expected from them.";

/// Per LLM runtime, the hosts its runs reach.
pub const PROVIDER_HOSTS: &[(&str, &[&str])] = &[
    ("claude_api_key", &["api.anthropic.com"]),
    ("claude_account", &["api.anthropic.com"]),
    ("codex_api_key", &["api.openai.com"]),
    ("chatgpt_account", &["chatgpt.com", "api.openai.com"]),
    ("local", &[]),
];

pub const ALLOW_WITHOUT_AUDIT_COMMENT: &str =
    "Destinations that never carry call content and therefore have no audit_log row.";

/// A purpose whose requests carry no call content.
pub struct HostGroup {
    pub name: &'static str,
    pub hosts: &'static [&'static str],
    pub note: &'static str,
}

pub const ALLOW_WITHOUT_AUDIT: &[HostGroup] = &[
    HostGroup {
        name: "update_feed",
        hosts: &["github.com", "objects.githubusercontent.com"],
        note: "Signed update manifest and bundles (Tauri updater). Replace with the release host once it is chosen.",
    },
    HostGroup {
        name: "model_downloads",
        hosts: &[
            "huggingface.co",
            "cdn-lfs.huggingface.co",
            "cdn-lfs.hf.co",
            "cas-bridge.xethub.hf.co",
            "us.aws.cdn.hf.co",
            "registry.ollama.ai",
        ],
        note: "WhisperKit, FluidAudio and bge-m3 bundles (checksummed), and local models pulled through Ollama.",
    },
    HostGroup {
        name: "cli_install",
        hosts: &[
            "claude.ai",
            "storage.googleapis.com",
            "registry.npmjs.org",
            "github.com",
            "objects.githubusercontent.com",
            "ollama.com",
        ],
        note: "Installing Claude Code, Codex and Ollama when the user asks (cli_install).",
    },
    HostGroup {
        name: "sign_in",
        hosts: &["claude.ai", "console.anthropic.com", "auth.openai.com", "chatgpt.com"],
        note: "OAuth and sign-in pages the CLI opens in the browser, and their token exchange.",
    },
];

pub const USER_CONFIGURED_COMMENT: &str = "Hosts that depend on the user's own setup, so they cannot be listed here. Each request has an audit_log row; the gate reads the hosts from the test profile.";

/// Destinations the user sets up, described rather than listed.
pub const USER_CONFIGURED: &[(&str, &str)] = &[
    ("evidence_trackers", "The Jira, Bitbucket and GitHub sites acli, bkt and gh are signed in to (audit what = evidence_lookup)."),
    ("live_mcp_sources", "The user's own MCP servers a CLI may query live; off unless the privacy mode is cloud_allowed (D1), one row per lookup (audit what = live_mcp_query)."),
];
