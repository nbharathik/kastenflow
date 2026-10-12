//! Operations: every change to a deck is one of these. Each is defined once,
//! with a typed input and output, and the registry below turns them into the
//! WebAssembly calls, the `slides` subcommands, the MCP tools, the JSON Schema
//! and the TypeScript types. The engine applies an operation, remembers what
//! it changed so it can be undone, and reports what changed for the UI.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;

use crate::citations::Refs;
use crate::error::{Error, Result};
use crate::ids::IdGen;
use crate::model::Deck;

mod changes;
mod citations;
mod collapse;
mod composites;
mod create;
mod diagram;
mod elements;
mod engine;
pub(crate) mod geometry;
mod groups;
mod incoming;
mod layout;
mod layouts;
mod marks;
mod page;
mod pages;
mod paragraphs;
mod present;
mod replace;
mod sections;
mod slides;
mod steps;
mod templates;
mod text;
mod theme;
mod util;

#[cfg(test)]
mod tests;

pub use changes::{Changes, Meta, Scope, Snapshot};
pub use collapse::similar_runs;
pub use create::NewDeck;
pub use engine::{Applied, Engine};
pub use steps::{MOST_STEPS, order_of, reading_order, steps_in_use, steps_required};
pub use templates::template_of;

/// What an operation may touch. Its `run` gets the deck and a source of ids.
pub struct Cx<'a> {
    pub deck: &'a mut Deck,
    pub ids: &'a mut IdGen,
    /// The bibliography the host gave the engine, for what is drawn from it.
    pub refs: Option<&'a Refs>,
}

/// One kind of change to a deck.
pub trait Op: DeserializeOwned + JsonSchema {
    type Output: Serialize + JsonSchema;
    /// The name it is called by: in `slides op`, over MCP, in the editor.
    const NAME: &'static str;
    /// One paragraph telling an agent what it does and when to use it.
    const ABOUT: &'static str;
    /// The slides, order, theme or details it may change or create, so the
    /// engine can put them back on undo. Slides the run creates need only
    /// `order`; slides it deletes or edits must be named.
    fn scope(&self, deck: &Deck) -> Scope;
    fn run(self, cx: &mut Cx) -> Result<Self::Output>;
}

/// What a caller needs to offer an operation: its name, purpose and schemas.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpSpec {
    pub name: String,
    pub about: String,
    pub input: Value,
    pub output: Value,
}

impl OpSpec {
    fn of<T: Op>() -> OpSpec {
        OpSpec {
            name: T::NAME.to_owned(),
            about: T::ABOUT.to_owned(),
            input: schema_of::<T>(),
            output: schema_of::<T::Output>(),
        }
    }
}

/// The last segment of a type's path: `AddSlide` for `slides_core::ops::slides::AddSlide`.
fn short_name<T>() -> &'static str {
    let name = std::any::type_name::<T>();
    name.rsplit("::").next().unwrap_or(name)
}

fn schema_of<T: JsonSchema>() -> Value {
    serde_json::to_value(schemars::schema_for!(T)).unwrap_or(Value::Null)
}

/// Lists the operations, and runs one by name.
macro_rules! registry {
    ($($op:ty),+ $(,)?) => {
        /// Every operation, in the order an agent should read them.
        pub fn specs() -> Vec<OpSpec> {
            vec![$(OpSpec::of::<$op>()),+]
        }

        /// The names of the operations.
        pub fn names() -> Vec<&'static str> {
            vec![$(<$op as Op>::NAME),+]
        }

        /// Each operation's name with the names of its input and output types,
        /// for generating the TypeScript that ties them together.
        pub fn type_names() -> Vec<(&'static str, &'static str, &'static str)> {
            vec![$((<$op as Op>::NAME, short_name::<$op>(), short_name::<<$op as Op>::Output>())),+]
        }

        impl Engine {
            fn dispatch(&mut self, name: &str, input: Value) -> Result<(Value, Snapshot)> {
                $(
                    if name == <$op as Op>::NAME {
                        return self.run_one::<$op>(input);
                    }
                )+
                Err(Error::UnknownOp { name: name.to_owned() })
            }
        }
    };
}

use citations::AddCitation;
use collapse::CollapseSlides;
use composites::ExpandComposite;
use diagram::AddDiagram;
use elements::*;
use groups::*;
use incoming::{AddSlides, ReplaceDeck};
use layout::*;
use layouts::{
    AddLayout, DeleteLayout, EditLayout, ImportLayouts, MoveLayout, ResetSlides, SaveLayout,
    SetLayoutDesign,
};
use marks::AcceptMarks;
use page::SetPageSize;
use pages::{AddPageContents, AddPageSlides, UpdatePageContents};
use paragraphs::FormatParagraphs;
use present::SetPresent;
use replace::*;
use sections::{AddSection, RemoveSection, RenameSection};
use slides::*;
use steps::{BuildSteps, SetSlideSteps, SetStepStates};
use templates::ApplyTemplate;
use text::*;
use theme::*;

registry![
    SetTitle,
    ApplyTheme,
    EditTheme,
    SetLogo,
    SetPresent,
    SetPageSize,
    AddSlide,
    AddSlides,
    ReplaceDeck,
    DuplicateSlides,
    DeleteSlides,
    MoveSlides,
    AddSection,
    RenameSection,
    RemoveSection,
    SetSlideFlags,
    SetTransition,
    SetSlideSteps,
    SetStepStates,
    BuildSteps,
    CollapseSlides,
    SetLayout,
    AddLayout,
    SaveLayout,
    EditLayout,
    SetLayoutDesign,
    DeleteLayout,
    MoveLayout,
    ImportLayouts,
    ResetSlides,
    ApplyTemplate,
    SetNotes,
    SetBackground,
    AddElements,
    AddDiagram,
    AddCitation,
    AddPageContents,
    UpdatePageContents,
    AddPageSlides,
    PatchElements,
    TransformElements,
    DeleteElements,
    ReorderElements,
    GroupElements,
    UngroupElement,
    ExpandComposite,
    DuplicateElements,
    PasteElements,
    AlignElements,
    DistributeElements,
    SetText,
    SetRichText,
    FormatParagraphs,
    ReplaceAll,
    AcceptMarks,
];

/// Writes `Output` types as TypeScript with the input types. (ts-rs needs one
/// derive per type; the operation modules use this for each.)
macro_rules! op_types {
    ($($item:item)*) => {
        $(
            #[derive(Clone, Debug, PartialEq, Serialize, Deserialize, JsonSchema, TS)]
            #[serde(rename_all = "camelCase")]
            #[ts(export)]
            $item
        )*
    };
}
pub(crate) use op_types;
