//! "Brainstorm on this board": ideas a model came up with,
//! placed as new cards in a new section of the board. Every step is an agent
//! op of one session, so it runs under the same guardrails as MCP, the
//! History view shows it as one session, and "Undo session" takes all of it
//! back.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{Kasten, Outcome};
use crate::agent::{AgentOp, Session};
use crate::error::{Error, Result};
use crate::time::Instant;

/// The most ideas one brainstorm places, well inside the guardrail on how
/// many notes one session may make in ten minutes.
pub const MAX_IDEAS: usize = 20;

/// One idea: a card's title and its text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Idea {
    pub title: String,
    #[serde(default)]
    pub text: String,
}

/// What a brainstorm made.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Brainstormed {
    pub session: String,
    /// The new cards' paths, in the ideas' order.
    pub cards: Vec<String>,
    /// The id of the section around them.
    pub section: String,
}

/// The project a board belongs to: `projects/<p>/boards/…`.
fn project_of(board: &str) -> Option<String> {
    let parts: Vec<&str> = board.split('/').collect();
    (parts.len() > 3 && parts[0] == "projects" && parts[2] == "boards").then(|| parts[1].to_owned())
}

/// An op's result, or why the brainstorm cannot go on.
fn done(outcome: Outcome) -> Result<Value> {
    match outcome {
        Outcome::Done { result } => Ok(result),
        Outcome::PendingReview { reason, .. } => Err(Error::Invalid(format!(
            "The brainstorm stopped to wait for review: {reason}"
        ))),
        // `agent_run` never stages; only a chat that previews its changes does.
        Outcome::Staged { result, .. } => Ok(result),
    }
}

fn text_at<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key]
        .as_str()
        .ok_or_else(|| Error::Invalid(format!("An op returned no {key}")))
}

impl Kasten {
    /// Makes a card for each idea (in the board's project, else the inbox),
    /// puts them on `board` in a grid, and wraps them in a new section called
    /// `label` that sits below what is there, all as `session`. Ideas without a title are
    /// skipped.
    pub fn brainstorm(
        &self,
        session: &Session,
        board: &str,
        label: &str,
        ideas: &[Idea],
        now: Instant,
    ) -> Result<Brainstormed> {
        let ideas: Vec<&Idea> = ideas
            .iter()
            .filter(|i| !i.title.trim().is_empty())
            .collect();
        if ideas.is_empty() {
            return Err(Error::Invalid(
                "A brainstorm needs at least one idea with a title".into(),
            ));
        }
        if ideas.len() > MAX_IDEAS {
            return Err(Error::Invalid(format!(
                "A brainstorm places at most {MAX_IDEAS} ideas, not {}",
                ideas.len()
            )));
        }
        let board = self.resolve_board(board)?;
        // The section, not just its cards, goes below what is there.
        let corners =
            crate::board::read_board(&self.vault, &board)?.grid_in_section_below(ideas.len());
        let project = project_of(&board);
        let mut cards = Vec::with_capacity(ideas.len());
        for idea in ideas {
            let op = AgentOp::CreateNote {
                note_type: "card".into(),
                title: crate::sources::one_line(&idea.title),
                body: idea.text.trim().to_owned(),
                project: project.clone(),
                tags: Vec::new(),
                props: Map::new(),
                parent: None,
                template: None,
            };
            let made = done(self.agent_run(session, &op, now)?)?;
            cards.push(text_at(&made, "path")?.to_owned());
        }
        let placed = done(self.agent_run(
            session,
            &AgentOp::AddToBoard {
                board: board.clone(),
                notes: cards.clone(),
                layout: None,
                positions: Some(corners.iter().map(|&(x, y)| [x, y]).collect()),
            },
            now,
        )?)?;
        let nodes: Vec<String> = placed["nodes"]
            .as_array()
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| id.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let label = match label.trim() {
            "" => "Brainstorm",
            label => label,
        };
        let grouped = done(self.agent_run(
            session,
            &AgentOp::Group {
                board,
                nodes,
                label: label.to_owned(),
            },
            now,
        )?)?;
        Ok(Brainstormed {
            session: session.id.clone(),
            cards,
            section: text_at(&grouped, "section")?.to_owned(),
        })
    }
}
