//! LaTeX: building a document and reading what the build says. A build
//! mirrors the document's folder into the vault's cache (`snapshot`), runs an
//! engine in it without shell escape (`engines`, `proc`), and reads the log
//! and the PDF back (`collect`, `log`); `scheduler` and `service` decide who
//! builds when and tell the window; `synctex` and `sync` match source lines to
//! places in the PDF. Names that come out of a log or a SyncTeX file are
//! resolved inside the document's folder or dropped (`paths`). The parsers are
//! pure functions over text and bytes.

pub mod build;
mod cache;
pub mod collect;
pub mod commands;
pub mod engines;
pub mod files;
pub mod log;
mod mirror;
mod out_dirs;
pub mod paths;
pub mod pinned;
pub mod proc;
pub mod scheduler;
pub mod send;
pub mod service;
pub mod snapshot;
pub mod sync;
pub mod synctex;
mod synctex_read;
pub mod unpack;
pub mod vault_commands;

#[cfg(test)]
mod tests;
