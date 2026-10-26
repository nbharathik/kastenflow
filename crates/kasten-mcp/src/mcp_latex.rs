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
        description = "Changes a LaTeX source file by replacing one piece of text with another. The text must be in the file once, and base_hash must be the hash latex_read gave: when the file changed since, nothing is written, so read it again and redo the change. A locked document is refused, and a change that takes out much of the file waits for the user's review (pending_review). To make a new file, a person adds it in the app."
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
        description = "What the last build of a document said: its errors and warnings, each with the file and line. The app builds a document while it is open, and this does not run TeX itself: after an edit, read it again once the app has built, and it says when a file changed after the last build.",
        annotations(read_only_hint = true)
    )]
    async fn latex_build(&self, Parameters(a): Parameters<LatexBuildArgs>) -> CallToolResult {
        self.run(move |k| tools::latex_build(k, a)).await
    }
}
