//! The optional diagram editor (draw.io, diagrams.net; Apache-2.0). It is not
//! part of the installer: it is a 48 MB download from the release it is
//! pinned to, installed on request into the app's data folder, checked
//! against the pinned SHA-256, and shown to the window by the `diagrams`
//! scheme from there. Diagrams themselves are files in the vault, made and
//! kept by kasten-core; nothing here touches the vault.

mod clean;
pub mod commands;
mod extract;
mod install;
mod pinned;
pub mod protocol;

#[cfg(test)]
mod tests;

pub use commands::{Editor, installed_dir};
