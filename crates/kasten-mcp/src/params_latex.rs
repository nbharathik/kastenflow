//! Arguments of the LaTeX tools, with the descriptions agents see in each
//! tool's schema.

use rmcp::schemars::JsonSchema;
use serde::Deserialize;

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct LatexReadArgs {
    /// The document: its folder (as `latex_list` shows it), its title, or any file in it.
    pub doc: String,
    /// The file to read, relative to the document's folder (`sections/intro.tex`). The root file when left out, or the file `doc` names.
    pub file: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct LatexEditArgs {
    /// The document: its folder (as `latex_list` shows it), its title, or any file in it.
    pub doc: String,
    /// The file to change, relative to the document's folder (`main.tex`, `sections/intro.tex`).
    pub file: String,
    /// The text to replace, exactly as it is in the file. It must be in the file once: add some of the lines around it if it is not unique.
    pub search: String,
    /// What to put in its place (it may be empty to take the text out).
    pub replace: String,
    /// The `hash` `latex_read` gave for this file. When the file changed since, nothing is written and you read it again.
    pub base_hash: String,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct LatexBuildArgs {
    /// The document: its folder (as `latex_list` shows it), its title, or any file in it.
    pub doc: String,
}
