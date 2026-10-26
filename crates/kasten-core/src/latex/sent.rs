//! What sending text to LaTeX takes and answers.

use serde::Serialize;

use super::docs::LatexDoc;
use super::from_markdown::{Converted, Mode, markdown_to_latex, page_to_latex};

/// What sending text to LaTeX did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sent {
    pub doc: LatexDoc,
    /// The root file the text went into.
    pub path: String,
    /// The text was added to a document that was already there.
    pub appended: bool,
    /// The citation keys the text uses.
    pub cites: Vec<String>,
    /// How many `% TODO` comments the converted text holds (things left as plain text).
    pub todos: usize,
}

/// The text to send: a page as a file (frontmatter left out) or a selection.
#[derive(Debug, Clone, Copy)]
pub enum Material<'a> {
    Page(&'a str),
    Selection(&'a str),
}

impl Material<'_> {
    pub fn convert(self, mode: Mode) -> Converted {
        match self {
            Material::Page(text) => page_to_latex(text, mode),
            Material::Selection(text) => markdown_to_latex(text, mode),
        }
    }
}
