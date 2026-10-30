//! Arguments of the tools that put a picture, a citation and a page into a
//! LaTeX document, with the descriptions agents see in each schema.

use rmcp::schemars::JsonSchema;
use serde::Deserialize;

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct LatexAddAssetArgs {
    /// The document: its folder (as `latex_list` shows it), its title, or any file in it.
    pub doc: String,
    /// The picture's file name, such as `results.png`. Its ending must say what it is: png, jpg or pdf (svg is kept but TeX cannot use it). A number is added when the name is taken.
    pub name: String,
    /// The picture's bytes as standard base64 text. Give this or `vault_path`.
    pub base64: Option<String>,
    /// A picture that is in the vault already (`assets/results.png`), instead of `base64`.
    pub vault_path: Option<String>,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct LatexCiteArgs {
    /// The document: its folder (as `latex_list` shows it), its title, or any file in it.
    pub doc: String,
    /// The `.tex` file to cite in, relative to the document's folder (`main.tex`, `sections/intro.tex`).
    pub file: String,
    /// The reference's key, as `list_references` shows it.
    pub key: String,
    /// Put the citation at the end of the paragraph that holds this piece of the file, which must be in the file once (add some of the lines around it if it is not unique). It goes at the end of the file's text when left out.
    pub at: Option<String>,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct LatexSendPageArgs {
    /// The page: its path, id or title.
    pub page: String,
    /// Send only the part of the page under this heading.
    pub section: Option<String>,
    /// A document to add the text to, at the end of its root file (its folder as `latex_list` shows it, or its title). Leave it out to make a new document instead.
    pub doc: Option<String>,
    /// The new document's title (the page's title when left out). Not with `doc`.
    pub title: Option<String>,
    /// For a new document: `article` (the default), `report` or `beamer`.
    pub template: Option<String>,
    /// For a new document: the project's folder name to make it in. The library when left out.
    pub project: Option<String>,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}
