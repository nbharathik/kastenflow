//! The diagram file tools (rename, move, copy): tools of the Diagrams plugin,
//! listed only while it is on.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params_parity::*;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = diagram_more_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "Gives a diagram a new title. Its picture takes the name, and the links, embeds and whiteboard cards that name it follow. Refused when a locked note names it."
    )]
    async fn rename_diagram(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<RenameDiagramArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::rename_diagram(k, a))
            .await
    }

    #[tool(
        description = "Moves a diagram into a project, or into the library when no project is given. Links to it keep working. Refused when a locked note names it."
    )]
    async fn move_diagram(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<MoveDiagramArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::move_diagram(k, a))
            .await
    }

    #[tool(
        description = "Makes a copy of a diagram next to it, with its picture. Use it to try a change without losing the original."
    )]
    async fn duplicate_diagram(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<DuplicateDiagramArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::duplicate_diagram(k, a))
            .await
    }
}
