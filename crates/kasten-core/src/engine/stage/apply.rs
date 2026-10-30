//! Applying a change set: the person's decision to write what the chat
//! staged. Everything is checked first, under the write lock, and nothing is
//! written unless every file can be; then the files, the new files and the
//! pictures are written and committed together, as the agent's change
//! approved by the person, so Undo session takes them all back.

use std::collections::{BTreeMap, HashSet};

use super::super::asset_add::{keep, prepare};
use super::super::deck_agent::applied;
use super::super::{Change, Kasten};
use super::merge::merge_note;
use crate::agent::{ApplyOutcome, ChangeSet, Dropped, FileKind, NewFile};
use crate::assets::NewAsset;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::note::meta_for;
use crate::ops::{folder_of, free_file_besides};
use crate::rollback::Rollback;
use crate::time::Instant;

/// A file of the vault the set changes, and what it becomes.
struct Write {
    path: String,
    kind: FileKind,
    text: String,
    /// What the file holds now.
    before: String,
}

/// What the set comes to against the vault as it is now.
struct Plan {
    writes: Vec<Write>,
    /// New files with the path each will get.
    created: Vec<(NewFile, String)>,
    stale: Vec<String>,
}

fn extension(kind: FileKind) -> &'static str {
    match kind {
        FileKind::Note => ".md",
        FileKind::Deck => ".deck",
        FileKind::Diagram => crate::diagrams::EXT,
        FileKind::Board => ".canvas",
    }
}

/// `text` with the path `old` named `new` instead, where `old` is a whole
/// path and not the start of a longer name.
fn renamed(text: &str, old: &str, new: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(old) {
        let after = &rest[at + old.len()..];
        let longer = after
            .chars()
            .next()
            .is_some_and(|c| c.is_alphanumeric() || c == '-' || c == '_');
        out.push_str(&rest[..at]);
        out.push_str(if longer { old } else { new });
        rest = after;
    }
    out.push_str(rest);
    out
}

impl Kasten {
    /// Whether each file of the set can still be put together with the vault
    /// as it is, and where the new files would go.
    fn classify(&self, set: &ChangeSet, stamp: &str) -> Result<Plan> {
        let mut plan = Plan {
            writes: Vec::new(),
            created: Vec::new(),
            stale: Vec::new(),
        };
        for (path, file) in &set.files {
            let now = match self.version_of(path, file.kind) {
                Ok(now) => now,
                // A file that is gone cannot be written to.
                Err(Error::NotFound(_)) => {
                    plan.stale.push(path.clone());
                    continue;
                }
                Err(other) => return Err(other),
            };
            let text = if now.hash == file.base_hash {
                file.text.clone()
            } else if now.text == file.text {
                now.text.clone()
            } else {
                let merged = match file.kind {
                    FileKind::Note => merge_note(&file.base, &file.text, &now.text, stamp),
                    FileKind::Deck => applied(&file.base, &file.text, &now.text).ok(),
                    FileKind::Diagram => super::apply_diagrams::replayed(set, path, &now.text),
                    FileKind::Board => None,
                };
                match merged {
                    Some(text) => text,
                    None => {
                        plan.stale.push(path.clone());
                        continue;
                    }
                }
            };
            if text != now.text {
                plan.writes.push(Write {
                    path: path.clone(),
                    kind: file.kind,
                    text,
                    before: now.text,
                });
            }
        }
        let mut taken: HashSet<String> = HashSet::new();
        for file in &set.created_files {
            let ext = extension(file.kind);
            let path = if self
                .vault
                .file_of(&file.provisional, &[ext])
                .is_ok_and(|p| {
                    !taken.contains(&file.provisional) && std::fs::symlink_metadata(p).is_err()
                }) {
                file.provisional.clone()
            } else if file.op == "journal_append" {
                // A journal day has the one name there is.
                plan.stale.push(file.provisional.clone());
                continue;
            } else {
                let stem = file
                    .provisional
                    .rsplit('/')
                    .next()
                    .and_then(|n| n.strip_suffix(ext))
                    .unwrap_or("note");
                free_file_besides(&self.vault, folder_of(&file.provisional), stem, ext, &taken)
            };
            taken.insert(path.clone());
            plan.created.push((file.clone(), path));
        }
        Ok(plan)
    }

    /// The files of the set that cannot be put together with the vault as it
    /// is now: applying the set would write nothing.
    pub fn stale_changes(&self, set: &ChangeSet, now: Instant) -> Result<Vec<String>> {
        Ok(self.classify(set, &now.rfc3339())?.stale)
    }

    /// Writes the set, as one commit: `Applied`, or `Stale` with the files
    /// that changed since they were staged in a way that cannot be put
    /// together with the set, and nothing written for any of them. The
    /// guardrails that no trust lifts are weighed again, so a note locked
    /// after it was staged stops the whole set. Applying is the person's
    /// decision, so the soft limits do not count it.
    pub fn apply_changes(&self, set: &ChangeSet, by: &str, now: Instant) -> Result<ApplyOutcome> {
        let _turn = self
            .agent_turn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let actor = Actor::Approved {
            client: set.client.clone(),
            session: set.session.clone(),
            by: by.to_owned(),
        };
        // The pictures' bytes, read before the lock is taken.
        let dir = self.changes_dir(&set.id)?.join(super::ASSETS_FOLDER);
        let mut bytes = Vec::new();
        for asset in &set.assets {
            bytes.push(std::fs::read(dir.join(&asset.file)).map_err(|err| {
                Error::Invalid(format!(
                    "The staged picture {} cannot be read ({err}), so the changes cannot be applied",
                    asset.name
                ))
            })?);
        }
        let trailers = [("Kasten-Change-Set", set.id.clone())];
        let applied = self.apply_committing(
            &actor,
            "apply_changes",
            false,
            now.millis,
            &trailers,
            |vault| {
                // The guardrails that no trust lifts, once more. A file that is
                // gone is not a refusal: it makes the set stale, below.
                let gone = |result: Result<()>| match result {
                    Err(Error::NotFound(_)) => Ok(()),
                    other => other,
                };
                for step in &set.steps {
                    if let Some(op) = &step.op {
                        gone(self.applying_refusals(set, op))?;
                    }
                }
                for path in set.files.keys() {
                    gone(self.writable(path))?;
                }
                let plan = self.classify(set, &now.rfc3339())?;
                if !plan.stale.is_empty() {
                    return Ok(Change {
                        message: String::new(),
                        paths: Vec::new(),
                        value: ApplyOutcome::Stale { files: plan.stale },
                    });
                }
                let mut undo = Rollback::default();
                let written = (|| -> Result<Vec<String>> {
                    let mut paths = Vec::new();
                    let mut texts: BTreeMap<String, String> = BTreeMap::new();
                    // Pictures first: their names decide what the texts say.
                    let mut renames: Vec<(String, String)> = Vec::new();
                    for (asset, bytes) in set.assets.iter().zip(&bytes) {
                        let picture = prepare(&actor, &asset.name, bytes, &NewAsset::default())?;
                        let kept = keep(vault, &picture, now, &mut |_, _| Ok(()))?;
                        undo.append(kept.undo);
                        paths.extend(kept.paths);
                        if kept.added.path != asset.provisional {
                            renames.push((asset.provisional.clone(), kept.added.path));
                        }
                    }
                    for (file, path) in &plan.created {
                        if *path != file.provisional {
                            renames.push((file.provisional.clone(), path.clone()));
                            if let Some(bare) = file.provisional.strip_suffix(extension(file.kind))
                            {
                                let now_bare =
                                    path.strip_suffix(extension(file.kind)).unwrap_or(path);
                                renames.push((bare.to_owned(), now_bare.to_owned()));
                            }
                        }
                    }
                    let fixed = |text: &str| {
                        renames
                            .iter()
                            .fold(text.to_owned(), |t, (old, new)| renamed(&t, old, new))
                    };
                    let mut done = 0;
                    for write in &plan.writes {
                        self.may_fail_changes_write(done)?;
                        let file = vault.file_of(&write.path, &[extension(write.kind)])?;
                        let text = fixed(&write.text);
                        undo.write(
                            &file,
                            text.as_bytes(),
                            Some(write.before.clone().into_bytes()),
                        )?;
                        if write.kind == FileKind::Diagram {
                            super::apply_diagrams::keep_draft(
                                vault,
                                &mut undo,
                                &write.path,
                                &text,
                                &mut paths,
                            )?;
                        }
                        texts.insert(write.path.clone(), text);
                        paths.push(write.path.clone());
                        done += 1;
                    }
                    for (file, path) in &plan.created {
                        self.may_fail_changes_write(done)?;
                        let target = vault.file_of(path, &[extension(file.kind)])?;
                        let text = fixed(&file.text);
                        undo.create(&target, text.as_bytes())?;
                        if file.kind == FileKind::Diagram {
                            super::apply_diagrams::keep_draft(
                                vault, &mut undo, path, &text, &mut paths,
                            )?;
                        }
                        texts.insert(path.clone(), text);
                        paths.push(path.clone());
                        done += 1;
                    }
                    // A new note that shares its title with another keeps the links to
                    // that other note going where they went, as when it is made at once.
                    for (file, path) in &plan.created {
                        if file.kind == FileKind::Note
                            && let Some(text) = texts.get(path)
                        {
                            let meta = meta_for(path, text, 0);
                            paths.extend(self.keep_for_new(vault, &meta)?);
                        }
                    }
                    paths.sort();
                    paths.dedup();
                    Ok(paths)
                })();
                match written {
                    Ok(paths) => Ok(Change {
                        message: commit_message(set),
                        paths: paths.clone(),
                        value: ApplyOutcome::Applied {
                            commit: None,
                            paths,
                        },
                    }),
                    Err(err) => {
                        undo.put_back();
                        Err(err)
                    }
                }
            },
        )?;
        let (outcome, commit) = applied;
        match outcome {
            ApplyOutcome::Applied { paths, .. } => {
                // The set is spent; its folder in the cache goes with it.
                let _ = self.discard_changes(set);
                Ok(ApplyOutcome::Applied { commit, paths })
            }
            stale => Ok(stale),
        }
    }

    /// Plans the set's steps again against the vault as it is now, in a
    /// fresh set of the same id and pictures: "Recalculate" for a set that
    /// went stale. A step that cannot be made again (its section is gone, a
    /// note was locked) is dropped and said, and the rest stay.
    pub fn rebase_changes(
        &self,
        set: &ChangeSet,
        now: Instant,
    ) -> Result<(ChangeSet, Vec<Dropped>)> {
        let _turn = self
            .agent_turn
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut fresh = ChangeSet::new(set.id.clone(), &set.session, &set.client, set.created);
        fresh.assets = set.assets.clone();
        let mut dropped = Vec::new();
        for step in &set.steps {
            let Some(op) = &step.op else {
                fresh.steps.push(step.clone());
                continue;
            };
            match self.replan_edit(&mut fresh, op, now) {
                Ok((true, left_out)) => dropped.extend(left_out),
                Ok((false, left_out)) if !left_out.is_empty() => dropped.extend(left_out),
                Ok((false, _)) => dropped.push(Dropped {
                    summary: step.summary.clone(),
                    why: "It now waits for review instead of being previewed".to_owned(),
                }),
                Err(err) => dropped.push(Dropped {
                    summary: step.summary.clone(),
                    why: err.to_string(),
                }),
            }
        }
        self.save_changes(&fresh)?;
        Ok((fresh, dropped))
    }

    /// Fails like a full disk once `done` files of an apply are written, when
    /// a test asked for it with `fail_changes_writes_after`.
    fn may_fail_changes_write(&self, done: usize) -> Result<()> {
        let mut state = self.state();
        if state.fail_writes_after.is_some_and(|n| done >= n) {
            state.fail_writes_after = None;
            return Err(std::io::Error::new(
                std::io::ErrorKind::StorageFull,
                "No space left on the disk",
            )
            .into());
        }
        Ok(())
    }

    /// Makes the next `apply_changes` fail after writing `files` files, as a
    /// full disk would: for testing that everything is put back.
    #[doc(hidden)]
    pub fn fail_changes_writes_after(&self, files: usize) {
        self.state().fail_writes_after = Some(files);
    }
}

/// The commit's first line: what the set holds.
fn commit_message(set: &ChangeSet) -> String {
    let changed = set.files.len() + set.created_files.len();
    let pictures = match set.assets.len() {
        0 => String::new(),
        1 => " and 1 picture".to_owned(),
        n => format!(" and {n} pictures"),
    };
    let notes = match changed {
        1 => "1 file".to_owned(),
        n => format!("{n} files"),
    };
    format!("changes: {notes}{pictures} from {}", set.client)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_renamed_path_is_replaced_whole_and_never_inside_a_longer_name() {
        let text = "![](assets/a.png) ![](assets/a.png2) [x](assets/a-2.png) assets/a.png";
        assert_eq!(
            renamed(text, "assets/a.png", "assets/b.png"),
            "![](assets/b.png) ![](assets/a.png2) [x](assets/a-2.png) assets/b.png"
        );
    }
}
