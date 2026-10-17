//! View models: the records the core sends to the UI (DESIGN 3.1, DESIGN-core 3.1),
//! and the argument structs of the commands that act on them.
//!
//! Every record is view-ready: one list command returns one list for one view,
//! never one call per row (DESIGN 3.3). Records carry raw values (ids, epoch
//! milliseconds, enums); the UI formats and localises.

pub mod app;
pub mod capture;
pub mod transcript;
pub mod copilot;
pub mod items;
pub mod today;
pub mod outputs;
pub mod handoff;
pub mod library;
pub mod history;
pub mod people;
pub mod agents;
pub mod accounts;
pub mod settings;
pub mod knowledge;
pub mod jobs;
pub mod performance;
pub mod setup;
pub mod windows;

pub use app::*;
pub use capture::*;
pub use transcript::*;
pub use copilot::*;
pub use items::*;
pub use today::*;
pub use outputs::*;
pub use handoff::*;
pub use library::*;
pub use history::*;
pub use people::*;
pub use agents::*;
pub use accounts::*;
pub use settings::*;
pub use knowledge::*;
pub use jobs::*;
pub use performance::*;
pub use setup::*;
pub use windows::*;
