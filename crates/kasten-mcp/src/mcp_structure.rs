//! The structure tools over MCP: their descriptions and schemas for
//! `tools/list`, each built by `tools` and run in the connection's session.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params_structure::*;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = structure_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "Puts a page inside another page, as a sub-page, or with no parent takes it out of its page. A page that goes inside a page of another project moves there with its own sub-pages, and links keep working. A page cannot go inside itself or one of its own sub-pages. Locked pages are refused."
    )]
    async fn set_parent(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<SetParentArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::set_parent(k, a)).await
    }

    #[tool(
        description = "Sets the order a page's sub-pages are shown in: list them first to last. Sub-pages you leave out follow alphabetically, and an empty list goes back to alphabetical. Only the parent page's order changes; nothing else in it."
    )]
    async fn reorder_children(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<ReorderChildrenArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::reorder_children(k, a))
            .await
    }

    #[tool(
        description = "Starts a new project, empty or from a setup (research, writing or presentation) with its pages and whiteboard ready. A project that is there is never touched: the new one takes the next free name. A setup that adds tag schemas waits for the user's review."
    )]
    async fn create_project(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<CreateProjectArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::create_project(k, a))
            .await
    }

    #[tool(
        description = "The ways a new project can start (create_project's setup): the built-in ones and the setups the user saved from their own projects, each with its id, name, a line about it, the pages it makes and the tag databases it brings.",
        annotations(read_only_hint = true)
    )]
    async fn list_setups(&self) -> CallToolResult {
        self.run(tools::list_setups).await
    }

    #[tool(
        description = "Saves a project as a setup that new projects can start from: copies of the project's starting pages (their text, with the project's name turned into a placeholder), the schemas and views of the tags the project uses, and its default properties. Nothing of the project is changed. It is written into the user's templates folder, so it always waits for the user's review unless the user lets agents work on their own. A project or page that is locked is refused."
    )]
    async fn save_project_setup(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<SaveProjectSetupArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::save_project_setup(k, a))
            .await
    }

    #[tool(
        description = "Sets a project's status, health, next action and review days. Every value is checked first and a bad one changes nothing. This is the only way to change them: update_props refuses those keys on a project page."
    )]
    async fn set_project_state(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<SetProjectStateArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::set_project_state(k, a))
            .await
    }

    #[tool(
        description = "Sets the views a tag's database shows (table, kanban, list, calendar, gallery, timeline: start and optional end date properties, optional group_by, scale week, month or quarter), keeping the tag's colour and properties as they are. A view can sort and filter by a formula property (a column worked out from the others, like days_left) as by any other. The views are checked first. Leaving out a view that is there waits for review; for a tag with no schema yet use update_tag_schema."
    )]
    async fn set_tag_views(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<SetTagViewsArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::set_tag_views(k, a))
            .await
    }

    #[tool(
        description = "Puts the rows of one view of a tag's database in the order you give (the order a person would drag them into), first to last. Only the tag's file changes, in that view's line; no note is touched. Rows you leave out follow at the end, an empty list takes the order away, and the order is used only while the view has no sort. The tag needs a schema with that view. An ordinary write."
    )]
    async fn set_view_order(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<SetViewOrderArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::set_view_order(k, a))
            .await
    }
}
