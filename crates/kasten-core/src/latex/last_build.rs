//! The last build of a document, as an agent can read it: the diagnostics in
//! the log the app's build left in the cache. The app runs the engine; this
//! only reads what it said. The log is untrusted text: it is read up to a size,
//! only from a plain file in a plain cache folder, and a file name in it is
//! kept only when it is a plain source file inside the document's folder.

use std::fs::{self, File, Metadata};
use std::io::Read;
use std::path::Path;
use std::time::SystemTime;

use serde::Serialize;

use super::log::{Diagnostic, Severity, parse_log_bytes};
use super::{LatexDoc, build_dir, is_source_path};

/// The most of a log that is read (the start of it: the file stack is built
/// from the start).
pub const MAX_LOG_BYTES: u64 = 8 * 1024 * 1024;
/// The most errors, and the most warnings, listed one by one.
const MOST_LISTED: usize = 100;
/// The most box complaints listed.
const MOST_NOTES: usize = 10;

/// What the last build of a document said.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastBuild {
    /// A log of a build is there to read.
    pub built: bool,
    /// A source file was changed after that build.
    pub stale: bool,
    pub errors: usize,
    pub warnings: usize,
    /// Overfull and underfull boxes.
    pub notes: usize,
    /// Errors, then warnings, then a few notes, in the order of the log; the
    /// file is relative to the document's folder, or none.
    pub diagnostics: Vec<Diagnostic>,
    /// How many were counted but not listed.
    pub more: usize,
}

impl LastBuild {
    fn none() -> LastBuild {
        LastBuild {
            built: false,
            stale: false,
            errors: 0,
            warnings: 0,
            notes: 0,
            diagnostics: Vec::new(),
            more: 0,
        }
    }
}

/// Whether `meta` is a link of any kind (a symbolic link, or on Windows any
/// reparse point).
pub(crate) fn is_link(meta: &Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

/// `rel` below `root` when every step on the way is a plain folder and the
/// end is a plain file.
pub(super) fn plain_file(root: &Path, rel: &[&str]) -> Option<std::path::PathBuf> {
    let mut path = root.to_path_buf();
    for (i, part) in rel.iter().enumerate() {
        path.push(part);
        let meta = fs::symlink_metadata(&path).ok()?;
        let last = i + 1 == rel.len();
        if is_link(&meta) || (last && !meta.is_file()) || (!last && !meta.is_dir()) {
            return None;
        }
    }
    Some(path)
}

/// The path of `name` (as a log gives it) relative to the document's folder,
/// when it is a plain source file inside it; none for anything else (an
/// absolute name, `..`, a hidden or generated file, a link, a system file).
fn inside(root: &Path, folder: &str, name: &str) -> Option<String> {
    let name = name.trim();
    if name.is_empty() || name.starts_with(['/', '\\']) || name.contains([':', '\\', '\0']) {
        return None;
    }
    let mut parts = Vec::new();
    for part in name.split('/') {
        match part {
            "" | "." => {}
            ".." => return None,
            hidden if hidden.starts_with('.') => return None,
            other => parts.push(other),
        }
    }
    let rel = parts.join("/");
    if parts.is_empty() || !is_source_path(&rel) {
        return None;
    }
    let mut full: Vec<&str> = folder.split('/').filter(|p| !p.is_empty()).collect();
    full.extend(&parts);
    plain_file(root, &full)?;
    Some(rel)
}

/// What the last build of `doc` said, read from the cache under `root`.
/// `newest_source` is when the document's newest source file was changed.
pub(crate) fn read(root: &Path, doc: &LatexDoc, newest_source: Option<SystemTime>) -> LastBuild {
    let stem = Path::new(&doc.main)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let rel = build_dir(&doc.folder);
    let log = format!("{stem}.log");
    let mut parts: Vec<&str> = rel.split('/').collect();
    parts.extend(["out", log.as_str()]);
    let Some(path) = plain_file(root, &parts) else {
        return LastBuild::none();
    };
    let modified = fs::metadata(&path).and_then(|m| m.modified()).ok();
    let mut bytes = Vec::new();
    let read = File::open(&path).and_then(|f| f.take(MAX_LOG_BYTES).read_to_end(&mut bytes));
    if read.is_err() {
        return LastBuild::none();
    }
    let all = parse_log_bytes(&bytes);
    let count = |severity: Severity| all.iter().filter(|d| d.severity == severity).count();
    let (errors, warnings, notes) = (
        count(Severity::Error),
        count(Severity::Warning),
        count(Severity::Info),
    );
    let mut room = [MOST_LISTED, MOST_LISTED, MOST_NOTES];
    let mut diagnostics = Vec::new();
    for mut d in all {
        let slot = &mut room[d.severity as usize];
        if *slot == 0 {
            continue;
        }
        *slot -= 1;
        d.file = d
            .file
            .take()
            .and_then(|name| inside(root, &doc.folder, &name));
        diagnostics.push(d);
    }
    LastBuild {
        built: true,
        stale: matches!((newest_source, modified), (Some(source), Some(built)) if source > built),
        errors,
        warnings,
        notes,
        more: errors + warnings + notes - diagnostics.len(),
        diagnostics,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_kept_only_when_it_is_a_plain_source_inside_the_folder() {
        let root = std::env::temp_dir().join(format!("kasten-last-build-{}", std::process::id()));
        let folder = root.join("paper/sections");
        fs::create_dir_all(&folder).unwrap();
        fs::write(root.join("paper/main.tex"), "x").unwrap();
        fs::write(folder.join("a.tex"), "x").unwrap();
        fs::write(root.join("paper/main.aux"), "x").unwrap();
        let kept = |name: &str| inside(&root, "paper", name);
        assert_eq!(kept("main.tex").as_deref(), Some("main.tex"));
        assert_eq!(kept("./sections/a.tex").as_deref(), Some("sections/a.tex"));
        for dropped in [
            "main.aux",
            "missing.tex",
            "../main.tex",
            "/paper/main.tex",
            "C:/paper/main.tex",
            "sections\\a.tex",
            ".hidden.tex",
            "sections",
            "",
        ] {
            assert_eq!(kept(dropped), None, "{dropped}");
        }
        let _ = fs::remove_dir_all(&root);
    }
}
