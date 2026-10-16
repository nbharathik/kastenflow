//! What the deck store reads from files of the vault: a picture or a
//! PowerPoint file named by its path, and the pictures in `assets/`.

use std::borrow::Cow;
use std::fs;

use kasten_core::{Error, Kasten};
use slides_core::agent::{StoreError, StoreResult};

use super::store::failed;

/// The largest file `read_file` reads: a PowerPoint file with pictures in it.
const MOST_BYTES: u64 = 64 * 1024 * 1024;

/// The kinds of file an agent may name by path: pictures to keep, and PowerPoint files to import.
const READABLE: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "svg", "pptx"];

/// A picture or a PowerPoint file of the vault, by its path.
pub(super) fn read_file(kasten: &Kasten, path: &str) -> StoreResult<Vec<u8>> {
    let lower = path.to_ascii_lowercase();
    if !READABLE.iter().any(|e| lower.ends_with(&format!(".{e}"))) {
        return Err(StoreError::Invalid(format!(
            "`{path}` is not a picture or a PowerPoint file. PNG, JPEG, GIF, WebP and SVG pictures and .pptx files can be read from the vault."
        )));
    }
    let file = kasten
        .vault()
        .file_of(path, &[""])
        .map_err(|_| StoreError::Invalid(format!("`{path}` is not a path inside the vault.")))?;
    let meta = fs::metadata(&file)
        .ok()
        .filter(fs::Metadata::is_file)
        .ok_or_else(|| StoreError::NotFound(format!("There is no file `{path}` in the vault.")))?;
    if meta.len() > MOST_BYTES {
        return Err(StoreError::Invalid(format!(
            "`{path}` is larger than {} MB.",
            MOST_BYTES / 1024 / 1024
        )));
    }
    fs::read(file).map_err(|e| StoreError::Io(e.to_string()))
}

/// A picture named `.svg` is cleaned before it is kept: scripts, embedded pages and links
/// to the outside are taken out (the same cleaning a diagram's picture gets), and a file
/// that is not an SVG is refused. Every other picture is kept as it is.
pub(super) fn clean_picture<'a>(name: &str, bytes: &'a [u8]) -> StoreResult<Cow<'a, [u8]>> {
    if !name.to_ascii_lowercase().ends_with(".svg") {
        return Ok(Cow::Borrowed(bytes));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| {
        StoreError::Invalid(format!("`{name}` is not an SVG picture: it is not text."))
    })?;
    let cleaned = kasten_core::diagrams::sanitize::sanitize(text).map_err(failed)?;
    Ok(Cow::Owned(cleaned.svg.into_bytes()))
}

/// A picture of `assets/`, by its path.
pub(super) fn read_asset(kasten: &Kasten, path: &str) -> StoreResult<Vec<u8>> {
    kasten.read_asset(path).map_err(|error| match error {
        Error::NotFound(_) => StoreError::NotFound(format!(
            "There is no picture `{path}`. search_assets lists the pictures."
        )),
        other => failed(other),
    })
}
