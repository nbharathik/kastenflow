//! The diagram tools over MCP: their descriptions and schemas for
//! `tools/list`, each run by its implementation in `tools`.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params::*;
use crate::server::KastenServer;
use crate::tools;

#[tool_router(router = diagram_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "Every diagram (flowchart, architecture, sketch) with its title, project, number of pages and whether its picture is up to date.",
        annotations(read_only_hint = true)
    )]
    async fn list_diagrams(&self) -> CallToolResult {
        self.run(tools::list_diagrams).await
    }

    #[tool(
        description = "A diagram's source: draw.io's uncompressed mxfile XML (pages of mxCell elements: vertices with a value and a geometry, edges with a source and a target). Read it before changing it with update_diagram.",
        annotations(read_only_hint = true)
    )]
    async fn get_diagram(&self, Parameters(a): Parameters<DiagramArgs>) -> CallToolResult {
        self.run(move |k| tools::get_diagram(k, a)).await
    }

    #[tool(
        description = "A new diagram in a project or the library, from draw.io's uncompressed mxfile XML (blank when xml is left out). Shape: <mxfile><diagram name=\"Page-1\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/> cells... </root></mxGraphModel></diagram></mxfile>. A box: <mxCell id=\"a\" value=\"Label\" style=\"rounded=1;whiteSpace=wrap;html=1;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"40\" y=\"40\" width=\"120\" height=\"60\" as=\"geometry\"/></mxCell>. An arrow: <mxCell id=\"e1\" style=\"edgeStyle=orthogonalEdgeStyle;html=1;\" edge=\"1\" parent=\"1\" source=\"a\" target=\"b\"><mxGeometry relative=\"1\" as=\"geometry\"/></mxCell>. Give every cell a short unique id. The picture is drawn when the app next has the diagram editor."
    )]
    async fn create_diagram(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<CreateDiagramArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::create_diagram(k, a))
            .await
    }

    #[tool(
        description = "Replaces a diagram's source with the XML given: take get_diagram's XML, change it, send the whole of it, and keep the id of every cell you do not mean to change. A change that takes many cells out waits for the user's review (pending_review); if the user changed the diagram meanwhile, theirs stays and yours is kept as a copy beside it."
    )]
    async fn update_diagram(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<UpdateDiagramArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::update_diagram(k, a))
            .await
    }

    #[tool(
        description = "Moves a diagram, and the picture beside it, to the trash. Always waits for the user's review (pending_review); nothing is deleted."
    )]
    async fn trash_diagram(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<TrashDiagramArgs>,
    ) -> CallToolResult {
        self.agent(&context, move |k| tools::trash_diagram(k, a))
            .await
    }
}
