//! Typed edits to a diagram: the steps an agent sends in place of a whole
//! XML file. A step names what to do (`add_node`, `add_edge`, `layout`, …) and
//! the cells it is about; the model writes the XML. Steps are replayed on the
//! diagram as it is when they run, so they merge with a person's concurrent
//! edit cell by cell, and a step whose cells are gone says so instead of
//! overwriting anything. Bytes of cells no step touched stay as they were.

mod apply;
mod edges;
mod group;
mod nodes;
mod style;
mod validate;

#[cfg(test)]
mod tests;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::model::{Doc, MAX_CELLS};
use super::presets::{self, Preset};
use crate::error::{Error, Result};

pub use validate::{check_style_item, image_ok, link_ok};

/// The most steps one call may carry.
pub const MAX_STEPS: usize = 200;
/// The most cells one call may add.
pub const MAX_NEW_CELLS: usize = 500;

/// A point of the page.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// One change to a diagram. Coordinates are page coordinates (what
/// `diagram_describe` shows); the model converts them for cells inside a group.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Step {
    /// A box. `kind` names a style of the preset (service, database, …), or
    /// `shape` a shape of the editor's libraries (`aws4.lambda`).
    AddNode {
        id: String,
        #[serde(default)]
        label: String,
        kind: Option<String>,
        shape: Option<String>,
        x: Option<f64>,
        y: Option<f64>,
        w: Option<f64>,
        h: Option<f64>,
        /// A group to put it in.
        group: Option<String>,
        /// A node to put it beside, on `side` (right, left, above, below).
        near: Option<String>,
        side: Option<String>,
        /// Extra style words, `{"fillColor": "#dae8fc"}`.
        set: Option<BTreeMap<String, String>>,
    },
    /// An arrow between two nodes.
    AddEdge {
        from: String,
        to: String,
        label: Option<String>,
        kind: Option<String>,
        id: Option<String>,
        waypoints: Option<Vec<Point>>,
        set: Option<BTreeMap<String, String>>,
    },
    /// New words, a new kind or style words for a node, group or edge.
    Update {
        id: String,
        label: Option<String>,
        kind: Option<String>,
        set: Option<BTreeMap<String, String>>,
        unset: Option<Vec<String>>,
    },
    /// Move a node: to `x`,`y`, or by `dx`,`dy`; `group` moves it into a group
    /// (`page` takes it out of its group).
    Move {
        id: String,
        x: Option<f64>,
        y: Option<f64>,
        dx: Option<f64>,
        dy: Option<f64>,
        group: Option<String>,
    },
    Resize {
        id: String,
        w: Option<f64>,
        h: Option<f64>,
    },
    /// Colour with a token (blue, green, yellow, orange, red, purple, grey),
    /// give a kind's style (`kind`, or `preset`), set or take away words.
    Restyle {
        ids: Vec<String>,
        token: Option<String>,
        kind: Option<String>,
        preset: Option<String>,
        set: Option<BTreeMap<String, String>>,
        unset: Option<Vec<String>>,
    },
    /// A titled container around `members`.
    Group {
        id: String,
        #[serde(default)]
        label: String,
        members: Vec<String>,
        kind: Option<String>,
        padding: Option<f64>,
    },
    /// Takes a group away and leaves its members where they are.
    Ungroup { id: String },
    /// Takes cells out. Arrows to them go too, and what a group holds.
    Delete { ids: Vec<String> },
    /// Chooses the page the next steps work on, and renames or resizes it.
    SetPage {
        page: String,
        name: Option<String>,
        width: Option<f64>,
        height: Option<f64>,
    },
    /// A new page; the next steps work on it.
    AddPage { name: String },
    /// Lays nodes out in layers. `scope` is `all` or a group's id.
    Layout {
        scope: Option<String>,
        /// `LR` or `TB`; the preset's own when left out.
        direction: Option<String>,
        /// `compact`, `normal` or `wide`.
        spacing: Option<String>,
    },
}

impl Step {
    pub fn name(&self) -> &'static str {
        match self {
            Step::AddNode { .. } => "add_node",
            Step::AddEdge { .. } => "add_edge",
            Step::Update { .. } => "update",
            Step::Move { .. } => "move",
            Step::Resize { .. } => "resize",
            Step::Restyle { .. } => "restyle",
            Step::Group { .. } => "group",
            Step::Ungroup { .. } => "ungroup",
            Step::Delete { .. } => "delete",
            Step::SetPage { .. } => "set_page",
            Step::AddPage { .. } => "add_page",
            Step::Layout { .. } => "layout",
        }
    }
}

/// What a run of steps did.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Applied {
    /// The ids of the cells it made, in order.
    pub ids: Vec<String>,
    pub nodes: usize,
    pub edges: usize,
    pub groups: usize,
    pub updated: usize,
    pub moved: usize,
    pub deleted: usize,
    pub layouts: usize,
    pub pages: usize,
    /// Things worth telling the agent: a node put somewhere, a layout that left cells alone.
    pub notes: Vec<String>,
}

/// A diagram's text after the steps.
#[derive(Debug, Clone, PartialEq)]
pub struct Edited {
    pub xml: String,
    pub applied: Applied,
    pub changed: bool,
}

/// A step that could not be made again, and why.
#[derive(Debug, Clone, PartialEq)]
pub struct Skipped {
    pub step: usize,
    pub why: String,
}

/// Steps in words for a commit or a review: `add 3 nodes, 2 links, layout`.
pub fn summarize(steps: &[Step]) -> String {
    let count = |f: &dyn Fn(&Step) -> usize| steps.iter().map(f).sum::<usize>();
    let plural =
        |n: usize, one: &str, many: &str| format!("{n} {}", if n == 1 { one } else { many });
    let mut parts = Vec::new();
    let nodes = count(&|s| usize::from(matches!(s, Step::AddNode { .. })));
    if nodes > 0 {
        parts.push(format!("add {}", plural(nodes, "node", "nodes")));
    }
    let links = count(&|s| usize::from(matches!(s, Step::AddEdge { .. })));
    if links > 0 {
        parts.push(plural(links, "link", "links"));
    }
    let groups = count(&|s| usize::from(matches!(s, Step::Group { .. })));
    if groups > 0 {
        parts.push(plural(groups, "group", "groups"));
    }
    let edits = count(&|s| {
        usize::from(matches!(
            s,
            Step::Update { .. } | Step::Restyle { .. } | Step::Resize { .. }
        ))
    });
    if edits > 0 {
        parts.push(format!("restyle {}", plural(edits, "item", "items")));
    }
    let moves = count(&|s| usize::from(matches!(s, Step::Move { .. } | Step::Ungroup { .. })));
    if moves > 0 {
        parts.push(format!("move {}", plural(moves, "item", "items")));
    }
    let gone = count(&|s| match s {
        Step::Delete { ids } => ids.len(),
        _ => 0,
    });
    if gone > 0 {
        parts.push(format!("delete {}", plural(gone, "item", "items")));
    }
    let pages = count(&|s| usize::from(matches!(s, Step::AddPage { .. } | Step::SetPage { .. })));
    if pages > 0 {
        parts.push(plural(pages, "page change", "page changes"));
    }
    if steps.iter().any(|s| matches!(s, Step::Layout { .. })) {
        parts.push("layout".to_owned());
    }
    if parts.is_empty() {
        "no changes".to_owned()
    } else {
        parts.join(", ")
    }
}

/// The state a run of steps works in.
pub(super) struct Runner {
    pub doc: Doc,
    pub page: usize,
    pub preset: &'static Preset,
    pub applied: Applied,
    pub new_cells: usize,
}

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

impl Runner {
    fn new(xml: &str, page: Option<&str>, preset: Option<&str>) -> Result<Runner> {
        let doc = Doc::parse(xml)?;
        let page = doc.find_page(page)?;
        let preset = match preset.map(str::trim).filter(|p| !p.is_empty()) {
            None => presets::preset(presets::DEFAULT),
            Some(id) => Some(presets::preset(id).ok_or_else(|| {
                let ids: Vec<&str> = presets::all().iter().map(|p| p.id).collect();
                invalid(format!(
                    "No preset called “{id}”; the presets are {}",
                    ids.join(", ")
                ))
            })?),
        }
        .ok_or_else(|| invalid("The default preset is missing"))?;
        Ok(Runner {
            doc,
            page,
            preset,
            applied: Applied::default(),
            new_cells: 0,
        })
    }

    fn finish(self, original: &str) -> Result<Edited> {
        if self.doc.count() > MAX_CELLS {
            return Err(invalid(format!(
                "A diagram may hold at most {MAX_CELLS} cells; this would make {}. Split it over pages or take cells out",
                self.doc.count()
            )));
        }
        let xml = self.doc.render().map_err(invalid)?;
        super::check_xml(&xml)?;
        let changed = xml != original;
        Ok(Edited {
            xml,
            applied: self.applied,
            changed,
        })
    }
}

fn at_step(i: usize, step: &Step, err: Error) -> Error {
    match err {
        Error::Invalid(why) => invalid(format!("Step {} ({}): {why}", i + 1, step.name())),
        other => other,
    }
}

fn check_count(steps: &[Step]) -> Result<()> {
    if steps.len() > MAX_STEPS {
        return Err(invalid(format!(
            "At most {MAX_STEPS} steps may be sent at once; this is {}. Send them in more than one call",
            steps.len()
        )));
    }
    Ok(())
}

/// Runs `steps` on the diagram `xml`. With no steps the text comes back
/// byte for byte. A failing step stops the run and names itself.
pub fn replay(
    xml: &str,
    page: Option<&str>,
    preset: Option<&str>,
    steps: &[Step],
) -> Result<Edited> {
    check_count(steps)?;
    run_all(xml, page, preset, steps)
}

fn run_all(xml: &str, page: Option<&str>, preset: Option<&str>, steps: &[Step]) -> Result<Edited> {
    let mut run = Runner::new(xml, page, preset)?;
    for (i, step) in steps.iter().enumerate() {
        run.step(step).map_err(|e| at_step(i, step, e))?;
    }
    run.finish(xml)
}

/// `replay`, leaving out the steps that cannot be made (a cell they name is
/// gone, an id is now taken): the steps that were made come back with what
/// was left out. For making a staged edit again on a diagram that changed.
pub fn replay_tolerant(
    xml: &str,
    page: Option<&str>,
    preset: Option<&str>,
    steps: &[Step],
) -> Result<(Edited, Vec<Step>, Vec<Skipped>)> {
    check_count(steps)?;
    let mut run = Runner::new(xml, page, preset)?;
    let mut kept = Vec::new();
    let mut skipped = Vec::new();
    for (i, step) in steps.iter().enumerate() {
        let backup = (
            run.doc.clone(),
            run.page,
            run.applied.clone(),
            run.new_cells,
        );
        match run.step(step) {
            Ok(()) => kept.push(step.clone()),
            Err(err) => {
                (run.doc, run.page, run.applied, run.new_cells) = backup;
                skipped.push(Skipped {
                    step: i,
                    why: at_step(i, step, err).to_string(),
                });
            }
        }
    }
    Ok((run.finish(xml)?, kept, skipped))
}

/// Starts a diagram from nothing: the text of a blank diagram with the steps
/// run. A new diagram is built from a spec that may need more steps than a
/// call may send; it is held to the limit on cells instead.
pub fn from_steps(preset: Option<&str>, steps: &[Step]) -> Result<Edited> {
    run_all(&super::blank_xml(), None, preset, steps)
}

/// How a step list is told to a person who reads a review.
pub fn describe(steps: &[Step]) -> String {
    let mut out = Vec::new();
    for s in steps.iter().take(12) {
        out.push(match s {
            Step::AddNode { id, label, .. } => {
                format!("add node {id} “{}”", label.replace('\n', " "))
            }
            Step::AddEdge {
                from, to, label, ..
            } => format!(
                "connect {from} → {to}{}",
                label.as_ref().map_or(String::new(), |l| format!(" “{l}”"))
            ),
            Step::Update { id, .. } => format!("update {id}"),
            Step::Move { id, .. } => format!("move {id}"),
            Step::Resize { id, .. } => format!("resize {id}"),
            Step::Restyle { ids, .. } => format!("restyle {}", ids.join(", ")),
            Step::Group { id, members, .. } => format!("group {} as {id}", members.join(", ")),
            Step::Ungroup { id } => format!("ungroup {id}"),
            Step::Delete { ids } => format!("delete {}", ids.join(", ")),
            Step::SetPage { page, .. } => format!("work on page {page}"),
            Step::AddPage { name } => format!("add page “{name}”"),
            Step::Layout { scope, .. } => {
                format!("lay out {}", scope.as_deref().unwrap_or("everything"))
            }
        });
    }
    if steps.len() > 12 {
        out.push(format!("… and {} more", steps.len() - 12));
    }
    out.join("\n")
}
