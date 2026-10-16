//! The diagram tools: list_diagrams, get_diagram, create_diagram,
//! update_diagram and trash_diagram. A diagram is its draw.io XML; the picture
//! beside it is drawn by the app's editor, never by an agent.

use kasten_core::agent::AgentOp;
use kasten_core::diagrams::{DiagramFile, title_of};
use kasten_core::{Kasten, Result};
use serde_json::{Value, json};

use super::as_json;
use super::lookup::Lookup;
use crate::params::*;

pub(crate) fn list_diagrams(k: &Kasten) -> Result<Value> {
    as_json(k.diagrams()?)
}

pub(crate) fn get_diagram(k: &Kasten, a: DiagramArgs) -> Result<Value> {
    let path = k.resolve_diagram(&a.diagram)?;
    diagram_json(&path, &k.diagram(&path)?)
}

/// A diagram as an agent reads it: its source and its title.
pub(crate) fn diagram_json(path: &str, file: &DiagramFile) -> Result<Value> {
    let mut diagram = as_json(file)?;
    diagram["title"] = json!(title_of(path));
    Ok(diagram)
}

pub(crate) fn create_diagram(_: &dyn Lookup, a: CreateDiagramArgs) -> Result<AgentOp> {
    Ok(AgentOp::CreateDiagram {
        title: a.title,
        project: a.project,
        xml: a.xml.unwrap_or_default(),
    })
}

pub(crate) fn update_diagram(k: &dyn Lookup, a: UpdateDiagramArgs) -> Result<AgentOp> {
    let path = k.resolve_diagram(&a.diagram)?;
    // Written against the source read now: if a person changes the diagram
    // before this is accepted, theirs stays and this version goes beside it.
    let base = k.diagram_xml(&path)?;
    Ok(AgentOp::UpdateDiagram {
        path,
        xml: a.xml,
        base,
        reason: a.reason,
    })
}

pub(crate) fn trash_diagram(k: &dyn Lookup, a: TrashDiagramArgs) -> Result<AgentOp> {
    Ok(AgentOp::Trash {
        path: k.resolve_diagram(&a.diagram)?,
        reason: a.reason,
    })
}
