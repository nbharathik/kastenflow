//! `smart_check`: what is wrong with a smart page's files, said so a model can
//! fix it. Each finding has a severity (`error` stops the page working,
//! `warning` is likely to be a mistake, `info` is worth knowing), the file, the
//! line when there is one, and a sentence that says what to change. It reads
//! the files and runs nothing; the page itself runs only in the app.

mod html;
mod net;
mod queries;

use std::collections::HashSet;

use kasten_core::smart::{
    DEFAULT_KIT, INDEX_FILE, MANIFEST_FILE, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES,
    SmartListing,
};
use kasten_core::{Kasten, Result};
use serde::Serialize;
use serde_json::{Value, json};

use super::smart::smart_page;
use crate::params_smart::SmartCheckArgs;

/// The kit versions this program knows (`smart://kit/<version>/`).
const KNOWN_KITS: [&str; 1] = [DEFAULT_KIT];

#[derive(Debug, Clone, PartialEq, Serialize)]
pub(super) struct Finding {
    /// `error`, `warning` or `info`.
    pub severity: &'static str,
    pub file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    pub message: String,
}

impl Finding {
    pub fn new(severity: &'static str, file: &str, line: Option<u32>, message: String) -> Finding {
        Finding {
            severity,
            file: file.to_owned(),
            line,
            message,
        }
    }
}

/// The most findings one file may give (a hostile file would give millions).
pub(super) const PER_FILE: usize = 60;
/// The most findings the whole answer holds.
const TOTAL: usize = 200;
/// The most files of a folder that are read (a folder filled by hand may hold thousands).
const FILES_READ: usize = 600;

/// Where the lines of a text begin, found once, so that asking for the line of
/// a place is a search and not a count from the top.
pub(super) struct Lines(Vec<usize>);

impl Lines {
    pub fn new(text: &str) -> Lines {
        Lines(
            text.bytes()
                .enumerate()
                .filter(|(_, b)| *b == b'\n')
                .map(|(at, _)| at)
                .collect(),
        )
    }

    /// The line (from 1) that byte `at` is on.
    pub fn of(&self, at: usize) -> u32 {
        let before = self.0.partition_point(|&newline| newline < at);
        u32::try_from(before + 1).unwrap_or(u32::MAX)
    }
}

fn extension(path: &str) -> String {
    path.rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default()
}

/// `reference` as written in the file `from`, as a path in the folder; none
/// when it climbs out of the folder.
fn resolve(from: &str, reference: &str) -> Option<String> {
    let mut parts: Vec<&str> = from.split('/').collect();
    parts.pop();
    for part in reference.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            other => parts.push(other),
        }
    }
    Some(parts.join("/"))
}

/// Sizes, names and the shape of the folder.
fn folder_findings(k: &Kasten, listing: &SmartListing) -> Vec<Finding> {
    let mut out = Vec::new();
    let limit = k.config().guardrails.max_write_bytes;
    for f in &listing.files {
        if !f.allowed {
            out.push(Finding::new(
                "error",
                &f.path,
                None,
                "A smart page may not have this file (only html, js, css, json, svg, png, webp, jpg and txt files, no hidden ones, and smart.yaml). Take it out with smart_delete_file".to_owned(),
            ));
        }
        if f.size > MAX_FILE_BYTES {
            out.push(Finding::new(
                "error",
                &f.path,
                None,
                format!(
                    "The file is {} KB; a file in a smart page may be at most {} KB. Split it into smaller files",
                    f.size / 1024,
                    MAX_FILE_BYTES / 1024
                ),
            ));
        } else if f.size > limit && f.allowed {
            out.push(Finding::new(
                "warning",
                &f.path,
                None,
                format!(
                    "The file is {} KB, more than the {} KB you can write at once. Change it in pieces with smart_edit, or split it into smaller files",
                    f.size / 1024,
                    limit / 1024
                ),
            ));
        }
    }
    if listing.total_bytes > MAX_TOTAL_BYTES {
        out.push(Finding::new(
            "error",
            "",
            None,
            format!(
                "The folder holds {} KB; a smart page may hold at most {} KB in all",
                listing.total_bytes / 1024,
                MAX_TOTAL_BYTES / 1024
            ),
        ));
    }
    if listing.files.len() > MAX_FILES {
        out.push(Finding::new(
            "error",
            "",
            None,
            format!(
                "The folder holds {} files; at most {MAX_FILES} are allowed",
                listing.files.len()
            ),
        ));
    }
    if !listing.files.iter().any(|f| f.path == INDEX_FILE) {
        out.push(Finding::new(
            "error",
            INDEX_FILE,
            None,
            "There is no index.html, so the page shows nothing. Write one with smart_write_file"
                .to_owned(),
        ));
    }
    out
}

/// The kit the manifest names, and whether the page loads it.
fn kit_findings(k: &Kasten, page: &str, listing: &SmartListing) -> Vec<Finding> {
    let mut out = Vec::new();
    match &listing.manifest {
        None => {
            if !listing.files.iter().any(|f| f.path == MANIFEST_FILE) {
                out.push(Finding::new(
                    "error",
                    MANIFEST_FILE,
                    None,
                    "There is no smart.yaml. Write one with a title and the kit version (version: 1, title: …, kit: \"1\")".to_owned(),
                ));
            }
        }
        Some(manifest) => {
            if !KNOWN_KITS.contains(&manifest.kit.trim()) {
                out.push(Finding::new(
                    "error",
                    MANIFEST_FILE,
                    None,
                    format!(
                        "The kit version “{}” is not one this version of KastenFlow has. Use kit: \"{DEFAULT_KIT}\"",
                        manifest.kit
                    ),
                ));
            }
            let named = k
                .smart_file(page, MANIFEST_FILE)
                .ok()
                .and_then(|f| f.text().map(str::to_owned))
                .is_some_and(|text| text.lines().any(|l| l.starts_with("kit:")));
            if !named {
                out.push(Finding::new(
                    "warning",
                    MANIFEST_FILE,
                    None,
                    format!("smart.yaml does not name a kit version, so the page gets “{DEFAULT_KIT}”. Say kit: \"{DEFAULT_KIT}\" so it stays that way"),
                ));
            }
        }
    }
    out
}

pub(crate) fn smart_check(k: &Kasten, a: SmartCheckArgs) -> Result<Value> {
    let note = smart_page(k, &a.page)?;
    let page = note.meta.path.clone();
    let listing = k.smart_read(&page)?;
    let mut found = Vec::new();
    if !listing.exists {
        found.push(Finding::new(
            "error",
            "",
            None,
            "The page has no folder yet. Write an index.html with smart_write_file".to_owned(),
        ));
    }
    found.extend(folder_findings(k, &listing));
    found.extend(kit_findings(k, &page, &listing));
    // A manifest that does not read is the one problem the listing has to say.
    if listing.manifest.is_none()
        && listing.files.iter().any(|f| f.path == MANIFEST_FILE)
        && let Some(why) = listing.problems.iter().find(|p| p.contains(MANIFEST_FILE))
    {
        found.push(Finding::new("error", MANIFEST_FILE, None, why.clone()));
    }
    if let Some(manifest) = &listing.manifest {
        found.extend(queries::findings(k, manifest));
        for (name, view) in &manifest.views {
            if let Some(entry) = &view.entry
                && !listing.files.iter().any(|f| f.path == *entry)
            {
                found.push(Finding::new(
                    "error",
                    MANIFEST_FILE,
                    None,
                    format!("The view “{name}” shows {entry}, which is not in the folder"),
                ));
            }
        }
    }
    let manifest_kit = listing.manifest.as_ref().map(|m| m.kit.trim().to_owned());
    let known: HashSet<&str> = listing.files.iter().map(|f| f.path.as_str()).collect();
    let mut used: HashSet<String> = HashSet::new();
    if listing.files.len() > FILES_READ {
        found.push(Finding::new(
            "warning",
            "",
            None,
            format!(
                "The folder holds {} files; only the first {FILES_READ} are read here. Take out the files the page does not use",
                listing.files.len()
            ),
        ));
    }
    for f in listing
        .files
        .iter()
        .take(FILES_READ)
        .filter(|f| f.allowed && f.size <= MAX_FILE_BYTES)
    {
        let ext = extension(&f.path);
        if !matches!(ext.as_str(), "html" | "js" | "css" | "svg") {
            continue;
        }
        let Some(text) = k
            .smart_file(&page, &f.path)
            .ok()
            .and_then(|b| b.text().map(str::to_owned))
        else {
            continue;
        };
        if text.trim().is_empty() {
            found.push(Finding::new(
                "error",
                &f.path,
                None,
                "The file is empty".to_owned(),
            ));
        }
        found.extend(net::findings(&f.path, &text));
        if ext != "html" {
            continue;
        }
        let (tags, mut problems) = html::parse(&f.path, &text);
        found.append(&mut problems);
        for (line, reference) in html::local_refs(&tags).into_iter().take(PER_FILE * 5) {
            match resolve(&f.path, &reference) {
                Some(target) if known.contains(target.as_str()) => {
                    used.insert(target);
                }
                Some(target) => found.push(Finding::new(
                    "error",
                    &f.path,
                    Some(line),
                    format!("It loads {reference}, which is not in the page's folder (looked for {target}). Write that file or fix the name"),
                )),
                None => found.push(Finding::new(
                    "error",
                    &f.path,
                    Some(line),
                    format!("{reference} points outside the page's folder, which a page cannot load"),
                )),
            }
        }
        let kits = html::kit_versions(&tags);
        for (line, version) in &kits {
            if !KNOWN_KITS.contains(&version.as_str()) {
                found.push(Finding::new(
                    "error",
                    &f.path,
                    Some(*line),
                    format!("It loads kit version “{version}”, which this version of KastenFlow does not have. Use smart://kit/{DEFAULT_KIT}/"),
                ));
            } else if manifest_kit.as_deref().is_some_and(|m| m != version) {
                found.push(Finding::new(
                    "warning",
                    &f.path,
                    Some(*line),
                    format!("It loads kit version {version}, but smart.yaml says {}. Make them the same", manifest_kit.as_deref().unwrap_or("")),
                ));
            }
        }
        if f.path == INDEX_FILE && kits.is_empty() {
            found.push(Finding::new(
                "info",
                &f.path,
                None,
                format!("index.html does not load the kit (<script src=\"smart://kit/{DEFAULT_KIT}/kit.js\"></script>), so kasten.query and the components are not there. Fine if the page needs neither"),
            ));
        }
    }
    for f in &listing.files {
        let ext = extension(&f.path);
        if matches!(ext.as_str(), "js" | "css")
            && !used.contains(&f.path)
            && !f.path.starts_with("data/")
        {
            found.push(Finding::new(
                "info",
                &f.path,
                None,
                "No html file of the page loads this file".to_owned(),
            ));
        }
    }
    let rank = |s: &str| match s {
        "error" => 0,
        "warning" => 1,
        _ => 2,
    };
    found.sort_by(|x, y| {
        (rank(x.severity), &x.file, x.line).cmp(&(rank(y.severity), &y.file, y.line))
    });
    let count = |s: &str| found.iter().filter(|f| f.severity == s).count();
    let (errors, warnings) = (count("error"), count("warning"));
    let left_out = found.len().saturating_sub(TOTAL);
    found.truncate(TOTAL);
    let summary = if errors + warnings == 0 {
        "Found no problems in the files. That is not a promise that the page is safe or that it works: this reads the text and does not run the page. Open the page in the app, then read it with smart_read to see the errors it reports.".to_owned()
    } else {
        format!(
            "{errors} error{} and {warnings} warning{} to fix",
            if errors == 1 { "" } else { "s" },
            if warnings == 1 { "" } else { "s" }
        )
    };
    Ok(json!({
        "page": page,
        "foundNoErrors": errors == 0,
        "errors": errors,
        "warnings": warnings,
        "summary": summary,
        "findings": found,
        "leftOut": left_out,
    }))
}
