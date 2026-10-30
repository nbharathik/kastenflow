//! Saving a project as a setup, asked by an agent: what is refused in every
//! mode (the same checks a person's save makes, plus a locked project page
//! or page), what the agent is told when it runs, what a reviewer reads, and
//! which project's mode holds. It always waits for review (agent_review.rs
//! gives it that class): it writes into `templates/`, which agents never write
//! on their own. The save itself is in setup_save.rs.

use serde_json::{Value, json};

use super::Kasten;
use super::boards::project_of;
use super::setup_saved::yaml_path;
use crate::agent::AgentOp;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::time::Instant;

/// The project an op asks to save, for the mode that holds: named by its
/// folder or by the path of its page.
pub(super) fn project_for_mode(project: &str) -> Option<String> {
    let page = if project.trim().starts_with("projects/") {
        project.trim().to_owned()
    } else {
        format!("projects/{}/_project.md", project.trim())
    };
    project_of(&page)
}

impl Kasten {
    /// Refusals no mode lifts: the checks of a save, for an agent.
    pub(super) fn setup_save_refusals(&self, op: &AgentOp) -> Result<()> {
        let AgentOp::SaveProjectSetup {
            project,
            slug,
            title,
            pages,
        } = op
        else {
            return Ok(());
        };
        self.plan_save(project, slug, title, pages.as_deref(), true)
            .map(|_| ())
    }

    /// Runs the save as `actor`; what the agent is told comes back.
    pub(super) fn setup_save_execute(
        &self,
        actor: &Actor,
        op: &AgentOp,
        now: Instant,
    ) -> Result<Value> {
        let AgentOp::SaveProjectSetup {
            project,
            slug,
            title,
            pages,
        } = op
        else {
            return Err(Error::Invalid(format!(
                "{} is not a setup change",
                op.name()
            )));
        };
        let saved = self.save_setup_pages(actor, project, slug, title, pages.as_deref(), now)?;
        let kept = saved
            .written
            .iter()
            .filter(|path| path.contains("/pages/"))
            .count();
        Ok(json!({
            "setup": saved.id,
            "name": saved.name,
            "path": yaml_path(&saved.slug),
            "pages": kept,
            "written": saved.written,
        }))
    }

    /// What a reviewer reads of the save.
    pub(super) fn setup_save_words(&self, op: &AgentOp) -> String {
        let AgentOp::SaveProjectSetup {
            project,
            slug,
            title,
            pages,
        } = op
        else {
            return String::new();
        };
        let title = title.trim();
        let project_name = self
            .preview_project_setup(project)
            .map_or_else(|_| project.trim().to_owned(), |source| source.title);
        let Ok(plan) = self.plan_save(project, slug, title, pages.as_deref(), true) else {
            return format!("Save the project “{project_name}” as your setup “{title}”");
        };
        let titled = |path: &String| {
            self.vault
                .read(path)
                .map_or_else(|_| path.clone(), |note| format!("“{}”", note.meta.title))
        };
        let names: Vec<String> = plan.pages.iter().map(titled).collect();
        let with = if names.is_empty() {
            "with no pages".to_owned()
        } else {
            format!("with the pages {}", names.join(", "))
        };
        format!(
            "Save the project “{project_name}” as your setup “{}” ({with}, and the tag databases the project uses). New projects can then start from it",
            plan.title
        )
    }
}
