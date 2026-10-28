//! Arguments of the tools that make LaTeX documents and write, add to and
//! take out their files, with the descriptions agents see in each schema.

use rmcp::schemars::JsonSchema;
use serde::Deserialize;

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct LatexCreateDocumentArgs {
    /// The document's title. Its folder is named after it, with a number added when the name is taken.
    pub title: String,
    /// `article` (the default), `report` or `beamer` (slides).
    pub template: Option<String>,
    /// The project's folder name (as `list_projects` shows it) to make the document in. The library when left out.
    pub project: Option<String>,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct LatexWriteFileArgs {
    /// The document: its folder (as `latex_list` shows it), its title, or any file in it.
    pub doc: String,
    /// The file to write, relative to the document's folder (`sections/intro.tex`, `refs.bib`). It ends in `.tex`, `.sty`, `.cls`, `.bst` or `.bib`.
    pub file: String,
    /// The whole text of the file.
    pub text: String,
    /// The `hash` `latex_read` gave for this file, to replace it. Leave it out to make a new file, which must not be there yet.
    pub base_hash: Option<String>,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct LatexAppendArgs {
    /// The document: its folder (as `latex_list` shows it), its title, or any file in it.
    pub doc: String,
    /// The file to add to, relative to the document's folder (`main.tex`, `sections/intro.tex`).
    pub file: String,
    /// The text to add, exactly as it should be written, with its own line breaks.
    pub text: String,
    /// The `hash` `latex_read` gave for this file. When the file changed since, nothing is written and you read it again.
    pub base_hash: String,
    /// Put the text right after this piece of the file, which must be in the file once (add some of the lines around it if it is not unique). The text goes at the end of the file when left out.
    pub after: Option<String>,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct LatexDeleteFileArgs {
    /// The document: its folder (as `latex_list` shows it), its title, or any file in it.
    pub doc: String,
    /// The file to take out, relative to the document's folder.
    pub file: String,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}
