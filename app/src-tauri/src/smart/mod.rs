//! Smart pages in the app: a page with `layout: smart` shows a web page of
//! its own, kept in a folder beside it, inside a sandboxed frame. The frame
//! loads from the `smart` scheme (`protocol`), which serves that one page's
//! folder and the shared kit and nothing else, and talks to the window only
//! through messages (`bridge`, with the host side in the window's code). The
//! frame can call no command, load nothing from the network and cannot take
//! the window anywhere (`guard`). Reads and writes it asks for run here as
//! the agent `smart:<page path>`, so the project's agent mode applies to
//! them as it does to any agent (`writes`).

pub mod author;
pub mod bridge;
pub mod commands;
pub mod errors;
pub mod guard;
mod kit;
mod page;
pub mod protocol;
mod reads;
mod runtime;
mod settings;
mod starters;
mod trust;
mod writes;

#[cfg(test)]
mod tests;

pub use runtime::Runtime;
