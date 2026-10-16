//! The read tools over MCP: their descriptions and schemas for
//! `tools/list`, each run by its implementation in `tools`.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params::*;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = read_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "Ranked full-text search with snippets. Filters narrow by tag, project, type and date. The query may also hold on:2026-10-06 (made or changed that day), created:2026-10 or updated:2026-09-01..2026-09-30 (a day, a month or a range) and under:<note id or path> (that page and its sub-pages).",
        annotations(read_only_hint = true)
    )]
    async fn search(&self, Parameters(args): Parameters<SearchArgs>) -> CallToolResult {
        self.run(move |k| tools::search(k, args)).await
    }

    #[tool(
        description = "A note's frontmatter, properties and Markdown body, by id, title or path; optionally the notes linking to it.",
        annotations(read_only_hint = true)
    )]
    async fn read_note(&self, Parameters(args): Parameters<ReadNoteArgs>) -> CallToolResult {
        self.run(move |k| tools::read_note(k, args)).await
    }

    #[tool(
        description = "Notes' metadata without bodies, filtered by project, tag or type.",
        annotations(read_only_hint = true)
    )]
    async fn list_notes(&self, Parameters(args): Parameters<ListNotesArgs>) -> CallToolResult {
        self.run(move |k| tools::list_notes(k, args)).await
    }

    #[tool(
        description = "Rows of a tag's database: the notes with that tag and their properties, filtered and sorted.",
        annotations(read_only_hint = true)
    )]
    async fn query_tag(&self, Parameters(args): Parameters<QueryTagArgs>) -> CallToolResult {
        self.run(move |k| tools::query_tag(k, args)).await
    }

    #[tool(
        description = "A day's journal note; defaults to today (UTC). Reading never creates it.",
        annotations(read_only_hint = true)
    )]
    async fn get_journal(&self, Parameters(args): Parameters<JournalArgs>) -> CallToolResult {
        self.run(move |k| tools::get_journal(k, args)).await
    }

    #[tool(
        description = "Commits that changed a note, newest first, with who made them (agent sessions included).",
        annotations(read_only_hint = true)
    )]
    async fn get_history(&self, Parameters(args): Parameters<HistoryArgs>) -> CallToolResult {
        self.run(move |k| tools::get_history(k, args)).await
    }

    #[tool(
        description = "Every tag in use with its note count, and the schemas (properties and views) of tags that have one.",
        annotations(read_only_hint = true)
    )]
    async fn list_tags(&self) -> CallToolResult {
        self.run(tools::list_tags).await
    }

    #[tool(
        description = "The vault's templates: name, type, icon, tags and a glimpse of each. Pages start from one with create_note's template.",
        annotations(read_only_hint = true)
    )]
    async fn list_templates(&self) -> CallToolResult {
        self.run(tools::list_templates).await
    }

    #[tool(
        description = "How this server is doing: its version, the vault, whether the vault keeps history (so every change you make can be undone), your session, and whether slides can be drawn here (a browser, the page it draws with, the sandbox). Read it when something does not work. It changes nothing.",
        annotations(read_only_hint = true)
    )]
    async fn server_status(&self, context: RequestContext<RoleServer>) -> CallToolResult {
        let session = self.peek_session(&context);
        self.run(move |k| tools::server_status(k, session.as_ref()))
            .await
    }
}
