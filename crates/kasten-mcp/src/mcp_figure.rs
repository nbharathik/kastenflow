//! The tools that need the desktop app to draw a picture: a diagram as a
//! LaTeX figure (it needs the Diagrams and the LaTeX plugin, so it is listed
//! only while both are on), and the person's selection (no plugin: it is
//! always listed). The server draws and reads nothing itself: it asks the app
//! through the vault's mailbox and says plainly when the app is closed.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params_figure::*;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = figure_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "Draws a diagram as a PNG and keeps it as a figure of a LaTeX document, in one step: the KastenFlow app draws the picture (the diagram editor's own when it drew one for the diagram as it is, else a draft the program makes), so the app must be open and you are told if it is closed. It gives back the figure's path and a ready \\includegraphics line, with the width you ask for. Needs the Diagrams and the LaTeX plugins. A locked document is refused, and a picture that is too big is refused."
    )]
    async fn diagram_to_latex_figure(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<DiagramToFigureArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::diagram_to_latex_figure(k, &session, tools::Writes::Direct, a))
            .await
    }
}

#[tool_router(router = selection_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "What the user has selected in KastenFlow right now: up to five pieces of text from a page, a PDF, a slide or a LaTeX file, each with the file's path, its title, the heading it sits under, where it is in the text, and the words, and for a slide the ids of the selected elements. Ask this when the user says \"this\", \"the selected part\" or \"what I am looking at\". Needs the app open: it answers \"nothing is selected\", \"the app is closed\" or \"the selection is out of date\" in plain words. The app shows the user that a client is reading their selection, and shares it for two minutes after each ask.",
        annotations(read_only_hint = true)
    )]
    async fn get_selection(&self) -> CallToolResult {
        self.run(tools::get_selection).await
    }
}
