//! The structure ops: a page put inside another or taken out (`set_parent`),
//! the order a page's sub-pages are shown in (`reorder_children`), and a new
//! project (`create_project`). What agents are told, refused or kept for
//! review about them is in structure_agent.rs.

use serde::Serialize;

use super::execute::day_of;
use super::setups::SetupTarget;
use super::{Change, Kasten, Placed};
use crate::atomic::write_atomic;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::note::NoteFile;
use crate::ops::{Kind, NewNote};
use crate::structure::{order_text, ordered_ids};
use crate::time::Instant;

/// A project just made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct NewProject {
    /// The project page, `projects/<folder>/_project.md`.
    pub path: String,
    pub folder: String,
    pub title: String,
    /// Every file the commit wrote: the page, and a setup's pages, board and schemas.
    pub written: Vec<String>,
}

/// A project's title as the setups take it: some text on one line, without
/// the characters that break a link.
pub(super) fn project_title(title: &str) -> Result<String> {
    let title = title.trim();
    if title.is_empty()
        || title.chars().count() > 200
        || title.contains(['[', ']', '|'])
        || title.chars().any(char::is_control)
    {
        return Err(Error::Invalid(
            "A project's title is some text on one line, up to 200 characters, without [ ] or |"
                .to_owned(),
        ));
    }
    Ok(title.to_owned())
}

impl Kasten {
    /// Puts the page at `path` inside the page at `parent` (moving it, its
    /// sub-pages and their comments to that page's project or the library), or,
    /// with None, takes it out of its page where it is. Links keep going where
    /// they went. One commit, which one undo takes back. A page never goes
    /// inside itself or its own sub-page.
    pub fn set_parent(
        &self,
        actor: &Actor,
        path: &str,
        parent: Option<&str>,
        now: Instant,
    ) -> Result<Placed> {
        if actor.is_agent() {
            self.set_parent_refusals(path, parent, &|_| false)?;
        }
        self.nest_placed(actor, path, parent, now)
    }

    /// Sets the order the sub-pages of the page at `parent` are shown in:
    /// `ids` first, in that order, then the sub-pages it leaves out, by title.
    /// An id that is not a sub-page is ignored; no ids at all goes back to
    /// alphabetical. Only `children_order` in the parent's frontmatter
    /// changes, nothing else in the file; one commit, and none when the order
    /// is already so.
    pub fn reorder_children(
        &self,
        actor: &Actor,
        parent: &str,
        ids: &[String],
        now: Instant,
    ) -> Result<NoteFile> {
        let holder = self.vault.read(parent)?;
        if holder.meta.kind != "page" || crate::vault::in_templates(parent) {
            return Err(Error::Invalid(format!(
                "Only a page has sub-pages to put in order, not a {} note",
                holder.meta.kind
            )));
        }
        if actor.is_agent() {
            self.writable(parent)?;
        }
        self.apply(actor, "reorder_children", false, now.millis, |vault| {
            let current = vault.read(parent)?;
            let children = match current.meta.id.as_deref() {
                Some(id) => self
                    .index()
                    .notes()?
                    .into_iter()
                    .filter(|note| note.parent.as_deref() == Some(id))
                    .collect(),
                None => Vec::new(),
            };
            let wanted = if ids.is_empty() {
                Vec::new()
            } else {
                ordered_ids(ids, children)
            };
            let text = match order_text(&current.text, &wanted)? {
                Some(text) if wanted != current.meta.children_order => text,
                _ => {
                    return Ok(Change {
                        message: String::new(),
                        paths: vec![],
                        value: current,
                    });
                }
            };
            write_atomic(&vault.path_of(parent)?, text.as_bytes())?;
            Ok(Change {
                message: format!("order: sub-pages of {}", current.meta.title),
                paths: vec![parent.to_owned()],
                value: vault.read(parent)?,
            })
        })
    }

    /// Makes a project called `title`, empty or from a project setup: its
    /// page, and a setup's pages, board and schemas, in one commit. Never
    /// touches a project that is there: the folder takes the next free name.
    /// This is the one way an agent starts a setup, and only on a project it
    /// is making.
    pub fn create_project(
        &self,
        actor: &Actor,
        title: &str,
        setup: Option<&str>,
        now: Instant,
    ) -> Result<NewProject> {
        let title = project_title(title)?;
        let (path, written) = match setup {
            Some(id) => {
                let target = SetupTarget::New {
                    title: title.clone(),
                };
                let applied = self.apply_setup_as(actor, id, &target, now)?;
                (applied.project_path, applied.written)
            }
            None => {
                let page = self.create(
                    actor,
                    &NewNote {
                        kind: Kind::Project,
                        title: title.clone(),
                        date: day_of(now),
                        project: None,
                        parent: None,
                        template: None,
                        icon: None,
                    },
                    now,
                )?;
                (page.meta.path.clone(), vec![page.meta.path])
            }
        };
        let folder = path
            .strip_prefix("projects/")
            .and_then(|rest| rest.split('/').next())
            .unwrap_or_default()
            .to_owned();
        Ok(NewProject {
            path,
            folder,
            title,
            written,
        })
    }
}
