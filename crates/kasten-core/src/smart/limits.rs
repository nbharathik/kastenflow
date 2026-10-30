//! What a smart page's folder may hold, checked by every write: the form of a
//! file's path inside the folder, its size, and the folder's size and file
//! count. The write ops call these before anything is written.

use super::{ALLOWED_EXTENSIONS, MANIFEST_FILE, MAX_FILE_BYTES, MAX_TOTAL_BYTES, is_allowed_path};
use crate::error::{Error, Result};

/// The most files one folder may hold.
pub const MAX_FILES: usize = 500;
/// The longest path inside a folder, in bytes.
const MAX_PATH_BYTES: usize = 200;
/// The most folders deep a file may be (the file's own name included).
const MAX_PARTS: usize = 6;

fn megabytes(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

/// Checks a file's path inside the folder (`index.html`, `data/venues.json`).
/// Refused: nothing or something too long, an absolute path, backslashes,
/// drive letters, `..` or `.` parts, empty parts, hidden parts (a dot
/// first), names Windows reads as another file, characters no file system
/// takes in a name, trailing dots or spaces, too many folders deep, and any
/// ending but the ones a folder may hold (no `.wasm`, no program of any kind).
pub fn check_path(rel: &str) -> Result<()> {
    let bad = |why: &str| {
        Error::Invalid(format!(
            "“{}” is not a file a smart page may have: {why}",
            rel.escape_debug()
        ))
    };
    if rel.is_empty() {
        return Err(bad("it has no name"));
    }
    if rel.len() > MAX_PATH_BYTES {
        return Err(bad("the path is too long"));
    }
    if rel.starts_with('/') || rel.contains(['\\', ':']) {
        return Err(bad(
            "it must be a path inside the folder, with forward slashes",
        ));
    }
    if rel
        .chars()
        .any(|c| c.is_control() || matches!(c, '<' | '>' | '"' | '|' | '?' | '*'))
    {
        return Err(bad("the name has a character files cannot be named with"));
    }
    let parts: Vec<&str> = rel.split('/').collect();
    if parts.len() > MAX_PARTS {
        return Err(bad("it is in too many folders"));
    }
    for part in &parts {
        if part.is_empty() || *part == "." || *part == ".." {
            return Err(bad("it must stay inside the folder"));
        }
        if part.starts_with('.') {
            return Err(bad("hidden files are not allowed"));
        }
        if part.ends_with(['.', ' ']) || crate::vault::aliases_on_windows(part) {
            return Err(bad("Windows would read the name as another file"));
        }
    }
    if !is_allowed_path(rel) {
        return Err(bad(&format!(
            "only {} files, and {MANIFEST_FILE}, are allowed",
            ALLOWED_EXTENSIONS.join(", ")
        )));
    }
    Ok(())
}

/// Checks the files of smart pages' folders among `files` (each a vault path
/// and its size): the same path rules, file size, folder size and file count
/// the write ops hold, for a source that does not write through them (a
/// bundle being imported). Files outside such folders are not looked at.
pub fn check_listed<'a>(files: impl IntoIterator<Item = (&'a str, u64)>) -> Result<()> {
    let mut folders: std::collections::HashMap<String, (u64, usize)> =
        std::collections::HashMap::new();
    for (path, bytes) in files {
        let parts: Vec<&str> = path.split('/').collect();
        let Some(end) = parts[..parts.len() - 1].iter().position(|part| {
            part.len() > super::SMART_DIR_SUFFIX.len()
                && part.to_ascii_lowercase().ends_with(super::SMART_DIR_SUFFIX)
        }) else {
            continue;
        };
        check_path(&parts[end + 1..].join("/"))?;
        check_file_size(usize::try_from(bytes).unwrap_or(usize::MAX))?;
        let held = folders
            .entry(parts[..=end].join("/").to_ascii_lowercase())
            .or_default();
        held.0 += bytes;
        held.1 += 1;
        check_totals(
            (held.0 - bytes, held.1 - 1),
            usize::try_from(bytes).unwrap_or(usize::MAX),
            true,
        )?;
    }
    Ok(())
}

/// Whether the file at `rel` is text (so an agent may send it as text): code,
/// data, a picture drawn in text, or the manifest.
pub fn is_text_file(rel: &str) -> bool {
    if rel == MANIFEST_FILE {
        return true;
    }
    let name = rel.rsplit('/').next().unwrap_or(rel);
    name.rsplit_once('.').is_some_and(|(_, ext)| {
        matches!(
            ext.to_ascii_lowercase().as_str(),
            "html" | "js" | "css" | "json" | "svg" | "txt"
        )
    })
}

/// Refuses a file over the size one file may be.
pub(crate) fn check_file_size(len: usize) -> Result<()> {
    if len as u64 > MAX_FILE_BYTES {
        return Err(Error::Invalid(format!(
            "A file in a smart page may be at most {}; this one is {}",
            megabytes(MAX_FILE_BYTES),
            megabytes(len as u64)
        )));
    }
    Ok(())
}

/// Refuses a write that would leave the folder over its total size or its
/// file count. `others` is what the folder holds besides the file being
/// written: its bytes and how many files.
pub(crate) fn check_totals(others: (u64, usize), len: usize, is_new: bool) -> Result<()> {
    let total = others.0 + len as u64;
    if total > MAX_TOTAL_BYTES {
        return Err(Error::Invalid(format!(
            "A smart page's folder may hold at most {}; this would make it {}",
            megabytes(MAX_TOTAL_BYTES),
            megabytes(total)
        )));
    }
    if is_new && others.1 + 1 > MAX_FILES {
        return Err(Error::Invalid(format!(
            "A smart page's folder may hold at most {MAX_FILES} files"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_the_paths_a_folder_may_hold() {
        for ok in [
            "index.html",
            "app.js",
            "css/site.CSS",
            "data/venues.json",
            "assets/a/pin.svg",
            "assets/p.png",
            "assets/p.webp",
            "assets/photo.JPG",
            "notes.txt",
            "smart.yaml",
        ] {
            assert!(check_path(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn refuses_paths_that_leave_the_folder_or_hide() {
        for bad in [
            "",
            "/index.html",
            "../x.js",
            "a/../b.js",
            "./a.js",
            "a/./b.js",
            "a//b.js",
            "a\\b.js",
            "c:/x.js",
            "C:\\x.js",
            ".hidden.js",
            "a/.git/x.js",
            "x.exe",
            "x.wasm",
            "x.js.exe",
            "noext",
            ".js",
            "sub/smart.yaml",
            "a/b/c/d/e/f/g.js",
            "bad.js ",
            "bad.js.",
            "CON.js",
            "PROGRA~1.js",
            "a<b>.js",
            "a?.js",
            "a\0b.js",
            "a\nb.js",
        ] {
            assert!(check_path(bad).is_err(), "{bad:?}");
        }
        assert!(check_path(&format!("{}.js", "a".repeat(250))).is_err());
    }

    #[test]
    fn knows_which_files_are_text() {
        for text in [
            "index.html",
            "a/app.js",
            "x.css",
            "d.json",
            "p.svg",
            "n.txt",
            "smart.yaml",
        ] {
            assert!(is_text_file(text), "{text}");
        }
        for binary in ["p.png", "p.webp", "p.jpg", "p.JPG"] {
            assert!(!is_text_file(binary), "{binary}");
        }
    }

    #[test]
    fn sizes_are_checked_at_the_limit() {
        assert!(check_file_size(MAX_FILE_BYTES as usize).is_ok());
        assert!(check_file_size(MAX_FILE_BYTES as usize + 1).is_err());
        let others = (MAX_TOTAL_BYTES - 10, 3);
        assert!(check_totals(others, 10, false).is_ok());
        assert!(check_totals(others, 11, false).is_err());
        assert!(check_totals((0, MAX_FILES - 1), 1, true).is_ok());
        assert!(check_totals((0, MAX_FILES), 1, true).is_err());
        assert!(check_totals((0, MAX_FILES), 1, false).is_ok());
    }
}
