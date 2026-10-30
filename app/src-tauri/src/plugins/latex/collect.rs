//! Reading what a build left behind: the log (cut to a size, then parsed),
//! the PDF, and the files the diagnostics name. TeX's log is untrusted text,
//! so a file name in it is only ever reported when it resolves to a plain
//! file inside the document's own folder.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::engines::Engine;
use super::log::{Diagnostic, Severity, parse_log, parse_log_bytes};
use super::paths::{below, clean_rel_tex, is_link, plain_file_below};
use super::snapshot::read_plain;

/// The most of a log that is read (the start of it: the file stack is built
/// from the start).
pub const MAX_LOG: u64 = 8 * 1024 * 1024;
/// The most diagnostics of each kind handed on.
const MAX_EACH: usize = 1000;
/// The longest message kept for a build that said nothing the parser knows.
const MAX_FALLBACK: usize = 300;

/// The PDF a build of `stem` makes in `out`.
pub fn pdf_path(out: &Path, stem: &str) -> PathBuf {
    out.join(format!("{stem}.pdf"))
}

/// The SyncTeX file a build of `stem` makes in `out`.
pub fn synctex_path(out: &Path, stem: &str) -> PathBuf {
    out.join(format!("{stem}.synctex.gz"))
}

/// The size and modified time of the PDF at `path`, if it is a plain file
/// that starts like a PDF.
pub fn pdf_stamp(path: &Path) -> Option<(u64, SystemTime)> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if is_link(&meta) || !meta.is_file() {
        return None;
    }
    let mut head = [0u8; 5];
    File::open(path).ok()?.read_exact(&mut head).ok()?;
    (&head == b"%PDF-").then(|| {
        (
            meta.len(),
            meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        )
    })
}

/// The path of file `name`, as a log or SyncTeX file gives it, inside the
/// document's folder `src`: relative, with `/`, and only when it is a plain
/// file there (or one of the unsaved buffers' files). A name outside the
/// folder, absolute, with `..`, through a link, or of a file that is not
/// there (a system file, a generated one) gives none.
pub fn resolve_file(
    src: &Path,
    tree: &Path,
    name: &str,
    unsaved: &HashSet<String>,
) -> Option<String> {
    let name = name.trim();
    let rel = if let Some(rel) = below(tree, name) {
        rel
    } else if name.starts_with(['/', '\\']) || name.contains(':') {
        return None;
    } else {
        name.to_owned()
    };
    let rel = clean_rel_tex(&rel)?;
    if unsaved.contains(&rel) || plain_file_below(src, &rel).is_some() {
        Some(rel)
    } else {
        None
    }
}

fn rank(severity: Severity) -> usize {
    match severity {
        Severity::Error => 0,
        Severity::Warning => 1,
        Severity::Info => 2,
    }
}

/// The last thing the build said, short, for a failure the parser found
/// nothing in.
fn fallback(output: &str) -> Option<Diagnostic> {
    let line = output.lines().rev().find(|l| !l.trim().is_empty())?;
    Some(Diagnostic {
        file: None,
        line: None,
        severity: Severity::Error,
        message: line.trim().chars().take(MAX_FALLBACK).collect(),
        context: None,
    })
}

/// Where the results of one build are read from.
pub struct Reading<'a> {
    pub src: &'a Path,
    pub tree: &'a Path,
    pub out: &'a Path,
    pub stem: &'a str,
    pub engine: Engine,
    pub unsaved: &'a HashSet<String>,
}

/// The diagnostics of a build of `stem`: the log in `out` (read up to
/// `MAX_LOG` bytes), and for Tectonic, or when there is no log, what the
/// program printed. Files are resolved inside `src` (see `resolve_file`).
/// `failed` adds the program's last line when nothing else is an error.
pub fn diagnostics(reading: &Reading<'_>, printed: &str, failed: bool) -> Vec<Diagnostic> {
    let log = read_plain(&reading.out.join(format!("{}.log", reading.stem)), MAX_LOG);
    let mut found = log.as_deref().map(parse_log_bytes).unwrap_or_default();
    if log.is_none() || reading.engine == Engine::Tectonic {
        let key = |d: &Diagnostic| format!("{:?}|{}|{:?}", d.severity, d.message, d.line);
        let seen: HashSet<String> = found.iter().map(key).collect();
        found.extend(
            parse_log(printed)
                .into_iter()
                .filter(|d| !seen.contains(&key(d))),
        );
    }
    if failed
        && !found.iter().any(|d| d.severity == Severity::Error)
        && let Some(last) = fallback(printed)
    {
        found.insert(0, last);
    }
    let mut memo: HashMap<String, Option<String>> = HashMap::new();
    let mut counts = [0usize; 3];
    let mut kept = Vec::new();
    for mut d in found {
        let at = rank(d.severity);
        if counts[at] >= MAX_EACH {
            continue;
        }
        counts[at] += 1;
        d.file = d.file.take().and_then(|name| {
            memo.entry(name.clone())
                .or_insert_with(|| resolve_file(reading.src, reading.tree, &name, reading.unsaved))
                .clone()
        });
        kept.push(d);
    }
    kept
}
