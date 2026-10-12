//! Kasten Slides' core: the deck format, the operations that change a deck,
//! lint, and PPTX import and export. It knows nothing about Kasten; a host
//! (Kasten, or the `slides` command) supplies files and images.

#[macro_use]
pub mod model;

pub mod agent;
pub mod canonical;
pub mod citations;
pub mod composites;
pub mod design;
pub mod error;
pub mod ids;
pub mod lint;
pub mod list;
pub mod markdown;
pub mod marks;
pub mod ops;
pub mod outline;
pub mod page;
pub mod resize;
pub mod resolve;
pub mod text_fit;
pub mod themes;
pub mod units;

pub use canonical::{FORMAT_VERSION, parse, write};
pub use error::{Error, Result};
pub use model::*;
pub use ops::{Applied, Changes, Engine, NewDeck, OpSpec, Scope, Snapshot};
