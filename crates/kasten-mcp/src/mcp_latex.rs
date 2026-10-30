//! The LaTeX tools over MCP: their descriptions and schemas for `tools/list`,
//! each run by its implementation in `tools`. They are tools of the LaTeX
//! plugin, listed only while it is on.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params_latex::*;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = latex_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "Every LaTeX document in the vault: its folder, root file, engine and whether it is locked (read-only for you).",
        annotations(read_only_hint = true)
    )]
    async fn latex_list(&self) -> CallToolResult {
        self.run(tools::latex_list).await
    }

    #[tool(
        description = "Reads a LaTeX source file of a document (its root file when you give no file), with its hash, and lists the document's other source files. Send the hash back as base_hash when you change the file with latex_edit.",
        annotations(read_only_hint = true)
    )]
    async fn latex_read(&self, Parameters(a): Parameters<LatexReadArgs>) -> CallToolResult {
        self.run(move |k| tools::latex_read(k, a)).await
    }

    #[tool(
        description = "Changes a LaTeX source file by replacing one piece of text with another. The text must be in the file once, and base_hash must be the hash latex_read gave: when the file changed since, nothing is written, so read it again and redo the change. A locked document is refused, and a change that takes out much of the file waits for the user's review (pending_review)."
    )]
    async fn latex_edit(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<LatexEditArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::latex_edit(k, &session, tools::Writes::Direct, a))
            .await
    }

    #[tool(
        description = "What the last build of a document said: its errors and warnings, each with the file and line. By default this only reads the last build (it says when a file changed after it). With wait set to true the app builds the document now and this gives the result: errors and warnings with file and line, the page count, the PDF's size and how long it took. Building needs the KastenFlow app open: you are told if it is closed or the build did not finish in time (timeout_seconds, 90 if left out, at most 300). To fix errors, change files with latex_edit and build again.",
        annotations(read_only_hint = true)
    )]
    async fn latex_build(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<LatexBuildArgs>,
    ) -> CallToolResult {
        let session = self.peek_session(&context);
        self.run(move |k| tools::latex_build(k, session.as_ref(), a))
            .await
    }
}
