//! The page-block tools over MCP: their descriptions and schemas for
//! `tools/list`, each run by its implementation in `tools`.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params_pages::*;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = page_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "A page as blocks (paragraph, heading, list, todo, table, code, quote, callout, toggle, columns, column, embed, math, divider, html): each with an id such as b3, its depth, the headings above it, a glimpse of its text and a hash of its bytes. Read it before edit_page, which names blocks by id and hash. Long pages are read in parts with from and limit.",
        annotations(read_only_hint = true)
    )]
    async fn read_page_blocks(
        &self,
        Parameters(args): Parameters<ReadPageBlocksArgs>,
    ) -> CallToolResult {
        self.run(move |k| tools::read_page_blocks(k, args)).await
    }

    #[tool(
        description = "Changes a page by its blocks, in one change: insert, replace, move or delete blocks, tick a task, put blocks in columns, a toggle or a callout, change table cells, rows and columns, add an embed. Steps name blocks by the id and hash read_page_blocks gave, and are made on the page as it is now, all or none: a block that changed since you read it refuses the call and nothing is written, so read again. Blocks no step names keep every byte. Taking out over 40% of the page waits for review. Ids change with every edit; read again before the next call."
    )]
    async fn edit_page(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<EditPageArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::edit_page(k, a)).await
    }
}
