//! The deck format as Rust types. They serialize to the `.deck` JSON and,
//! through `ts-rs` and `schemars`, are the one source of the TypeScript types
//! and the JSON Schema. Every struct keeps the fields it does not know in
//! `extra`, so a file written by a newer build survives an older one.

use serde_json::{Map, Value};

/// Fields of a JSON object that a type does not model.
pub type Extra = Map<String, Value>;

/// Derives what every model type needs and exports its TypeScript type when
/// the tests run.
macro_rules! model {
    ($($item:item)*) => {
        $(
            #[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
            #[ts(export)]
            $item
        )*
    };
}

pub(crate) fn is_false(b: &bool) -> bool {
    !*b
}

pub(crate) fn is_zero(n: &u32) -> bool {
    *n == 0
}

mod audio;
mod chart;
mod composite;
mod deck;
mod element;
mod element_access;
#[cfg(test)]
mod extras;
mod fit;
mod footer;
mod generator;
mod gradient;
mod guides;
mod motion;
mod number_format;
mod picture;
mod review;
mod source;
mod steps;
mod style;
mod table;
mod table_style;
mod text;
mod theme;

pub use audio::*;
pub use chart::*;
pub use composite::*;
pub use deck::*;
pub use element::*;
pub use footer::*;
pub use generator::*;
pub use gradient::*;
pub use guides::*;
pub use motion::*;
pub use number_format::NumberFormat;
pub use picture::*;
pub use review::*;
pub use source::*;
pub use steps::*;
pub use style::*;
pub use table::*;
pub use table_style::*;
pub use text::*;
pub use theme::*;
