//! Sending a page, or a part of one, to LaTeX: the Markdown is converted by
//! kasten-core and either made into a new document (from a template) or added
//! at the end of a document's root file. The write is a kasten-core op done as
//! the person; this only reads the page and passes the words on.

use kasten_core::history::Actor;
use kasten_core::latex::{Material, Sent, Template};
use kasten_core::{Error, Instant};
use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::open_vault::OpenVault;
use crate::plugins;

/// What to send, and where.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequest {
    /// A page of the vault, all of it...
    pub page: Option<String>,
    /// ...or Markdown the person selected.
    pub text: Option<String>,
    /// The root file of a document to add it to; without it a new document is made.
    pub append_to: Option<String>,
    /// The new document's title (the page's, usually).
    pub title: Option<String>,
    /// `article`, `report` or `beamer`; the article when absent.
    pub template: Option<String>,
    /// A project to keep the new document in; the library when absent.
    pub project: Option<String>,
}

/// The template called `name`, or the article with no name.
pub fn template_named(name: Option<&str>) -> Result<Template, String> {
    match name {
        None | Some("") => Ok(Template::default()),
        Some(name) => Template::from_name(name).ok_or_else(|| {
            format!("There is no template called “{name}”. Choose article, report or beamer")
        }),
    }
}

/// Makes a document from a template, or adds a page or selection to one.
#[tauri::command(async)]
pub fn latex_send(
    app: AppHandle,
    vault: State<'_, OpenVault>,
    request: SendRequest,
) -> Result<Sent, String> {
    plugins::require(&app, "latex")?;
    let template = template_named(request.template.as_deref())?;
    vault.run(|k| {
        let page_text;
        let material = match (&request.page, &request.text) {
            (Some(path), _) => {
                page_text = k.read(path)?.text;
                Material::Page(&page_text)
            }
            (None, Some(text)) => Material::Selection(text),
            (None, None) => {
                return Err(Error::Invalid(
                    "There is no text to send to LaTeX".to_owned(),
                ));
            }
        };
        let person = Actor::Human;
        match request.append_to.as_deref() {
            Some(path) => k.send_to_latex_doc(&person, material, path, Instant::now()),
            None => {
                let title = request.title.as_deref().unwrap_or("Untitled document");
                k.send_to_new_latex_doc(
                    &person,
                    material,
                    title,
                    template,
                    request.project.as_deref(),
                    Instant::now(),
                )
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_template_is_named_or_the_article() {
        assert_eq!(template_named(None), Ok(Template::Article));
        assert_eq!(template_named(Some("")), Ok(Template::Article));
        assert_eq!(template_named(Some("beamer")), Ok(Template::Beamer));
        assert!(
            template_named(Some("letter"))
                .unwrap_err()
                .contains("article, report or beamer")
        );
    }
}
