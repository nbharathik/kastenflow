//! Arguments of the tool that turns a diagram into a LaTeX figure, with the
//! descriptions agents see in its schema.

use rmcp::schemars::JsonSchema;
use serde::Deserialize;

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct DiagramToFigureArgs {
    /// The diagram's title or vault path (`.drawio`).
    pub diagram: String,
    /// A page's name of the diagram (the first page when left out).
    pub page: Option<String>,
    /// The LaTeX document the figure goes in: its folder (as `latex_list` shows it), its title, or any file in it.
    pub doc: String,
    /// The picture's file name in the document's figures folder, such as `architecture.png`. The diagram's title is used when left out.
    pub name: Option<String>,
    /// The width the `\includegraphics` line gets: `\linewidth` (the default), `0.8\linewidth`, `\textwidth`, `8cm`, `120mm`, `300pt` or `3in`.
    pub width: Option<String>,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}
