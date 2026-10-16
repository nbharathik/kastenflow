//! The write ops, each wrapped with its commit message and touched paths.

use super::{Change, Kasten};
use crate::companions;
use crate::error::{Error, Result};
use crate::frontmatter::split;
use crate::history::Actor;
use crate::merge::merge3;
use crate::note::NoteFile;
use crate::ops::{self, Saved};
use crate::rename::{Renamed, rename_note_in};
use crate::rollback::Rollback;
use crate::time::Instant;
use crate::trash;

impl Saved {
    /// The note as it is on disk after the save.
    pub fn note(&self) -> &NoteFile {
        match self {
            Saved::Written { note }
            | Saved::Unchanged { note }
            | Saved::Conflict { note, .. }
            | Saved::Merged { note } => note,
        }
    }
}

/// " and 2 sub-pages", for a commit message; nothing for none.
fn along(sub_pages: usize) -> String {
    match sub_pages {
        0 => String::new(),
        1 => " and 1 sub-page".to_owned(),
        n => format!(" and {n} sub-pages"),
    }
}

pub(super) fn title_of(vault: &crate::vault::Vault, path: &str) -> String {
    if path.ends_with(".deck") {
        return crate::deck::title_at(vault, path);
    }
    if path.ends_with(crate::diagrams::EXT) {
        return crate::diagrams::title_of(path);
    }
    vault
        .read(path)
        .map(|n| n.meta.title)
        .unwrap_or_else(|_| path.to_owned())
}

impl Kasten {
    /// Adds Markdown to a note, at the end or at the end of the section
    /// under `heading`, reading the note inside the write lock so parallel
    /// writers never lose each other's text (the MCP tool `append`).
    pub fn append(
        &self,
        actor: &Actor,
        path: &str,
        markdown: &str,
        heading: Option<&str>,
        now: Instant,
    ) -> Result<NoteFile> {
        self.apply(actor, "append", false, now.millis, |vault| {
            let current = vault.read(path)?;
            let body = crate::sections::append_under(split(&current.text).body, markdown, heading)?;
            let note = ops::save_body(vault, path, &body, &current.hash, now)?
                .note()
                .clone();
            Ok(Change {
                message: format!("append: {}", note.meta.title),
                paths: vec![path.to_owned()],
                value: note,
            })
        })
    }

    /// Saves a note's body. If the file changed since `base_hash` was read,
    /// edits on other lines are merged; overlapping ones keep the editor's
    /// text in a conflict copy.
    pub fn save_body(
        &self,
        actor: &Actor,
        path: &str,
        body: &str,
        base_hash: &str,
        now: Instant,
    ) -> Result<Saved> {
        let base = self.base(base_hash);
        let saved = self.apply(actor, "edit", true, now.millis, |vault| {
            let current = vault.read(path)?;
            let merged = match (&base, current.hash != base_hash) {
                (Some(base), true) => merge3(split(base).body, body, split(&current.text).body),
                _ => None,
            };
            let saved = match merged {
                Some(text) => Saved::Merged {
                    note: ops::save_body(vault, path, &text, &current.hash, now)?
                        .note()
                        .clone(),
                },
                None => ops::save_body(vault, path, body, base_hash, now)?,
            };
            let mut paths = vec![path.to_owned()];
            if let Saved::Conflict { copy, .. } = &saved {
                paths.push(copy.clone());
            }
            Ok(Change {
                message: format!("edit: {}", saved.note().meta.title),
                paths,
                value: saved,
            })
        })?;
        self.remember(&saved.note().hash, &saved.note().text);
        Ok(saved)
    }

    /// Sets a page header key: its title, icon, cover, layout or lock.
    pub fn set_meta(
        &self,
        actor: &Actor,
        path: &str,
        key: &str,
        value: Option<&str>,
        now: Instant,
    ) -> Result<NoteFile> {
        // The lock keeps agents out, so only a person moves it.
        if key == "locked" && actor.is_agent() {
            return Err(Error::Invalid(
                "A page is locked and unlocked by a person only".into(),
            ));
        }
        let note = self.apply(actor, "edit", true, now.millis, |vault| {
            let note = ops::set_meta(vault, path, key, value, now)?;
            Ok(Change {
                message: format!("edit: {}", note.meta.title),
                paths: vec![path.to_owned()],
                value: note,
            })
        })?;
        self.remember(&note.hash, &note.text);
        Ok(note)
    }

    pub fn rename(&self, actor: &Actor, path: &str, title: &str, now: Instant) -> Result<Renamed> {
        self.apply(actor, "rename_note", false, now.millis, |vault| {
            let old = title_of(vault, path);
            let before = self.index().notes()?;
            let candidates = match before.iter().find(|n| n.path == path) {
                Some(note) => self.linking_any(&[note], &[title])?,
                None => Vec::new(),
            };
            let renamed = rename_note_in(vault, path, title, now, &before, &candidates)?;
            let mut paths = vec![path.to_owned(), renamed.note.meta.path.clone()];
            paths.extend(renamed.relinked.iter().cloned());
            if renamed.note.meta.path != path {
                let moved = [(path.to_owned(), renamed.note.meta.path.clone())];
                // Its comments and highlights files follow it to the new name.
                let mut done = Rollback::default();
                match companions::carry(vault, &moved, &mut done) {
                    Ok(carried) => paths.extend(carried.into_iter().flat_map(|(a, b)| [a, b])),
                    Err(err) => {
                        done.put_back();
                        return Err(err);
                    }
                }
                paths.extend(crate::board::relink_boards(vault, &moved)?);
            }
            Ok(Change {
                message: format!("rename: {old} → {}", renamed.note.meta.title),
                paths,
                value: renamed,
            })
        })
    }

    pub fn duplicate(&self, actor: &Actor, path: &str, now: Instant) -> Result<NoteFile> {
        self.apply(actor, "duplicate", false, now.millis, |vault| {
            let title = title_of(vault, path);
            let note = crate::moving::duplicate_note(vault, path, now)?;
            // A second copy shares the first's title: links to it stay put.
            let mut paths = vec![note.meta.path.clone()];
            // The copy has the page's comments and highlights too.
            let mut done = Rollback::default();
            match companions::copy_for(vault, path, &note.meta.path, &mut done) {
                Ok(copied) => paths.extend(copied),
                Err(err) => {
                    done.put_back();
                    return Err(err);
                }
            }
            paths.extend(self.keep_for_new(vault, &note.meta)?);
            Ok(Change {
                message: format!("duplicate: {title}"),
                paths,
                value: note,
            })
        })
    }

    /// Moves a note to `.trash/`, with every sub-page below it, as one
    /// change; returns where the note went.
    pub fn trash(&self, actor: &Actor, path: &str, now: Instant) -> Result<String> {
        self.apply(actor, "trash_note", false, now.millis, |vault| {
            let title = title_of(vault, path);
            let going = self.with_sub_pages(path)?;
            // Each page's comments and highlights files go to the trash with
            // it (and come back with it); they are not listed there apart.
            let mut files = going.clone();
            for page in &going {
                files.extend(companions::existing(vault, page));
            }
            let trashed = trash::trash_all(vault, &files, now)?;
            let mut paths = files;
            paths.extend(trashed.iter().cloned());
            // A diagram's picture goes with it, and is not a sub-page.
            let sub_pages = if path.ends_with(crate::diagrams::EXT) {
                0
            } else {
                going.len() - 1
            };
            Ok(Change {
                message: format!("trash: {title}{}", along(sub_pages)),
                paths,
                value: trashed[0].clone(),
            })
        })
    }

    /// The note at `path` and every sub-page below it, parents first.
    pub(crate) fn with_sub_pages(&self, path: &str) -> Result<Vec<String>> {
        // A diagram goes to the trash with its picture.
        if path.ends_with(crate::diagrams::EXT) {
            return Ok(crate::diagrams::files_of(&self.vault, path));
        }
        if !path.ends_with(".md") {
            return Ok(vec![path.to_owned()]);
        }
        let notes = self.index().notes()?;
        Ok(match notes.iter().find(|n| n.path == path) {
            Some(root) => crate::moving::subtree(&notes, root)
                .into_iter()
                .map(|n| n.path)
                .collect(),
            None => vec![path.to_owned()],
        })
    }

    /// Puts a trashed note back, with the sub-pages that went with it.
    pub fn restore_trashed(&self, actor: &Actor, trashed: &str) -> Result<NoteFile> {
        self.apply(
            actor,
            "restore_note",
            false,
            Instant::now().millis,
            |vault| {
                let (note, moves) = trash::restore_note_with_sub_pages(vault, trashed)?;
                let paths = moves
                    .iter()
                    .flat_map(|(from, to)| [from.clone(), to.clone()]);
                // The pages that came back, not their comments and highlights files.
                let pages = moves.iter().filter(|(_, to)| to.ends_with(".md")).count();
                Ok(Change {
                    message: format!("restore: {}{}", note.meta.title, along(pages - 1)),
                    paths: paths.collect(),
                    value: note,
                })
            },
        )
    }

    pub fn list_trash(&self) -> Result<Vec<trash::Trashed>> {
        trash::list_trash(&self.vault)
    }

    /// The text of something in the trash, to look at before restoring it.
    pub fn read_trashed(&self, trashed: &str) -> Result<String> {
        trash::read_trashed(&self.vault, trashed)
    }

    /// The journal day, created from the template on first open.
    pub fn journal(&self, actor: &Actor, date: &str, now: Instant) -> Result<NoteFile> {
        let path = format!("journal/{}/{date}.md", date.get(..4).unwrap_or(""));
        if self.vault.exists(&path) {
            return self.read(&path);
        }
        let chosen = self.config().journal_template;
        self.apply(actor, "journal", false, now.millis, |vault| {
            let note = crate::templated::journal_day_from(vault, date, chosen.as_deref(), now)?;
            Ok(Change {
                message: format!("journal: {date}"),
                paths: vec![note.meta.path.clone()],
                value: note,
            })
        })
    }

    /// Saves the page at `path` as the template `name`, for the person
    /// only: agents propose templates for review instead.
    pub fn save_as_template(
        &self,
        actor: &Actor,
        path: &str,
        name: &str,
        now: Instant,
    ) -> Result<NoteFile> {
        if actor.is_agent() {
            return Err(Error::Invalid(
                "Agents propose templates for review; saving a page as one is for the person"
                    .to_owned(),
            ));
        }
        self.apply(actor, "save_template", false, now.millis, |vault| {
            let (target, text) = crate::templated::template_from(vault, path, name)?;
            match crate::atomic::create_atomic(&vault.path_of(&target)?, text.as_bytes()) {
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                    return Err(Error::Invalid(format!(
                        "A template called “{}” is already in this vault",
                        name.trim()
                    )));
                }
                other => other?,
            }
            let title = vault.read(path)?.meta.title;
            Ok(Change {
                message: format!("template: save {} from {title}", name.trim()),
                paths: vec![target.clone()],
                value: vault.read(&target)?,
            })
        })
    }

    /// Fills an empty page from a template.
    pub fn apply_template(
        &self,
        actor: &Actor,
        path: &str,
        template: &str,
        date: &str,
        now: Instant,
    ) -> Result<NoteFile> {
        self.apply(actor, "template", false, now.millis, |vault| {
            let note = crate::templated::apply_template(vault, path, template, date, now)?;
            Ok(Change {
                message: format!("template: {} from {template}", note.meta.title),
                paths: vec![path.to_owned()],
                value: note,
            })
        })
    }
}
