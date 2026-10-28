//! The tools that put a picture, a citation and a page into a LaTeX document,
//! over MCP. They belong to the LaTeX plugin with the others
//! (`mcp_latex.rs`), and are listed only while it is on.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params_latex_more::*;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = latex_more_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "Puts a picture in a LaTeX document's figures folder and gives back the path to use in \\includegraphics. Send the bytes as base64, or name a picture already in the vault. Use PNG (or JPG or PDF): an SVG is kept but TeX cannot use it without extra programs. KastenFlow never runs Python or any program, so make a chart on your side and send the PNG. The same picture sent twice is one file. A locked document is refused, and a picture that is too big is refused."
    )]
    async fn latex_add_asset(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<LatexAddAssetArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::latex_add_asset(k, &session, tools::Writes::Direct, a))
            .await
    }

    #[tool(
        description = "Cites a reference from the user's References in a LaTeX file: it writes \\cite{key} at the end of the paragraph that holds the text you name in at (or at the end of the file's text), and keeps the reference's entry in the document's references.bib, once. The reference itself is never changed. An unknown key is refused (list_references shows the keys). A locked document is refused, and where the user wants to review changes the citation waits for their review (pending_review)."
    )]
    async fn latex_cite(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<LatexCiteArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::latex_cite(k, &session, tools::Writes::Direct, a))
            .await
    }

    #[tool(
        description = "Sends a page, or one section of it, to LaTeX as the app's Send to LaTeX does: the text is converted (special characters escaped, [@key] citations kept as \\cite), then added at the end of the root file of the document you name in doc, or made into a new document (title, template and project). A locked document is refused, and where the user wants to review changes it waits for their review (pending_review)."
    )]
    async fn latex_send_page(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<LatexSendPageArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::latex_send_page(k, &session, tools::Writes::Direct, a))
            .await
    }
}
