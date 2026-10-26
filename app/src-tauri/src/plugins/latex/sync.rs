//! SyncTeX for the window: from a line of source to the places in the PDF
//! it made, and from a click in the PDF to a line of source. The SyncTeX
//! file is what the last build wrote; the file names in it are untrusted and
//! only a plain file inside the document's folder is ever answered.

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;

use super::collect::{resolve_file, synctex_path};
use super::paths::clean_rel;
use super::snapshot::read_plain;
use super::synctex::{Hit, SyncTex, SyncTexError};

/// The unpacked size a SyncTeX file may have is capped by the reader; this
/// caps the file read from disk.
const MAX_FILE: u64 = 32 * 1024 * 1024;

/// A line of one of the document's files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Spot {
    /// Relative to the document's folder.
    pub file: String,
    pub line: u32,
}

fn read(out: &Path, stem: &str) -> Result<SyncTex, String> {
    let bytes = read_plain(&synctex_path(out, stem), MAX_FILE)
        .ok_or("Build the document first: there is nothing to match yet")?;
    SyncTex::from_bytes(&bytes).map_err(|err| err.to_string())
}

fn say(err: SyncTexError) -> String {
    match err {
        SyncTexError::NotFound => "The PDF has nothing for that place".to_owned(),
        other => other.to_string(),
    }
}

/// Where line `line` of `file` (relative to the document's folder) is on the pages.
pub fn forward(out: &Path, stem: &str, file: &str, line: u32) -> Result<Vec<Hit>, String> {
    let file = clean_rel(file).ok_or("That is not a file of this document")?;
    read(out, stem)?.forward(&file, line).map_err(say)
}

/// The line of source behind the point (`x`, `y`) of `page`.
pub fn inverse(
    src: &Path,
    tree: &Path,
    out: &Path,
    stem: &str,
    page: u32,
    x: f64,
    y: f64,
) -> Result<Spot, String> {
    let source = read(out, stem)?.inverse(page, x, y).map_err(say)?;
    let file = resolve_file(src, tree, &source.file, &HashSet::new())
        .ok_or("That place does not come from a file of this document")?;
    Ok(Spot {
        file,
        line: source.line,
    })
}
