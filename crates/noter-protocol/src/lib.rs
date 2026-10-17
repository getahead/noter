// @cpt-component:cpt-noter-component-core-protocol:p1
//! # noter-protocol — the Noter contracts
//!
//! This crate is the single source of truth for every boundary inside Noter
//! (`docs/DESIGN-core.md`, ADR-0001):
//!
//! * [`ipc`] — the UI ↔ core contract: Tauri commands, events and Channels.
//!   TypeScript bindings are generated from it (`cargo run -p noter-protocol
//!   --bin noter-contract-export`) into `apps/desktop/src/core/bindings.ts`.
//! * [`engine`] — the core ↔ Swift engine JSON Lines protocol over stdio.
//! * [`mcp`] — the tools noter-mcp exposes to Claude Code and Codex, and the
//!   request/response messages noter-mcp exchanges with the core over its socket.
//! * [`skills`] — the JSON output schemas that every LLM skill must satisfy.
//!
//! The crate holds types and declarations only. It has no I/O, no Tauri
//! dependency and no business logic, so the UI team, the core team and the
//! engine team can all build against it from day one.

pub mod common;
pub mod engine;
pub mod error;
pub mod fixtures;
pub mod ipc;
pub mod mcp;
pub mod model;
pub mod skills;

pub use common::*;
pub use error::{CoreError, ErrorCode, ErrorDetail};

/// Version of the UI ↔ core contract. Bumped on every change to a frozen
/// command, event or Channel (see DESIGN-core 4.1, Contract governance).
/// `major.minor`: minor = additive, major = breaking a frozen surface.
/// 2.0 applies the 17 Oct 2026 design review (`docs/REVIEW-2026-10-17-design-core.md`).
pub const CONTRACT_VERSION: &str = "2.0";
