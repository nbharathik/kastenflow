//! The whiteboard tools: read_board, create_board,
//! add_to_board, connect and group_on_board, plus list_boards.

use kasten_core::agent::AgentOp;
use kasten_core::board::BoardView;
use kasten_core::{Kasten, Result};
use serde_json::Value;

use super::as_json;
use super::lookup::Lookup;
use crate::params::*;

pub(crate) fn list_boards(k: &Kasten) -> Result<Value> {
    as_json(k.boards()?)
}

pub(crate) fn read_board(k: &Kasten, a: BoardArgs) -> Result<Value> {
    let path = k.resolve_board(&a.board)?;
    board_json(&k.board(&path)?)
}

/// A board as an agent reads it. A drawing's line is thousands of numbers
/// that tell an agent nothing: it gets how many there are.
pub(crate) fn board_json(view: &BoardView) -> Result<Value> {
    let mut board = as_json(view)?;
    if let Some(nodes) = board.get_mut("nodes").and_then(Value::as_array_mut) {
        for draw in nodes.iter_mut().filter_map(|n| n.get_mut("draw")) {
            let count = draw["points"]
                .as_str()
                .map_or(0, |p| p.split_whitespace().count());
            draw["points"] = count.into();
        }
    }
    Ok(board)
}

pub(crate) fn create_board(_: &dyn Lookup, a: CreateBoardArgs) -> Result<AgentOp> {
    Ok(AgentOp::CreateBoard {
        title: a.title,
        project: a.project,
    })
}

pub(crate) fn add_to_board(k: &dyn Lookup, a: AddToBoardArgs) -> Result<AgentOp> {
    let board = k.resolve_board(&a.board)?;
    let notes = a
        .notes
        .iter()
        .map(|n| k.resolve(n))
        .collect::<Result<Vec<_>>>()?;
    Ok(AgentOp::AddToBoard {
        board,
        notes,
        layout: a.layout,
        positions: a.positions,
    })
}

pub(crate) fn connect(k: &dyn Lookup, a: ConnectArgs) -> Result<AgentOp> {
    Ok(AgentOp::Connect {
        board: k.resolve_board(&a.board)?,
        from: a.from,
        to: a.to,
        label: a.label,
    })
}

pub(crate) fn group_on_board(k: &dyn Lookup, a: GroupArgs) -> Result<AgentOp> {
    Ok(AgentOp::Group {
        board: k.resolve_board(&a.board)?,
        nodes: a.nodes,
        label: a.title,
    })
}
