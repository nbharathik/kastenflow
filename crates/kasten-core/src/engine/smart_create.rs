//! A smart page made whole by an agent (`AgentOp::SmartCreate`): the page with
//! `layout: smart` and its code folder, in one commit. Everything is checked
//! before the page exists (`smart::ops::check_new`), the page and files are
//! written under one hold of the write lock, and a failure on the way puts
//! them back, so nothing is ever left half made. Review keeps it as one
//! proposal.

use serde_json::{Value, json};

use super::execute::day_of;
use super::review::Preview;
use super::{Change, Kasten};
use crate::agent::AgentOp;
use crate::diff::unified;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::ops::{self, Kind, NewNote};
use crate::rollback::Rollback;
use crate::smart::ops::{check_new, write_new};
use crate::smart::{INDEX_FILE, SMART_LAYOUT, is_text_file};
use crate::time::Instant;
use crate::vault::Vault;

/// The files of a create op as the checks take them.
fn pairs(op: &AgentOp) -> Vec<(&str, &[u8])> {
    match op {
        AgentOp::SmartCreate { files, .. } => files
            .iter()
            .map(|f| (f.path.as_str(), f.content.as_bytes()))
            .collect(),
        _ => Vec::new(),
    }
}

impl Kasten {
    /// What no mode lifts for a new smart page: a title, text files only, and
    /// every rule of the write ops for the folder it will hold.
    pub(super) fn smart_create_refusals(&self, op: &AgentOp) -> Result<()> {
        let AgentOp::SmartCreate {
            title,
            files,
            project,
            parent,
            ..
        } = op
        else {
            return Ok(());
        };
        // Off where the page would be made (its project's key, else the vault's
        // plugin): the agent is told to ask the person.
        let folder = match (project, parent) {
            (Some(project), _) => Some(crate::slug::slugify(project)),
            (None, Some(parent)) => super::boards::project_of(parent),
            (None, None) => None,
        };
        self.smart_gate_project(folder.as_deref())?;
        if title.trim().is_empty() {
            return Err(Error::Invalid("A smart page needs a title".to_owned()));
        }
        // Not as a sub-page held in another smart page's folder: that page's
        // lock has to cover everything in its folder, and a page in it could
        // have no folder of its own.
        if let AgentOp::SmartCreate {
            parent: Some(parent),
            ..
        } = op
            && crate::companions::in_folder(parent)
        {
            return Err(Error::Invalid(format!(
                "{parent} is inside a smart page's folder, so no page can be made under it"
            )));
        }
        for file in files {
            crate::smart::check_path(&file.path)?;
            if !is_text_file(&file.path) {
                return Err(Error::Invalid(format!(
                    "{} is not a text file: agents write html, js, css, json, svg and txt files and smart.yaml; a person adds pictures",
                    file.path
                )));
            }
        }
        check_new(&pairs(op))
    }

    /// What a reviewer sees of a new smart page: how many files, and the page
    /// it shows.
    pub(super) fn smart_create_preview(&self, op: &AgentOp) -> Preview {
        let AgentOp::SmartCreate { title, files, .. } = op else {
            return Preview {
                target: None,
                before: None,
                after: None,
                diff: String::new(),
            };
        };
        let index = files
            .iter()
            .find(|f| f.path == INDEX_FILE)
            .map(|f| f.content.clone());
        let names: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        let words = format!(
            "Make the smart page “{}” with {} file{}: {}",
            title.trim(),
            files.len(),
            if files.len() == 1 { "" } else { "s" },
            names.join(", ")
        );
        // Every file is shown, index.html first: a reviewer approves the code
        // that will run, not just the page's first screen.
        let mut order: Vec<&crate::agent::SmartNewFile> = files.iter().collect();
        order.sort_by_key(|f| f.path != INDEX_FILE);
        let shown: Vec<String> = order
            .iter()
            .map(|f| unified(&f.path, "", &f.content, 3))
            .collect();
        let diff = format!("{words}\n\n{}", shown.join("\n"));
        Preview {
            target: None,
            before: None,
            after: index,
            diff,
        }
    }

    /// Makes the page and its folder as `actor`; what the agent is told comes back.
    pub(super) fn smart_create_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        let AgentOp::SmartCreate {
            title,
            project,
            parent,
            ..
        } = op
        else {
            return Err(Error::Invalid(format!("{} is not smart_create", op.name())));
        };
        let files = pairs(op);
        check_new(&files)?;
        let new = NewNote {
            kind: Kind::Page,
            title: title.trim().to_owned(),
            date: day_of(now),
            project: project.clone(),
            parent: parent.clone(),
            template: None,
            icon: None,
        };
        self.apply(actor, "smart_create", false, now.millis, |vault| {
            // Anything that goes wrong on the way puts every file back.
            let mut done = Rollback::default();
            self.make_smart_page(vault, &new, None, &files, now, &mut done)
                .inspect_err(|_| std::mem::take(&mut done).put_back())
        })
    }

    /// The steps of `smart_create_execute`, each noted in `done`. `body` is
    /// the page's text when it has some to start with (a starter's).
    pub(super) fn make_smart_page(
        &self,
        vault: &Vault,
        new: &NewNote,
        body: Option<&str>,
        files: &[(&str, &[u8])],
        now: Instant,
        done: &mut Rollback,
    ) -> Result<Change<Value>> {
        // Making the page may give its parent an id; on a failure the parent
        // goes back to the bytes it had.
        let parent_file = match &new.parent {
            Some(parent) => Some(vault.path_of(parent)?),
            None => None,
        };
        let parent_before = parent_file
            .as_ref()
            .and_then(|file| std::fs::read(file).ok());
        let created = ops::create_note(vault, new, now);
        if let (Some(file), Some(before)) = (&parent_file, parent_before)
            && std::fs::read(file).ok().as_ref() != Some(&before)
        {
            done.replaced(file, before);
        }
        let page = created?.meta.path;
        done.made(&vault.path_of(&page)?);
        let with_layout = ops::set_meta(vault, &page, "layout", Some(SMART_LAYOUT), now)?;
        if let Some(body) = body.filter(|b| !b.is_empty()) {
            ops::save_body(vault, &page, body, &with_layout.hash, now)?;
        }
        let written = write_new(vault, &page, files, done)?;
        let note = vault.read(&page)?;
        let mut paths = vec![page.clone()];
        paths.extend(new.parent.clone());
        paths.extend(self.keep_for_new(vault, &note.meta)?);
        paths.extend(written.iter().map(|w| w.path.clone()));
        let value = json!({
            "status": "created",
            "page": page,
            "id": note.meta.id,
            "title": note.meta.title,
            "files": written
                .iter()
                .map(|w| json!({ "path": w.rel, "hash": w.hash }))
                .collect::<Vec<_>>(),
        });
        Ok(Change {
            message: format!("create: {}", note.meta.title),
            paths,
            value,
        })
    }
}
