//! The tools that draw and check diagrams over MCP: their descriptions and
//! schemas for `tools/list`, each run by its implementation in `tools`.

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{tool, tool_router};

use crate::params_diagram::*;
use crate::server::KastenServer;
use crate::tools::{self, Writes};

#[tool_router(router = diagram_ai_tools, vis = "pub")]
impl KastenServer {
    #[tool(
        description = "A diagram told in words and cells: every node with its label, kind and place in page coordinates (x, y, width, height), every edge, the groups and what they hold, free room to put more, the lint findings and whether its picture is up to date. Read it before changing a diagram, and use its ids and coordinates in diagram_edit.",
        annotations(read_only_hint = true)
    )]
    async fn diagram_describe(&self, Parameters(a): Parameters<DiagramPageArgs>) -> CallToolResult {
        self.run(move |k| tools::diagram_describe(k, a)).await
    }

    #[tool(
        description = "Looks up the draw.io shapes there are by name, so a style is never written by hand: AWS, Azure, Kubernetes, flowchart, UML, ER, BPMN, network, Cisco and ArchiMate icons. Each result has a key such as aws4.lambda; use it as add_node{shape: key}. With no query it lists the libraries. Templates that match the words come back too.",
        annotations(read_only_hint = true)
    )]
    async fn diagram_find_shapes(
        &self,
        Parameters(a): Parameters<FindShapesArgs>,
    ) -> CallToolResult {
        self.run(move |_| tools::diagram_find_shapes(a)).await
    }

    #[tool(
        description = "Checks a diagram and says what to fix: overlapping boxes, arrows to nothing, edges that cross or run through a box, labels missing or too long, too many nodes, boxes off the grid or the page, uneven sizes, tiny or low-contrast text, a missing title or legend, unsafe links and outside pictures. Each finding has the cell, a message and a hint. Fix errors and warnings, then check again.",
        annotations(read_only_hint = true)
    )]
    async fn diagram_lint(&self, Parameters(a): Parameters<DiagramPageArgs>) -> CallToolResult {
        self.run(move |k| tools::diagram_lint(k, a)).await
    }

    #[tool(
        description = "A picture of a diagram as SVG text: the diagram editor's own when it drew one for the diagram as it is, else a draft the program draws (boxes, arrows and words in their places; icons from the libraries are drawn as labelled boxes and listed in warnings). Use it to check the layout.",
        annotations(read_only_hint = true)
    )]
    async fn diagram_preview(&self, Parameters(a): Parameters<DiagramPageArgs>) -> CallToolResult {
        self.run(move |k| tools::diagram_preview(k, Writes::Direct, a))
            .await
    }

    #[tool(
        description = "Makes a new diagram from a description, laid out and ready, with a draft picture. Give exactly one of: spec (JSON: nodes with id, label and kind or shape, groups, edges with from, to, label, kind), mermaid (a flowchart), or template (c4-context, c4-container, c4-component, three-tier, event-driven, ci-cd, data-pipeline, network, sequence, er). Kinds come from the preset (architecture-light: service, database, cache, queue, storage, actor, client, gateway, external, worker, cloud; edges sync, async, data, both, depends, line; groups container, boundary, lane). Returns the path, the ids made and the lint findings. Change the result with diagram_edit."
    )]
    async fn diagram_new(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<NewDiagramArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::diagram_new(k, &session, Writes::Direct, a))
            .await
    }

    #[tool(
        description = "Changes a diagram with typed steps, in order (at most 200): add_node, add_edge, update, move, resize, restyle, group, ungroup, delete, set_page, add_page, layout. Nothing is sent as XML. The steps are run on the diagram as it is now, so what a person drew meanwhile is kept; a step that names a cell that is gone says so. Coordinates are page coordinates from diagram_describe; add_node with near and side puts a box beside another; layout tidies a page or a group. Taking out or moving most of a diagram's boxes waits for the user's review (pending_review). Returns the path, status, new hash, the ids made, the lint findings and picture: draft."
    )]
    async fn diagram_edit(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<EditDiagramArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::diagram_edit(k, &session, Writes::Direct, a))
            .await
    }

    #[tool(
        description = "Keeps a picture of a diagram in the vault's assets folder as an SVG file, ready to put in a note with ![](path) or on a slide. It is the editor's picture when the editor drew one for the diagram as it is, else the program's draft. With format png the KastenFlow app draws a PNG instead and keeps it in the same folder, so the app must be open: you are told if it is closed. For a LaTeX figure use diagram_to_latex_figure."
    )]
    async fn diagram_export(
        &self,
        context: RequestContext<RoleServer>,
        Parameters(a): Parameters<ExportDiagramArgs>,
    ) -> CallToolResult {
        let session = self.session(&context);
        self.run(move |k| tools::diagram_export(k, &session, Writes::Direct, a))
            .await
    }
}
