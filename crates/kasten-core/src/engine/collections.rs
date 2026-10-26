//! Saved collections kept as `views/<slug>.yaml`: creating, updating,
//! renaming, trashing and restoring them. Each is one commit that Undo takes
//! back. Only a person saves a collection. An edit changes the lines of the
//! keys it names and nothing else, and is refused if the file is not as the
//! caller last saw it.

use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use serde_json::{Map, Value};

use super::{Change, Kasten, Problem};
use crate::atomic::write_atomic;
use crate::collections::{self, Collection, DIR, FORMAT};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::index::parse_query;
use crate::ops::free_file;
use crate::rollback::Rollback;
use crate::slug::slugify;
use crate::time::Instant;
use crate::vault::Vault;

fn people_only(actor: &Actor) -> Result<()> {
    if actor.is_agent() {
        return Err(Error::Invalid(
            "A person saves collections; an agent may read them".to_owned(),
        ));
    }
    Ok(())
}

fn stale() -> Error {
    Error::Invalid(
        "This collection changed since you opened it. Open it again and make the change once more"
            .to_owned(),
    )
}

/// The file of the collection at `path`, checked to be one.
fn file_of(vault: &Vault, path: &str) -> Result<PathBuf> {
    if !collections::is_path(path) {
        return Err(Error::InvalidPath(path.to_owned()));
    }
    vault.file_of(path, &[".yaml"])
}

fn modified(file: &std::path::Path) -> u64 {
    fs::metadata(file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

/// The collection at `path` and its text, as the file is now.
fn load(vault: &Vault, path: &str) -> Result<(PathBuf, String, Collection)> {
    let file = file_of(vault, path)?;
    let text = match fs::read_to_string(&file) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Err(Error::NotFound(path.to_owned()));
        }
        Err(err) if err.kind() == std::io::ErrorKind::InvalidData => {
            return Ok((
                file.clone(),
                String::new(),
                collections::unreadable(path, "This file is not text", modified(&file)),
            ));
        }
        Err(err) => return Err(err.into()),
    };
    let found = collections::read(path, &text, modified(&file));
    Ok((file, text, found))
}

/// Whether the file name `stem` is `slug` or `slug-2`, `slug-3`...
fn numbered_from(stem: &str, slug: &str) -> bool {
    stem == slug
        || stem
            .strip_prefix(slug)
            .and_then(|rest| rest.strip_prefix('-'))
            .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// A collection that can be edited, or the sentence that says why not.
fn writable(found: &Collection) -> Result<()> {
    match (&found.problem, found.read_only) {
        (Some(why), _) => Err(Error::Invalid(why.clone())),
        (None, true) => Err(Error::Invalid(
            "This collection cannot be changed".to_owned(),
        )),
        (None, false) => Ok(()),
    }
}

impl Kasten {
    /// Every saved collection, by name. One that cannot be used (unreadable,
    /// not a collection, or made by a newer version) is listed with the
    /// reason in `problem` and cannot be edited.
    pub fn collections(&self) -> Result<Vec<Collection>> {
        let mut out = Vec::new();
        for stat in self.vault.files_in(DIR, ".yaml")? {
            if !collections::is_path(&stat.path) {
                continue;
            }
            if let Ok((_, _, found)) = load(&self.vault, &stat.path) {
                out.push(found);
            }
        }
        // The same name, then the file names without their ending, so
        // `name` comes before `name-2`.
        out.sort_by_cached_key(|c| (c.name.to_lowercase(), c.slug.clone()));
        Ok(out)
    }

    /// The collection at `path` (`views/<name>.yaml`).
    pub fn collection(&self, path: &str) -> Result<Collection> {
        load(&self.vault, path).map(|(_, _, found)| found)
    }

    /// Saves a new collection called `name` in `views/`: the file name is the
    /// name as a slug, numbered when taken. `edits` set its keys (`icon`,
    /// `query`, `when`, `filter`, `sort`, `display`); every value is checked
    /// before anything is written.
    pub fn create_collection(
        &self,
        actor: &Actor,
        name: &str,
        edits: &Map<String, Value>,
        now: Instant,
    ) -> Result<Collection> {
        people_only(actor)?;
        self.create_collection_as(actor, name, edits, now)
    }

    /// `create_collection` for any actor: an agent's goes through the modes
    /// (`parity_refusals`) before it gets here.
    pub(super) fn create_collection_as(
        &self,
        actor: &Actor,
        name: &str,
        edits: &Map<String, Value>,
        now: Instant,
    ) -> Result<Collection> {
        let text = collections::new_text(name, edits)?;
        let name = name.trim();
        self.apply(actor, "create_collection", false, now.millis, |vault| {
            let path = free_file(vault, DIR, &slugify(name), ".yaml");
            let file = file_of(vault, &path)?;
            let mut undo = Rollback::default();
            undo.create(&file, text.as_bytes())?;
            Ok(Change {
                message: format!("collection: create {name}"),
                value: collections::read(&path, &text, modified(&file)),
                paths: vec![path],
            })
        })
    }

    /// Changes the keys `edits` names in the collection at `path`, a key set
    /// to `null` going; every other line stays as written. Refused if the
    /// file is no longer as `base_hash` says, if it cannot be edited, or if a
    /// value is not allowed. Saying what is already so writes nothing.
    pub fn update_collection(
        &self,
        actor: &Actor,
        path: &str,
        edits: &Map<String, Value>,
        base_hash: &str,
        now: Instant,
    ) -> Result<Collection> {
        people_only(actor)?;
        self.update_collection_as(actor, path, edits, base_hash, now)
    }

    /// `update_collection` for any actor, as `create_collection_as`.
    pub(super) fn update_collection_as(
        &self,
        actor: &Actor,
        path: &str,
        edits: &Map<String, Value>,
        base_hash: &str,
        now: Instant,
    ) -> Result<Collection> {
        self.apply(actor, "update_collection", false, now.millis, |vault| {
            let (file, text, found) = load(vault, path)?;
            writable(&found)?;
            if found.hash != base_hash {
                return Err(stale());
            }
            let edited = collections::edit_text(&text, edits)?;
            if edited == text {
                return Ok(Change {
                    message: String::new(),
                    paths: Vec::new(),
                    value: found,
                });
            }
            // What is written must still be a collection.
            if let Some(why) = collections::read(path, &edited, 0).problem {
                return Err(Error::Invalid(why));
            }
            write_atomic(&file, edited.as_bytes())?;
            Ok(Change {
                message: format!("collection: edit {}", found.name),
                value: collections::read(path, &edited, modified(&file)),
                paths: vec![path.to_owned()],
            })
        })
    }

    /// Gives the collection at `path` another name: its `name` line changes
    /// and its file moves to the new name's slug (numbered when taken, left
    /// in place when the slug is the same). Refused as `update_collection` is.
    pub fn rename_collection(
        &self,
        actor: &Actor,
        path: &str,
        name: &str,
        base_hash: &str,
        now: Instant,
    ) -> Result<Collection> {
        people_only(actor)?;
        self.apply(actor, "rename_collection", false, now.millis, |vault| {
            let (file, text, found) = load(vault, path)?;
            writable(&found)?;
            if found.hash != base_hash {
                return Err(stale());
            }
            let renamed = collections::rename_text(&text, name)?;
            let name = name.trim();
            let slug = slugify(name);
            // Its own file name, numbered or not, is free to it.
            let target = if numbered_from(collections::slug_of(path), &slug) {
                path.to_owned()
            } else {
                free_file(vault, DIR, &slug, ".yaml")
            };
            let mut done = Rollback::default();
            let moved = (|| -> Result<()> {
                done.write(&file, renamed.as_bytes(), Some(text.clone().into_bytes()))?;
                if target != path {
                    done.rename(&file, &file_of(vault, &target)?)?;
                }
                Ok(())
            })();
            if let Err(err) = moved {
                done.put_back();
                return Err(err);
            }
            let mut paths = vec![path.to_owned()];
            if target != path {
                paths.push(target.clone());
            }
            Ok(Change {
                message: format!("collection: rename {} → {name}", found.name),
                value: collections::read(&target, &renamed, modified(&file_of(vault, &target)?)),
                paths,
            })
        })
    }

    /// Moves the collection at `path` to `.trash/`; returns where it went. A
    /// file that cannot be used can be trashed too.
    pub fn trash_collection(&self, actor: &Actor, path: &str, now: Instant) -> Result<String> {
        people_only(actor)?;
        self.apply(actor, "trash_collection", false, now.millis, |vault| {
            let (_, _, found) = load(vault, path)?;
            let trashed = crate::trash::trash_collection(vault, path, now)?;
            Ok(Change {
                message: format!("trash: collection {}", found.name),
                paths: vec![path.to_owned(), trashed.clone()],
                value: trashed,
            })
        })
    }

    /// Puts a trashed collection back, under a free name if its own is taken.
    pub fn restore_collection(&self, actor: &Actor, trashed: &str) -> Result<Collection> {
        people_only(actor)?;
        self.apply(
            actor,
            "restore_collection",
            false,
            Instant::now().millis,
            |vault| {
                let path = crate::trash::restore_collection(vault, trashed)?;
                let (_, _, found) = load(vault, &path)?;
                Ok(Change {
                    message: format!("restore: collection {}", found.name),
                    paths: vec![trashed.to_owned(), path],
                    value: found,
                })
            },
        )
    }

    /// What is wrong with the saved collections, for `verify`: a file that
    /// cannot be read as one, and a query that names (by `under:` or
    /// `project:`) a page or a project that is no longer there. A file from a
    /// newer version is not a problem.
    pub fn collection_problems(&self) -> Result<Vec<Problem>> {
        let mut out = Vec::new();
        let problem = |kind: &str, path: &str, detail: String| Problem {
            kind: kind.to_owned(),
            path: Some(path.to_owned()),
            detail,
        };
        for found in self.collections()? {
            if found.format > FORMAT && found.problem.is_some() {
                continue;
            }
            if let Some(why) = &found.problem {
                out.push(problem("collection", &found.path, why.clone()));
                continue;
            }
            let (_, filters) = parse_query(&found.query);
            if let Some(root) = filters.under
                && self.index().under(&root)?.is_empty()
            {
                out.push(problem(
                    "collection-reference",
                    &found.path,
                    format!(
                        "“{}” looks under {root}, which is not a page any more",
                        found.name
                    ),
                ));
            }
            if let Some(project) = filters.project {
                let plain = !project.is_empty() && !project.contains(['/', '\\', ':', '.']);
                if !plain || !self.root().join("projects").join(&project).is_dir() {
                    out.push(problem(
                        "collection-reference",
                        &found.path,
                        format!(
                            "“{}” looks in the project {project}, which is not there any more",
                            found.name
                        ),
                    ));
                }
            }
        }
        Ok(out)
    }
}
