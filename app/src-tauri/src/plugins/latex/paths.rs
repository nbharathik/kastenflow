//! Names that come from outside the build are never trusted: the paths of a
//! window's unsaved buffers, the file names a TeX log prints, the inputs a
//! SyncTeX file lists. Each is turned into a plain relative path inside the
//! document's folder, or refused. Nothing here opens a file for its caller;
//! it only says where a name may point, and whether what is there is a plain
//! file or folder (never a link).

use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};

/// The longest path or name accepted.
const MAX_PATH: usize = 1024;
const MAX_SEGMENT: usize = 255;

/// Whether `meta` is a link of any kind (a symbolic link, or on Windows any
/// reparse point: a junction, a mount point, a cloud placeholder).
pub fn is_link(meta: &Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const REPARSE_POINT: u32 = 0x400;
        if meta.file_attributes() & REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

/// A name Windows keeps for a device (`con`, `nul.tex`, `com1`…).
fn device(part: &str) -> bool {
    let stem = part
        .split('.')
        .next()
        .unwrap_or(part)
        .trim_end_matches(' ')
        .to_ascii_lowercase();
    // `com1`…`com9` and `lpt1`…`lpt9`, also with the superscript digits Windows reads alike.
    let numbered = |prefix: &str| {
        stem.strip_prefix(prefix).is_some_and(|n| {
            let mut chars = n.chars();
            matches!(
                (chars.next(), chars.next()),
                (Some('0'..='9' | '¹' | '²' | '³'), None)
            )
        })
    };
    matches!(
        stem.as_str(),
        "con" | "prn" | "aux" | "nul" | "conin$" | "conout$"
    ) || numbered("com")
        || numbered("lpt")
}

/// Whether one name (no separator) is fit to be a file or folder in a build:
/// not empty, not `.` or `..`, not hidden, no control character or one
/// Windows reads as something else, no device name.
pub fn segment_ok(part: &str) -> bool {
    !part.is_empty()
        && part.len() <= MAX_SEGMENT
        && !part.starts_with('.')
        && !part.ends_with([' ', '.'])
        && !part.contains(['/', '\\', ':', '<', '>', '"', '|', '?', '*'])
        && !part.chars().any(char::is_control)
        && !device(part)
}

/// `name` as a relative path of `/`-separated plain parts, or none when it
/// could point anywhere else: absolute, a drive, a stream, `..`, a hidden
/// part, a backslash. A leading `./` and inner `.` parts are dropped.
pub fn clean_rel(name: &str) -> Option<String> {
    if name.is_empty() || name.len() > MAX_PATH || name.starts_with('/') {
        return None;
    }
    let mut parts = Vec::new();
    for part in name.split('/') {
        if part == "." || (part.is_empty() && parts.is_empty()) {
            continue;
        }
        if !segment_ok(part) {
            return None;
        }
        parts.push(part);
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

/// `clean_rel` for a name a Windows TeX printed, which may use backslashes.
pub fn clean_rel_tex(name: &str) -> Option<String> {
    clean_rel(&name.replace('\\', "/"))
}

/// `a` and `b` joined by `/`, lower-cased where the file system ignores case.
fn comparable(path: &str) -> String {
    let slashed = path.replace('\\', "/");
    let trimmed = slashed
        .strip_prefix("//?/")
        .or_else(|| slashed.strip_prefix("//./"))
        .unwrap_or(&slashed);
    let trimmed = trimmed.trim_end_matches('/');
    if cfg!(windows) {
        trimmed.to_lowercase()
    } else {
        trimmed.to_owned()
    }
}

/// The part of the absolute path `name` below `base`, when it is below it
/// (compared as text, so a path into another folder never matches).
pub fn below(base: &Path, name: &str) -> Option<String> {
    let base = comparable(&base.to_string_lossy());
    let name = name.replace('\\', "/");
    let name_cmp = comparable(&name);
    let rest = name_cmp.strip_prefix(&base)?.strip_prefix('/')?;
    // Take the spelling from the original name (the comparison may have lower-cased it).
    let skip = name_cmp.len() - rest.len();
    let original = name
        .strip_prefix("//?/")
        .or_else(|| name.strip_prefix("//./"))
        .unwrap_or(&name);
    original.get(skip..).map(str::to_owned)
}

/// Whether `rel` (clean, `/` separated) names a plain file below `folder`,
/// every part of the way a plain folder: nothing on the way is a link. The
/// path is returned for the caller to read.
pub fn plain_file_below(folder: &Path, rel: &str) -> Option<PathBuf> {
    let rel = clean_rel(rel)?;
    let mut path = folder.to_path_buf();
    let parts: Vec<&str> = rel.split('/').collect();
    for (at, part) in parts.iter().enumerate() {
        path.push(part);
        let meta = fs::symlink_metadata(&path).ok()?;
        if is_link(&meta) {
            return None;
        }
        let last = at + 1 == parts.len();
        if last != meta.is_file() || (!last && !meta.is_dir()) {
            return None;
        }
    }
    Some(path)
}

/// Whether `rel` below `base` is a chain of plain folders (those that exist;
/// the ones that do not exist yet are fine): nothing on the way is a link.
pub fn plain_folders_below(base: &Path, rel: &str) -> bool {
    let mut path = base.to_path_buf();
    for part in rel.split('/').filter(|p| !p.is_empty()) {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if is_link(&meta) || !meta.is_dir() => return false,
            Ok(_) => {}
            Err(_) => return true,
        }
    }
    true
}

/// Whether `path` is a folder and not a link.
pub fn plain_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|meta| !is_link(&meta) && meta.is_dir())
}

/// Whether `folder` really is inside `root` once every link is followed.
pub fn really_inside(root: &Path, folder: &Path) -> bool {
    match (fs::canonicalize(root), fs::canonicalize(folder)) {
        (Ok(root), Ok(folder)) => folder.starts_with(root),
        _ => false,
    }
}
