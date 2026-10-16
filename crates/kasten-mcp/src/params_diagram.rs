//! Arguments of the tools that draw and check diagrams, with the
//! descriptions agents see in each tool's schema.

use rmcp::schemars::JsonSchema;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct DiagramPageArgs {
    /// The diagram's title or vault path (`.drawio`).
    pub diagram: String,
    /// A page's name, id or number (the first page when left out).
    pub page: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct FindShapesArgs {
    /// What to look for: words of the thing, such as `lambda`, `message queue`, `pod`, `decision`. Left empty, the libraries are listed.
    #[serde(default)]
    pub query: String,
    /// Only this library: `aws4`, `azure2`, `kubernetes`, `flowchart`, `uml`, `er`, `bpmn`, `networks`, `cisco`, `archimate3`, `gcp2`.
    pub library: Option<String>,
    /// At most this many shapes (default 20, at most 100).
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct NewDiagramArgs {
    /// The diagram's title: it names the file.
    pub title: String,
    /// A project's folder name under projects/; without it the diagram goes to the library.
    pub project: Option<String>,
    /// A description: `{preset?, direction?: "LR"|"TB", layout?, title?, groups?: [{id, label, kind?, group?}], nodes: [{id, label, kind?, shape?, group?, x?, y?}], edges: [{from, to, label?, kind?}]}`. Give one of spec, mermaid or template.
    pub spec: Option<Value>,
    /// A Mermaid flowchart (`graph LR`, `flowchart TD`; shapes, `-->`, `-.->`, `==>`, labels, `subgraph`). Styling is left out and said.
    pub mermaid: Option<String>,
    /// A template: c4-context, c4-container, c4-component, three-tier, event-driven, ci-cd, data-pipeline, network, sequence or er.
    pub template: Option<String>,
    /// Lay the diagram out (the default); false puts boxes where there is room, or at the x and y a spec gives.
    pub layout: Option<bool>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct EditDiagramArgs {
    /// The diagram's title or vault path (`.drawio`).
    pub diagram: String,
    /// The steps, in order, at most 200: objects tagged by `op`. add_node{id, label?, kind? | shape?, x?, y?, w?, h?, group?, near?, side?, set?}, add_edge{from, to, label?, kind?, id?, waypoints?, set?}, update{id, label?, kind?, set?, unset?}, move{id, x?, y? | dx?, dy?, group?}, resize{id, w?, h?}, restyle{ids, token? | kind?, set?, unset?}, group{id, label?, members, kind?, padding?}, ungroup{id}, delete{ids}, set_page{page, name?, width?, height?}, add_page{name}, layout{scope?, direction?, spacing?}. Coordinates are page coordinates, as diagram_describe shows them.
    pub steps: Vec<Value>,
    /// The page the steps start on (a name, id or number); the first when left out. set_page and add_page change it.
    pub page: Option<String>,
    /// The preset kinds are looked up in (default architecture-light).
    pub preset: Option<String>,
    /// Why, for the person reviewing it.
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(crate = "rmcp::schemars")]
pub struct ExportDiagramArgs {
    /// The diagram's title or vault path (`.drawio`).
    pub diagram: String,
    /// `svg` (kept in assets/ and ready to put in a note or a slide) or `png`.
    pub format: String,
    /// A page's name, id or number (the first page when left out).
    pub page: Option<String>,
}
