//! Project bundles: a project exported to a folder outside the vault, and
//! imported back from one. A bundle is the project's folder with its sidecars,
//! the pictures and PDFs it uses (with their sidecars), the tag schemas it uses
//! and the works it cites as `references.bib`, and a manifest,
//! `kastenflow-bundle.json`, that lists every file with its size and SHA-256.
//! Nothing of the vault's history, `.kasten/`, trash, chats or credentials goes in.
//!
//! - what a project's bundle holds is worked out by the engine
//!   (`engine/bundles`), into a [`Collected`];
//! - `export` writes it into a new or empty folder outside the vault;
//! - `manifest` is the manifest, and the checks a bundle is read with;
//! - `import` plans an import: a free project folder, ids made new where the
//!   vault has them, files renamed where the vault has a different one, keys
//!   of the bibliography renamed where it has another work; `apply` writes it.

mod apply;
mod export;
mod import;
mod manifest;
mod places;
mod rewrite;
mod works;

use std::path::PathBuf;

use serde::Serialize;

pub(crate) use apply::write as write_import;
pub(crate) use export::write as write_export;
pub(crate) use import::prepare;
pub use manifest::{FORMAT, MANIFEST_FILE, Manifest, ManifestFile, ManifestProject, VERSION};
pub(crate) use manifest::{MOST_FILE_BYTES, check_path, plain_folder};

/// What a file of a bundle is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BundleFileKind {
    /// In the project's folder.
    Project,
    /// A picture or file in `assets/`, or a sidecar of one.
    Asset,
    /// A PDF in `sources/`, or its highlights.
    Source,
    /// A tag's schema.
    Tag,
    /// The cited works, `references.bib`.
    References,
}

/// One file of a bundle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleFile {
    /// Its path in the vault and in the bundle (`references.bib` is at the top of the bundle).
    pub path: String,
    pub bytes: u64,
    pub kind: BundleFileKind,
}

/// The project a bundle is of.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleProject {
    /// The folder under `projects/`.
    pub folder: String,
    pub title: String,
    pub id: Option<String>,
}

/// What exporting a project would put in the bundle, worked out without writing anything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundlePlan {
    pub project: BundleProject,
    pub files: Vec<BundleFile>,
    pub bytes: u64,
    /// The keys whose entries go into `references.bib`.
    pub references: Vec<String>,
    /// Keys the project cites that are in no `.bib` file.
    pub missing_references: Vec<String>,
    /// What the bundle leaves out, in sentences: "3 links lead to notes outside the project".
    pub outside: Vec<String>,
}

/// What an export wrote.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleExported {
    /// The folder it was written to.
    pub dest: String,
    pub files: usize,
    pub bytes: u64,
    pub references: usize,
    pub outside: Vec<String>,
}

/// Where a file's bytes come from.
#[derive(Debug, Clone)]
pub(crate) enum Source {
    File(PathBuf),
    Text(String),
}

/// A file to put in a bundle.
#[derive(Debug, Clone)]
pub(crate) struct Planned {
    pub path: String,
    pub kind: BundleFileKind,
    pub bytes: u64,
    pub source: Source,
}

/// What a project's bundle holds, before anything is written.
#[derive(Debug, Clone)]
pub(crate) struct Collected {
    pub project: BundleProject,
    /// By path.
    pub files: Vec<Planned>,
    pub references: Vec<String>,
    pub missing_references: Vec<String>,
    pub outside: Vec<String>,
}

impl Collected {
    pub fn plan(&self) -> BundlePlan {
        BundlePlan {
            project: self.project.clone(),
            files: self
                .files
                .iter()
                .map(|f| BundleFile {
                    path: f.path.clone(),
                    bytes: f.bytes,
                    kind: f.kind,
                })
                .collect(),
            bytes: self.files.iter().map(|f| f.bytes).sum(),
            references: self.references.clone(),
            missing_references: self.missing_references.clone(),
            outside: self.outside.clone(),
        }
    }
}
