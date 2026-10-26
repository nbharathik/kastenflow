//! The manifest of a bundle, `kastenflow-bundle.json`, and the checks a bundle is
//! read with: a path in it must be plain and in a place a bundle may put files,
//! so a bundle cannot reach outside the vault or into its private folders.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// The manifest's file name, at the top of a bundle.
pub const MANIFEST_FILE: &str = "kastenflow-bundle.json";
/// The `format` the manifest states, and the newest version of it this build reads.
pub const FORMAT: &str = "kastenflow-bundle";
pub const VERSION: u32 = 1;

/// The most files a bundle lists, and the biggest one.
const MOST_FILES: usize = 100_000;
pub const MOST_FILE_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestProject {
    pub folder: String,
    pub title: String,
    #[serde(default)]
    pub id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestFile {
    /// The path the file has in the vault and in the bundle.
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    /// When it was made, RFC 3339.
    pub made: String,
    /// The program that made it, `KastenFlow 1.2.0`.
    pub app: String,
    pub project: ManifestProject,
    pub files: Vec<ManifestFile>,
    /// The keys of the works in `references.bib`.
    #[serde(default)]
    pub references: Vec<String>,
    /// What the bundle leaves out, in sentences.
    #[serde(default)]
    pub outside: Vec<String>,
}

fn refuse(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// Whether `name` can be the folder of a project in the vault.
pub fn plain_folder(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && !name.contains(['/', '\\', ':', '\0'])
        && !name.ends_with([' ', '.'])
}

/// Checks a path a bundle lists: relative, forward slashes, no `.` or `..` or empty part, no
/// hidden part but the `.meta` folder of sidecars, nothing Windows reads as another name; and
/// in a place a bundle may put files: the project's own folder, `assets/`, `sources/`,
/// `tags/`, or `references.bib` at the top.
pub fn check_path(path: &str, folder: &str) -> Result<()> {
    let bad = || {
        refuse(format!(
            "The bundle lists a file KastenFlow will not import: “{}”",
            path.chars().take(120).collect::<String>()
        ))
    };
    if path.is_empty() || path.starts_with('/') || path.contains(['\\', ':', '\0']) {
        return Err(bad());
    }
    let parts: Vec<&str> = path.split('/').collect();
    for (i, part) in parts.iter().enumerate() {
        let sidecar_folder = *part == ".meta" && i > 0 && i + 1 < parts.len();
        if part.is_empty()
            || *part == "."
            || *part == ".."
            || (part.starts_with('.') && !sidecar_folder)
            || (cfg!(windows) && crate::vault::aliases_on_windows(part))
            || part.chars().any(char::is_control)
        {
            return Err(bad());
        }
    }
    let inside =
        |prefix: &str| path.starts_with(prefix) && parts.len() > prefix.matches('/').count();
    let own = format!("projects/{folder}/");
    if path == "references.bib"
        || inside(&own)
        || inside("assets/")
        || inside("sources/")
        || inside("tags/")
    {
        return Ok(());
    }
    Err(bad())
}

impl Manifest {
    /// Reads and checks a manifest's text. A bundle of a newer version, one that is not a
    /// bundle, one with a path that is not plain, a repeated path or a hash that is not
    /// a SHA-256 is refused with a sentence.
    pub fn parse(text: &str) -> Result<Manifest> {
        let manifest: Manifest = serde_json::from_str(text)
            .map_err(|err| refuse(format!("{MANIFEST_FILE} is not a readable manifest: {err}")))?;
        if manifest.format != FORMAT {
            return Err(refuse(format!(
                "{MANIFEST_FILE} is not a KastenFlow bundle manifest"
            )));
        }
        if manifest.version > VERSION {
            return Err(refuse(format!(
                "This bundle was made by a newer version of KastenFlow (bundle version {}; this one reads up to {VERSION}). Update KastenFlow to import it",
                manifest.version
            )));
        }
        if manifest.version == 0 {
            return Err(refuse(format!("{MANIFEST_FILE} has no version")));
        }
        if !plain_folder(&manifest.project.folder) {
            return Err(refuse(format!(
                "The bundle names a project folder KastenFlow will not use: “{}”",
                manifest.project.folder.chars().take(80).collect::<String>()
            )));
        }
        if manifest.files.len() > MOST_FILES {
            return Err(refuse(format!(
                "The bundle lists more than {MOST_FILES} files"
            )));
        }
        let mut seen = HashSet::new();
        for file in &manifest.files {
            check_path(&file.path, &manifest.project.folder)?;
            if !seen.insert(file.path.to_lowercase()) {
                return Err(refuse(format!("The bundle lists “{}” twice", file.path)));
            }
            if file.bytes > MOST_FILE_BYTES {
                return Err(refuse(format!(
                    "“{}” is bigger than a bundle may hold",
                    file.path
                )));
            }
            if !slides_assets::sha256::is_hex_hash(&file.sha256) {
                return Err(refuse(format!(
                    "“{}” has no SHA-256 in the manifest",
                    file.path
                )));
            }
        }
        // A smart page's folder comes in under the limits and the list of
        // files that writing to it holds: it is served as code.
        crate::smart::check_listed(manifest.files.iter().map(|f| (f.path.as_str(), f.bytes)))
            .map_err(|err| refuse(format!("{err}. Nothing was imported")))?;
        let page = format!("projects/{}/_project.md", manifest.project.folder);
        if !manifest.files.iter().any(|f| f.path == page) {
            return Err(refuse("The bundle holds no project page (_project.md)"));
        }
        Ok(manifest)
    }

    /// The manifest as it is written: indented JSON and a final newline.
    pub fn to_text(&self) -> String {
        let mut text = serde_json::to_string_pretty(self).unwrap_or_default();
        text.push('\n');
        text
    }
}
