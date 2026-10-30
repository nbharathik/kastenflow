//! Tauri commands. Each maps one-to-one to a kasten-core op, so the frontend
//! never touches the filesystem.

pub mod agent_modes;
pub mod agents;
pub mod annotations;
pub mod assets;
pub mod batch;
pub mod boards;
pub mod bundles;
pub mod collections;
pub mod decks;
pub mod diagrams;
pub mod folders;
pub mod formulas;
pub mod graph;
pub mod health;
pub mod imports;
pub mod info;
pub mod marks;
pub mod meta;
pub mod notes;
pub mod projects;
pub mod references;
pub mod replace;
pub mod sources;
pub mod vault;
pub mod vaults;
