//! Unpacking the web app from the downloaded WAR (a ZIP). The download has
//! passed its checksum before this runs, so these rules are a second wall:
//! an entry may never leave the folder it is unpacked into, only the web
//! app's own kinds of files are kept (nothing of the server that comes with
//! it), and the count and the total size are limited.

use std::fs::{self, File};
use std::io::{self, Read};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use zip::ZipArchive;

/// How much a WAR may hold.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// The most entries.
    pub entries: usize,
    /// The most bytes, all files together once unpacked.
    pub bytes: u64,
}

pub const LIMITS: Limits = Limits {
    entries: 20_000,
    bytes: 600 * 1024 * 1024,
};

// Why an install stopped is the plugin installer's, shared with this unpacker.
pub use crate::plugins::payload::{Failure, failed};

/// What was unpacked.
#[derive(Debug, PartialEq, Eq)]
pub struct Unpacked {
    pub files: usize,
    pub skipped: usize,
}

/// The kinds of file a web app is made of, by extension.
const ALLOWED: &[&str] = &[
    "html",
    "htm",
    "js",
    "mjs",
    "css",
    "json",
    "map",
    "webmanifest",
    "svg",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "ico",
    "cur",
    "bmp",
    "woff",
    "woff2",
    "ttf",
    "otf",
    "eot",
    "txt",
    "md",
    "xml",
    "xsl",
    "csv",
];

/// A name Windows keeps for a device (`con`, `nul.js`, `com1`…), which a file
/// cannot be made under.
fn device(part: &str) -> bool {
    let stem = part
        .split('.')
        .next()
        .unwrap_or(part)
        .trim_end_matches(' ')
        .to_ascii_lowercase();
    let numbered = |prefix: &str| {
        stem.strip_prefix(prefix)
            .is_some_and(|n| n.len() == 1 && n.as_bytes()[0].is_ascii_digit())
    };
    matches!(stem.as_str(), "con" | "prn" | "aux" | "nul") || numbered("com") || numbered("lpt")
}

/// The parts of an entry's name, or why the name is not safe: no absolute
/// path, no `..` or `.`, no backslash, colon or NUL (a drive, a stream, a
/// separator on Windows), nothing a file system reads as another name.
fn parts(name: &str) -> Result<Vec<&str>, String> {
    let unsafe_name = || format!("The download holds a file with an unsafe name: {name:?}");
    if name.is_empty() || name.starts_with('/') || name.contains(['\\', '\0', ':']) {
        return Err(unsafe_name());
    }
    let mut out = Vec::new();
    for part in name.strip_suffix('/').unwrap_or(name).split('/') {
        if part.is_empty() || part.ends_with(['.', ' ']) || device(part) {
            return Err(unsafe_name());
        }
        out.push(part);
    }
    Ok(out)
}

/// A licence or notice file the release carries, kept with the copy wherever
/// it is in the web app (the release has one at the top of some of its
/// folders, such as `shapes/LICENSE`, and none for the editor itself) or in
/// `META-INF/`, but never inside the server's `WEB-INF/`. Returns the name it is
/// kept under: its folders joined to its name, `shapes-LICENSE`.
fn legal_name(rel: &[&str]) -> Option<String> {
    let name = rel.last()?;
    let lower = name.to_ascii_lowercase();
    let stem = lower.split('.').next().unwrap_or(&lower);
    let ext_ok = match lower.split_once('.') {
        None => true,
        Some((_, ext)) => matches!(ext, "txt" | "md"),
    };
    if !(stem == "license" || stem == "licence" || stem == "notice") || !ext_ok {
        return None;
    }
    if rel[0].eq_ignore_ascii_case("WEB-INF") {
        return None;
    }
    Some(rel.join("-"))
}

fn allowed(name: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(_, ext)| ALLOWED.contains(&ext.to_ascii_lowercase().as_str()))
}

fn io_failed(what: &'static str) -> impl Fn(io::Error) -> Failure {
    move |err| Failure::Failed(format!("Could not {what}: {err}"))
}

/// Unpacks the web app of the WAR at `war` into `into` (made if needed, and
/// empty). `progress` hears how many entries are done of how many.
pub fn extract(
    war: &Path,
    into: &Path,
    limits: &Limits,
    cancel: &AtomicBool,
    progress: &dyn Fn(u64, u64),
) -> Result<Unpacked, Failure> {
    let file = File::open(war).map_err(io_failed("open the download"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|err| Failure::Failed(format!("The download is not a ZIP file: {err}")))?;
    if archive.len() > limits.entries {
        return failed(format!(
            "The download holds {} files; the most KastenFlow unpacks is {}",
            archive.len(),
            limits.entries
        ));
    }
    // Every name is checked before anything is written.
    let mut names = Vec::with_capacity(archive.len());
    let mut declared: u64 = 0;
    for at in 0..archive.len() {
        let entry = archive
            .by_index(at)
            .map_err(|err| Failure::Failed(format!("The download cannot be read: {err}")))?;
        parts(entry.name()).map_err(Failure::Failed)?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170_000 == 0o120_000)
        {
            return failed(format!(
                "The download holds a link, which is not unpacked: {:?}",
                entry.name()
            ));
        }
        declared = declared.saturating_add(entry.size());
        names.push((entry.name().to_owned(), entry.is_dir()));
    }
    if declared > limits.bytes {
        return failed(format!(
            "The download unpacks to {} MB; the most KastenFlow unpacks is {} MB",
            declared / (1024 * 1024),
            limits.bytes / (1024 * 1024)
        ));
    }
    // The web app is the archive's top, or a `webapp` folder in it.
    let strip = if names.iter().any(|(name, _)| name == "index.html") {
        0
    } else if names.iter().any(|(name, _)| name == "webapp/index.html") {
        1
    } else {
        return failed("The download is not the diagram editor's web app: it has no index.html");
    };
    fs::create_dir_all(into).map_err(io_failed("make a folder for the editor"))?;
    let total = names.len() as u64;
    let (mut files, mut skipped, mut written) = (0usize, 0usize, 0u64);
    for (at, (name, dir)) in names.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err(Failure::Cancelled);
        }
        progress(at as u64, total);
        let split = parts(name).map_err(Failure::Failed)?;
        let outside = split.len() <= strip || (strip == 1 && split[0] != "webapp");
        if outside || *dir {
            skipped += usize::from(!*dir);
            continue;
        }
        let rel = &split[strip..];
        let target = if let Some(kept) = legal_name(rel) {
            into.join("legal").join(kept)
        } else if rel[0].eq_ignore_ascii_case("WEB-INF")
            || rel[0].eq_ignore_ascii_case("META-INF")
            || !allowed(rel[rel.len() - 1])
        {
            // The server's files, and kinds of file a web app is not made of.
            skipped += 1;
            continue;
        } else {
            rel.iter()
                .fold(into.to_path_buf(), |path, part| path.join(part))
        };
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(io_failed("make a folder for the editor"))?;
        }
        let mut entry = archive
            .by_index(at)
            .map_err(|err| Failure::Failed(format!("The download cannot be read: {err}")))?;
        let mut out = File::create_new(&target).map_err(io_failed("unpack a file"))?;
        let room = limits.bytes - written;
        let copied = io::copy(&mut (&mut entry).take(room + 1), &mut out)
            .map_err(io_failed("unpack a file"))?;
        written += copied;
        if written > limits.bytes {
            return failed("The download unpacks to more than KastenFlow allows");
        }
        files += 1;
    }
    progress(total, total);
    Ok(Unpacked { files, skipped })
}
