//! Diagram files and the history of agent sessions: rename, move and copy a
//! diagram, list the sessions, and take one back.

use kasten_core::agent::AgentOp;
use kasten_core::{Kasten, Result};
use serde_json::{Value, json};

use super::as_json;
use super::lookup::Lookup;
use crate::params_parity::*;

pub(crate) fn rename_diagram(k: &dyn Lookup, a: RenameDiagramArgs) -> Result<AgentOp> {
    Ok(AgentOp::RenameDiagram {
        path: k.resolve_diagram(&a.diagram)?,
        title: a.title,
    })
}

pub(crate) fn move_diagram(k: &dyn Lookup, a: MoveDiagramArgs) -> Result<AgentOp> {
    Ok(AgentOp::MoveDiagram {
        path: k.resolve_diagram(&a.diagram)?,
        project: a.project.filter(|p| !p.trim().is_empty()),
    })
}

pub(crate) fn duplicate_diagram(k: &dyn Lookup, a: DuplicateDiagramArgs) -> Result<AgentOp> {
    Ok(AgentOp::DuplicateDiagram {
        path: k.resolve_diagram(&a.diagram)?,
    })
}

pub(crate) fn list_sessions(k: &Kasten, a: ListSessionsArgs) -> Result<Value> {
    let sessions = k.sessions(a.limit.unwrap_or(20).clamp(1, 200))?;
    Ok(json!({ "total": sessions.len(), "sessions": as_json(sessions)? }))
}

/// Takes back a session: yours when none is named.
pub(crate) fn undo_session(_: &dyn Lookup, a: UndoSessionArgs, own: &str) -> Result<AgentOp> {
    Ok(AgentOp::UndoSession {
        session: a
            .session
            .map(|s| s.trim().to_owned())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| own.to_owned()),
    })
}
