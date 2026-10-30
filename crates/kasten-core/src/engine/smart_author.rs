//! A person starts a smart page from files (a starter the app ships, or a
//! template of their own) and turns an ordinary page into one. Both are one
//! change: the page, its `layout: smart` and its code folder are checked
//! before anything is written, written under one hold of the lock, and put
//! back as they were if a step fails. Undo takes the whole change back.
//! Keeping a page as a template is in `smart_template.rs`.

use std::fs;

use serde::Serialize;
use serde_json::Value;

use super::smart::person_only;
use super::{Change, Kasten};
use crate::error::{Error, Result};
use crate::frontmatter::{read_map, split};
use crate::history::Actor;
use crate::ops::{self, Kind, NewNote};
use crate::rollback::Rollback;
use crate::smart::ops::{check_new, write_new};
use crate::smart::{SMART_LAYOUT, listing};
use crate::time::Instant;
use crate::vault::Vault;

/// A smart page to make: its title, where it goes, the text it starts with
/// and the files of its folder (paths inside the folder, with their bytes).
#[derive(Debug, Clone, Copy)]
pub struct NewSmartPage<'a> {
    pub title: &'a str,
    /// Folder name under `projects/` to make it in.
    pub project: Option<&'a str>,
    /// Path of the page it becomes a sub-page of.
    pub parent: Option<&'a str>,
    /// What the page says besides its view; none leaves it empty.
    pub body: Option<&'a str>,
    pub files: &'a [(&'a str, &'a [u8])],
    /// A file of the template (or page) its files come from: the commit says
    /// so, and a page made from something an agent made is still told so
    /// (`first_commit` follows it).
    pub copy_of: Option<&'a str>,
}

/// A smart page that was just made or turned on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MadeSmart {
    pub page: String,
    pub id: Option<String>,
    pub title: String,
    /// How many files were written into its folder (none when it kept the folder it had).
    pub files: usize,
}

impl Kasten {
    /// Makes a smart page from `request`: the page (with `layout: smart` and
    /// its text) and its folder, in one commit. Nothing is written when any
    /// file would be refused.
    pub fn smart_new_page(
        &self,
        actor: &Actor,
        request: &NewSmartPage<'_>,
        now: Instant,
    ) -> Result<MadeSmart> {
        person_only(actor)?;
        if request.title.trim().is_empty() {
            return Err(Error::Invalid("A smart page needs a title".to_owned()));
        }
        if let Some(parent) = request.parent
            && crate::companions::in_folder(parent)
        {
            return Err(Error::Invalid(format!(
                "{parent} is inside a smart page's folder, so no page can be made under it"
            )));
        }
        check_new(request.files)?;
        let new = NewNote {
            kind: Kind::Page,
            title: request.title.trim().to_owned(),
            date: super::execute::day_of(now),
            project: request.project.map(str::to_owned),
            parent: request.parent.map(str::to_owned),
            template: None,
            icon: None,
        };
        // A line of a commit message: nothing that breaks the line.
        if request
            .copy_of
            .is_some_and(|s| s.chars().any(char::is_control))
        {
            return Err(Error::Invalid("Not a place to copy from".to_owned()));
        }
        let copied: Vec<(&str, String)> = request
            .copy_of
            .map(|source| (crate::history::COPY_OF, source.to_owned()))
            .into_iter()
            .collect();
        let made = self.apply_with(actor, "smart_create", false, now.millis, &copied, |vault| {
            let mut done = Rollback::default();
            self.make_smart_page(vault, &new, request.body, request.files, now, &mut done)
                .inspect_err(|_| std::mem::take(&mut done).put_back())
        })?;
        Ok(MadeSmart {
            page: made["page"].as_str().unwrap_or_default().to_owned(),
            id: made["id"].as_str().map(str::to_owned),
            title: made["title"].as_str().unwrap_or_default().to_owned(),
            files: request.files.len(),
        })
    }

    /// Turns the page at `page` into a smart page: sets `layout: smart` and,
    /// when the page has no code folder yet, writes `files` into one. Its
    /// text is not touched. A page that already has a folder keeps it as it
    /// is (nothing in it is replaced) and only gets the layout.
    pub fn smart_turn_into(
        &self,
        actor: &Actor,
        page: &str,
        files: &[(&str, &[u8])],
        now: Instant,
    ) -> Result<MadeSmart> {
        person_only(actor)?;
        let folder_there = listing(&self.vault, page)?.files.iter().any(|f| f.allowed);
        if !folder_there {
            check_new(files)?;
        }
        self.apply(actor, "smart_turn_into", false, now.millis, |vault| {
            let mut done = Rollback::default();
            turn_steps(vault, page, files, now, &mut done)
                .inspect_err(|_| std::mem::take(&mut done).put_back())
        })
    }
}

/// The steps of `smart_turn_into`, each noted in `done`.
fn turn_steps(
    vault: &Vault,
    page: &str,
    files: &[(&str, &[u8])],
    now: Instant,
    done: &mut Rollback,
) -> Result<Change<MadeSmart>> {
    let folder_there = listing(vault, page)?.files.iter().any(|f| f.allowed);
    let file = vault.path_of(page)?;
    done.replaced(&file, fs::read(&file)?);
    // A smart page is known by its id; an older page that has none is given one.
    ops::ensure_id(vault, page, now)?;
    // A page that already says `layout: smart` (the window set it through the
    // open page) is left exactly as it is: no write, so an editor holding it
    // does not find it changed.
    let current = vault.read(page)?;
    let already = read_map(split(&current.text).prefix)
        .ok()
        .and_then(|keys| {
            keys.get("layout")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .is_some_and(|layout| layout == SMART_LAYOUT);
    let note = if already {
        current
    } else {
        ops::set_meta(vault, page, "layout", Some(SMART_LAYOUT), now)?
    };
    let written = if folder_there {
        Vec::new()
    } else {
        write_new(vault, page, files, done)?
    };
    let mut paths = vec![page.to_owned()];
    paths.extend(written.iter().map(|w| w.path.clone()));
    Ok(Change {
        message: format!("edit: {} (smart page)", note.meta.title),
        paths,
        value: MadeSmart {
            page: page.to_owned(),
            id: note.meta.id.clone(),
            title: note.meta.title.clone(),
            files: written.len(),
        },
    })
}
