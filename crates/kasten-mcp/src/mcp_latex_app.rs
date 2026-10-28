//! The LaTeX tool that needs the app to keep something: `latex_export_pdf`.
//! It belongs to the LaTeX plugin with the others (`mcp_latex.rs`), and is
//! listed only while it is on.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params_latex::LatexExportPdfArgs;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = latex_app_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "Keeps the PDF of a LaTeX document in its folder, beside the root file, as one change. The app builds the document first if it needs it, so the KastenFlow app must be open: you are told if it is closed. The PDF is the app's own build, never something you send. Gives back the PDF's path, its page count and its size. A locked document is refused, and where the user wants to review changes it waits for their review (pending_review). Fix the errors latex_build reports before you export."
    )]
    async fn latex_export_pdf(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<LatexExportPdfArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::latex_export_pdf(k, &session, tools::Writes::Direct, a))
            .await
    }
}
