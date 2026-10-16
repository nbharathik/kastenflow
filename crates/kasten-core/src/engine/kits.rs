//! Starter kits: a way of working added to a vault in one step. Each kit is
//! a folder in `defaults/kits/` laid out as it lands in the vault (pages,
//! templates, tag schemas, boards) with a `kit.json` naming it and its
//! home page. `{{id:name}}` in a kit file becomes a fresh id when it is
//! added, the same one wherever the name recurs, so sub-pages point at
//! their home page. Adding is one commit that undo takes back. A file the
//! vault has is kept, unless it is still a starter file exactly as Kasten
//! shipped it; a kit whose home page exists is refused, and so is an agent.

use std::collections::HashMap;
use std::fs;

use serde::{Deserialize, Serialize};

use super::init::{TAGS, TEMPLATES};
use super::{Change, Kasten};
use crate::atomic::{create_atomic, read_if_there, write_atomic};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::id::ulid_at;
use crate::templated::is_old_journal_template;
use crate::time::Instant;
use crate::vault::Vault;

struct Kit {
    id: &'static str,
    manifest: &'static str,
    files: &'static [(&'static str, &'static str)],
}

macro_rules! kit {
    ($id:literal: $($path:literal),* $(,)?) => {
        Kit {
            id: $id,
            manifest: include_str!(concat!("../../defaults/kits/", $id, "/kit.json")),
            files: &[$(($path, include_str!(concat!("../../defaults/kits/", $id, "/", $path)))),*],
        }
    };
}

/// In the order they are offered.
const KITS: [Kit; 6] = [
    kit!("daily-planner":
        "library/daily-planner.md", "library/how-to-plan-a-day.md", "tags/task.yaml",
        "templates/journal.md",
    ),
    kit!("second-brain":
        "library/health.md", "library/second-brain.md", "tags/area.yaml", "tags/resource.yaml",
        "templates/journal.md",
    ),
    kit!("zettelkasten":
        "library/idea-map.canvas", "library/start-here.md", "library/zettelkasten.md",
        "tags/fleeting.yaml", "tags/literature.yaml", "tags/permanent.yaml", "templates/journal.md",
    ),
    kit!("gtd":
        "library/getting-things-done.md", "library/weekly-review-checklist.md", "tags/action.yaml",
        "templates/journal.md", "templates/next-action.md",
    ),
    kit!("student":
        "library/how-to-study.md", "library/student.md", "tags/assignment.yaml", "tags/course.yaml",
        "templates/assignment.md", "templates/journal.md",
    ),
    kit!("research":
        "library/research-questions.md", "library/research.md", "tags/experiment.yaml",
        "tags/paper.yaml", "tags/reading.yaml", "templates/journal.md",
    ),
];

#[derive(Deserialize)]
struct Manifest {
    icon: String,
    name: String,
    summary: String,
    home: String,
    #[serde(default)]
    recommended: bool,
}

/// A kit as the app offers it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KitInfo {
    pub id: String,
    /// An emoji, as its home page has.
    pub icon: String,
    pub name: String,
    pub summary: String,
    /// The page that explains it and opens once it is added.
    pub home: String,
    pub recommended: bool,
    /// Where each of its files goes in the vault.
    pub files: Vec<String>,
}

/// What adding a kit did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddedKit {
    pub home: String,
    /// Files written, new or in place of an untouched starter file.
    pub written: Vec<String>,
    /// The vault's own files at the kit's paths, left as they are.
    pub kept: Vec<String>,
    /// The commit, for undoing it; none in a vault without history.
    pub commit: Option<String>,
}

fn manifest(kit: &Kit) -> Manifest {
    // The manifests ship with the app, and a test reads every one.
    serde_json::from_str(kit.manifest).unwrap_or_else(|_| Manifest {
        icon: String::new(),
        name: kit.id.to_owned(),
        summary: String::new(),
        home: String::new(),
        recommended: false,
    })
}

/// Every starter kit.
pub fn kits() -> Vec<KitInfo> {
    KITS.iter()
        .map(|kit| {
            let m = manifest(kit);
            KitInfo {
                id: kit.id.to_owned(),
                icon: m.icon,
                name: m.name,
                summary: m.summary,
                home: m.home,
                recommended: m.recommended,
                files: kit.files.iter().map(|(p, _)| (*p).to_owned()).collect(),
            }
        })
        .collect()
}

/// Whether `bytes` at `path` are a starter file exactly as Kasten shipped
/// it (a journal template too, as older vaults were given it).
fn stock(path: &str, bytes: &[u8]) -> bool {
    let shipped = |list: &[(&str, &str)], dir: &str| {
        list.iter()
            .any(|(file, text)| path == format!("{dir}/{file}") && bytes == text.as_bytes())
    };
    shipped(&TEMPLATES, "templates")
        || shipped(&TAGS, "tags")
        || (path == "templates/journal.md"
            && std::str::from_utf8(bytes).is_ok_and(is_old_journal_template))
}

/// `text` with each `{{id:name}}` replaced by the id made for `name`.
pub(super) fn with_ids(text: &str, ids: &mut HashMap<String, String>, now: Instant) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("{{id:") {
        out.push_str(&rest[..at]);
        let after = &rest[at + 5..];
        let Some(end) = after.find("}}") else {
            out.push_str(&rest[at..]);
            return out;
        };
        let name = &after[..end];
        let id = ids
            .entry(name.to_owned())
            .or_insert_with(|| ulid_at(now.millis));
        out.push_str(id);
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    out
}

/// Writes the kit's files, keeping any the vault has of its own.
fn write_kit(vault: &Vault, files: &[(String, String)]) -> Result<(Vec<String>, Vec<String>)> {
    let mut written = Vec::new();
    let mut kept = Vec::new();
    for (path, text) in files {
        let file = vault.file_of(path, &[".md", ".yaml", ".canvas"])?;
        match read_if_there(&file)? {
            None => {
                if let Some(dir) = file.parent() {
                    fs::create_dir_all(dir)?;
                }
                match create_atomic(&file, text.as_bytes()) {
                    Ok(()) => written.push(path.clone()),
                    // Made meanwhile: it is theirs.
                    Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                        kept.push(path.clone());
                    }
                    Err(err) => return Err(err.into()),
                }
            }
            // Already the kit's own: nothing to write.
            Some(bytes) if bytes == text.as_bytes() => {}
            Some(bytes) if stock(path, &bytes) => {
                write_atomic(&file, text.as_bytes())?;
                written.push(path.clone());
            }
            Some(_) => kept.push(path.clone()),
        }
    }
    kept.sort();
    Ok((written, kept))
}

impl Kasten {
    /// Adds the starter kit `id` in one commit, trailered `Kasten-Kit`.
    pub fn add_kit(&self, actor: &Actor, id: &str, now: Instant) -> Result<AddedKit> {
        if actor.is_agent() {
            return Err(Error::Invalid(
                "Starter kits are added by the person, not by an agent".to_owned(),
            ));
        }
        let kit = KITS
            .iter()
            .find(|k| k.id == id)
            .ok_or_else(|| Error::Invalid(format!("There is no starter kit “{id}”")))?;
        let m = manifest(kit);
        if self.vault.exists(&m.home) {
            return Err(Error::Invalid(format!(
                "{} is already in this vault: its page is {}",
                m.name, m.home
            )));
        }
        let mut ids = HashMap::new();
        let files: Vec<(String, String)> = kit
            .files
            .iter()
            .map(|(path, text)| ((*path).to_owned(), with_ids(text, &mut ids, now)))
            .collect();
        let message = format!("kit: add {}", m.name);
        let trailers = [("Kasten-Kit", id.to_owned())];
        let ((written, kept), commit) =
            self.apply_committing(actor, "add_kit", false, now.millis, &trailers, |vault| {
                let (written, kept) = write_kit(vault, &files)?;
                Ok(Change {
                    message,
                    paths: written.clone(),
                    value: (written, kept),
                })
            })?;
        Ok(AddedKit {
            home: m.home,
            written,
            kept,
            commit,
        })
    }
}
