//! Saving a project as a setup: what the project has that a new one could
//! start from (`preview_project_setup`, for the dialog's checklist) and the
//! save itself (`save_project_setup`): the project's skeleton pages, the
//! schemas of its tags and its default properties, written as
//! `templates/setups/<slug>.yaml` with a folder of files beside it, in one
//! commit that undo takes back. Nothing of the project is changed, and no page
//! is kept that was not named. An agent may ask for it too (setup_agent.rs); it
//! is held for review there. The setup is worked out in setup_save_plan.rs.

use serde::Serialize;

use super::setup_save_plan::{direct, kept_props, pages_of, project_in};
use super::setup_saved::PREFIX;
use super::{Change, Kasten};
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::rollback::Rollback;
use crate::time::Instant;

/// The most pages the dialog lists.
const MAX_LISTED: usize = 500;

/// One page the dialog offers to keep.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupPage {
    pub path: String,
    pub title: String,
    /// Ticked to start with: a page directly under the project's `pages/`.
    pub included: bool,
}

/// What a project has that a setup could keep, for the dialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupSource {
    /// The project's folder under `projects/`.
    pub folder: String,
    pub title: String,
    pub pages: Vec<SetupPage>,
    /// The tags whose schemas (and views) the setup would bring.
    pub tags: Vec<String>,
    /// The names of the default properties it would bring.
    pub props: Vec<String>,
}

/// A setup that was just saved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedSetup {
    /// What New project and `create_project` call it, `saved:<slug>`.
    pub id: String,
    pub slug: String,
    pub name: String,
    /// Every file the commit wrote.
    pub written: Vec<String>,
    /// The commit, for Undo; none in a vault without history.
    pub commit: Option<String>,
}

impl Kasten {
    /// What the project has that a setup could keep: its pages (those directly
    /// under `pages/` ticked), the tags whose schemas come along, and the
    /// default properties. `project` is its folder or its page's path.
    pub fn preview_project_setup(&self, project: &str) -> Result<SetupSource> {
        let notes = self.index().notes()?;
        let (folder, page) = project_in(&notes, project)?;
        let text = self.vault.read(&page.path)?.text;
        Ok(SetupSource {
            title: page.title.clone(),
            pages: pages_of(&notes, &folder)
                .into_iter()
                .take(MAX_LISTED)
                .map(|n| SetupPage {
                    included: direct(&n.path, &folder),
                    path: n.path.clone(),
                    title: n.title.clone(),
                })
                .collect(),
            tags: self.schema_stems(&notes, &folder)?,
            props: kept_props(&text).keys().cloned().collect(),
            folder,
        })
    }

    /// Saves the project as a setup called `title`, keeping the pages in
    /// `include_pages` (their vault paths), the schemas of the project's
    /// tags and its default properties: `templates/setups/<slug>.yaml` and the
    /// files beside it, in one commit trailered `Kasten-Setup`. `slug` is the
    /// file name (letters, digits and dashes; blank makes one of the title);
    /// one that is taken gets `-2`, `-3`… and nothing there is touched. The
    /// project is not changed. An agent may ask, and is held to the same rules
    /// plus: the project page and each page are not locked (setup_agent.rs).
    pub fn save_project_setup(
        &self,
        actor: &Actor,
        project: &str,
        slug: &str,
        title: &str,
        include_pages: &[String],
        now: Instant,
    ) -> Result<SavedSetup> {
        self.save_setup_pages(actor, project, slug, title, Some(include_pages), now)
    }

    /// `save_project_setup`, where `None` keeps the pages directly under `pages/`.
    pub(super) fn save_setup_pages(
        &self,
        actor: &Actor,
        project: &str,
        slug: &str,
        title: &str,
        pages: Option<&[String]>,
        now: Instant,
    ) -> Result<SavedSetup> {
        // Checked before the lock is taken, so a bad request waits for nothing.
        let first = self.plan_save(project, slug, title, pages, actor.is_agent())?;
        let id = format!("{PREFIX}{}", first.slug);
        let trailers = [("Kasten-Setup", id.clone())];
        let (saved, commit) = self.apply_committing(
            actor,
            "save_project_setup",
            false,
            now.millis,
            &trailers,
            |vault| {
                // Planned again under the lock: what is there now decides.
                let plan = self.plan_save(project, slug, title, pages, actor.is_agent())?;
                if plan.slug != first.slug {
                    return Err(Error::Invalid(
                        "That name was taken meanwhile; try again".to_owned(),
                    ));
                }
                let mut done = Rollback::default();
                let mut written = Vec::new();
                // The manifest is last, so a setup half written has no manifest and is not listed.
                for (path, text) in &plan.files {
                    let file = vault.file_of(path, &[".md", ".yaml"])?;
                    if let Err(err) = done.create(&file, text.as_bytes()) {
                        done.put_back();
                        return Err(if err.kind() == std::io::ErrorKind::AlreadyExists {
                            Error::Invalid("That name was taken meanwhile; try again".to_owned())
                        } else {
                            err.into()
                        });
                    }
                    written.push(path.clone());
                }
                Ok(Change {
                    message: format!("setup: save {}", plan.title),
                    paths: written.clone(),
                    value: SavedSetup {
                        id: id.clone(),
                        slug: plan.slug.clone(),
                        name: plan.title.clone(),
                        written,
                        commit: None,
                    },
                })
            },
        )?;
        Ok(SavedSetup { commit, ..saved })
    }
}
