//! The smart page tools over MCP: their descriptions and schemas for
//! `tools/list`, each run by its implementation in `tools`. A smart page is a
//! page with `layout: smart` and a folder of code beside it, which the app runs
//! in place of the page's text. These tools are always listed; they only work
//! on files, and the page itself runs in the app.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params_smart::*;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = smart_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "Makes a smart page: a page with its own code (html, js, css, data) that the app runs in place of the page's text, to show live views of the user's notes. Send the files (text only, an index.html among them, at most 200 KB together) and, if the page reads notes, the queries it uses by name; a smart.yaml is made for you. The page and its files are made together as one change that one undo takes back, and in Review mode they wait for the user as one proposal. Run smart_check on it afterwards."
    )]
    async fn smart_create(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<SmartCreateArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::smart_create(k, &session, tools::Writes::Direct, a))
            .await
    }

    #[tool(
        description = "Reads a smart page: each file with its hash (and its text, up to a size), the manifest, the last errors the page reported while open in the app, and the data its queries return now. Send a hash back as base_hash when you change a file. Use file to read one file whole.",
        annotations(read_only_hint = true)
    )]
    async fn smart_read(&self, Parameters(a): Parameters<SmartReadArgs>) -> CallToolResult {
        self.run(move |k| tools::smart_read(k, a)).await
    }

    #[tool(
        description = "Changes one file of a smart page with steps: replace one piece of text with another (it must be in the file once), or rewrite the whole file. base_hash must be the hash smart_read gave: when the file changed since, nothing is written, so read it again and redo the change. Send line feeds in the text; a file with mixed line endings must match exactly. A locked page is refused, and in Review mode the change waits for the user (pending_review)."
    )]
    async fn smart_edit(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<SmartEditArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::smart_edit(k, &session, tools::Writes::Direct, a))
            .await
    }

    #[tool(
        description = "Writes one whole text file of a smart page: a new file, or a file that is there when you send its hash as base_hash. At most 200 KB; html, js, css, json, svg and txt files, and smart.yaml. A person adds pictures. For a small change to a big file use smart_edit."
    )]
    async fn smart_write_file(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<SmartWriteFileArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::smart_write_file(k, &session, tools::Writes::Direct, a))
            .await
    }

    #[tool(
        description = "Takes one file out of a smart page. It goes to the trash, where the user can put it back; nothing is deleted for good."
    )]
    async fn smart_delete_file(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<SmartDeleteFileArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::smart_delete_file(k, &session, tools::Writes::Direct, a))
            .await
    }

    #[tool(
        description = "Checks a smart page's files and says what to fix: each finding has a severity (error, warning, info), the file, the line and a sentence. It looks for HTML that is not closed, web addresses and network calls (a page has no network), files the page loads that are not there, queries that do not fit their tag's properties, a kit version this app does not have, and files over the size limits. It reads the files and does not run the page. It is a text check, not a parser: it can miss a script error or an address built from pieces, and the app's sandbox, not this check, keeps a page offline.",
        annotations(read_only_hint = true)
    )]
    async fn smart_check(&self, Parameters(a): Parameters<SmartCheckArgs>) -> CallToolResult {
        self.run(move |k| tools::smart_check(k, a)).await
    }

    #[tool(
        description = "Cannot draw a picture of a smart page yet: it answers drawn: false with the reason (not an error), after checking that the page and the view exist. Use smart_check for what is wrong with the files and smart_read for the errors the page reported while it was open in the app.",
        annotations(read_only_hint = true)
    )]
    async fn smart_render(&self, Parameters(a): Parameters<SmartRenderArgs>) -> CallToolResult {
        self.run(move |k| tools::smart_render(k, a)).await
    }
}
