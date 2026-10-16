//! The deck tools of Kasten Slides, served from the vault. The tools are
//! slides-core's (`slides_core::agent`): the same list, descriptions, schemas
//! and code as `slides mcp`. This folder gives them what a vault needs: a
//! store that reads decks through kasten-core and turns every write into an
//! agent op in the connection's session, so the refusals, the review queue,
//! trust and undo work as they do for notes (`store`); their descriptions in a
//! vault's words (`adapt`); the text an agent is told about decks
//! (`instructions`); drawing slides, where the program can (`render`, behind
//! the `gate` that draws one picture at a time); and the routes of the MCP
//! server (`routes`), which the in-app chat reaches through `tools::call`.

mod adapt;
pub mod cite_rename;
pub mod context;
mod from_note;
#[cfg(feature = "render")]
mod gate;
mod instructions;
mod marks;
mod pptx;
pub mod render;
mod routes;
mod run;
mod store;
mod store_files;
mod store_stage;
pub mod words;

pub(crate) use adapt::is_tool;
pub(crate) use instructions::instructions;
pub(crate) use run::call_in;
