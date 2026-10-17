//! View models: the records the core sends to the UI (DESIGN 3.1, DESIGN-core 3.1),
//! and the argument structs of the commands that act on them.
//!
//! Every record is view-ready: one list command returns one list for one view,
//! never one call per row (DESIGN 3.3). Records carry raw values (ids, epoch
//! milliseconds, enums); the UI formats and localises.

pub mod accounts;
pub mod agents;
pub mod app;
pub mod capture;
pub mod copilot;
pub mod handoff;
pub mod history;
pub mod items;
pub mod jobs;
pub mod knowledge;
pub mod library;
pub mod outputs;
pub mod people;
pub mod performance;
pub mod settings;
pub mod setup;
pub mod today;
pub mod transcript;
pub mod windows;

pub use accounts::*;
pub use agents::*;
pub use app::*;
pub use capture::*;
pub use copilot::*;
pub use handoff::*;
pub use history::*;
pub use items::*;
pub use jobs::*;
pub use knowledge::*;
pub use library::*;
pub use outputs::*;
pub use people::*;
pub use performance::*;
pub use settings::*;
pub use setup::*;
pub use today::*;
pub use transcript::*;
pub use windows::*;
