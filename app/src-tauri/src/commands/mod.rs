//! Tauri commands. Each maps one-to-one to a kasten-core op, so the frontend
//! never touches the filesystem.

pub mod agents;
pub mod assets;
pub mod boards;
pub mod decks;
pub mod diagrams;
pub mod folders;
pub mod graph;
pub mod imports;
pub mod info;
pub mod marks;
pub mod meta;
pub mod notes;
pub mod replace;
pub mod sources;
pub mod vault;
pub mod vaults;
