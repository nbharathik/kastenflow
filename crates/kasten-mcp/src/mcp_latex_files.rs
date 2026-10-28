//! The tools that make LaTeX documents and write, add to and take out their
//! files, over MCP. They belong to the LaTeX plugin with the others
//! (`mcp_latex.rs`), and are listed only while it is on.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params_latex_files::*;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = latex_file_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "Starts a new LaTeX document: a folder of its own with a root file made from a template (article, report or beamer; an article when you name none), in a project or in the library. A name that is taken gets a number. It gives back the folder and the root file; add other files with latex_write_file. Where the user wants to review changes, the new document waits for their review (pending_review)."
    )]
    async fn latex_create_document(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<LatexCreateDocumentArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::latex_create_document(k, &session, tools::Writes::Direct, a))
            .await
    }

    #[tool(
        description = "Writes a whole LaTeX source file of a document (.tex, .sty, .cls, .bst or .bib), in its folder or a folder below it. Leave base_hash out to make a new file, which must not be there yet. To replace a file, send the hash latex_read gave as base_hash: when the file changed since, nothing is written, so read it again and redo the change. A locked document is refused, and a rewrite that takes out much of a file waits for the user's review (pending_review). To change a small part of a file, use latex_edit."
    )]
    async fn latex_write_file(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<LatexWriteFileArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::latex_write_file(k, &session, tools::Writes::Direct, a))
            .await
    }

    #[tool(
        description = "Adds text to a LaTeX source file without sending the whole file: at its end, or right after a piece of text you name in after, which must be in the file once. The end of the root file is after \\end{document}, so give after to add inside the document. base_hash must be the hash latex_read gave: when the file changed since, nothing is written. A file with Windows line breaks keeps them. A locked document is refused."
    )]
    async fn latex_append(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<LatexAppendArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::latex_append(k, &session, tools::Writes::Direct, a))
            .await
    }

    #[tool(
        description = "Takes a LaTeX source file out of a document by moving it to the trash, where the user can put it back; nothing is deleted for good. Taking out a document's root file waits for the user's review (pending_review). A locked document is refused."
    )]
    async fn latex_delete_file(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<LatexDeleteFileArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::latex_delete_file(k, &session, tools::Writes::Direct, a))
            .await
    }
}
