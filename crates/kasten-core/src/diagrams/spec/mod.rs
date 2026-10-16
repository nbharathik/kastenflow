//! A whole diagram from a description: a JSON spec of nodes, groups and
//! edges, a Mermaid flowchart, or a template. All three become the same
//! typed steps, so a new diagram is made by the code that edits one: styles
//! from the preset, a laid-out page, a title, a page the size of the drawing.

mod mermaid;
mod templates;

#[cfg(test)]
mod tests;

#[cfg(test)]
use mermaid::Parsed;

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

use super::model::Doc;
use super::presets;
use super::steps::{Applied, Edited, Step, from_steps, replay};
use crate::error::{Error, Result};

pub use mermaid::parse as parse_mermaid;
pub use templates::{TemplateInfo, templates};

/// A node of a spec.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpecNode {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub kind: Option<String>,
    pub shape: Option<String>,
    /// The group it is in.
    pub group: Option<String>,
    /// Where it goes, when the layout is not asked for.
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub set: Option<BTreeMap<String, String>>,
}

/// A titled container of a spec.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpecGroup {
    pub id: String,
    #[serde(default)]
    pub label: String,
    pub kind: Option<String>,
    /// The group it is in.
    pub group: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpecEdge {
    pub from: String,
    pub to: String,
    pub label: Option<String>,
    pub kind: Option<String>,
    pub set: Option<BTreeMap<String, String>>,
}

/// A diagram, described.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Spec {
    /// A heading drawn above the diagram.
    pub title: Option<String>,
    pub preset: Option<String>,
    /// `LR` or `TB`; the preset's own when left out.
    pub direction: Option<String>,
    /// Whether to lay the diagram out (the default); without it every node needs `x` and `y`.
    pub layout: Option<bool>,
    #[serde(default)]
    pub groups: Vec<SpecGroup>,
    #[serde(default)]
    pub nodes: Vec<SpecNode>,
    #[serde(default)]
    pub edges: Vec<SpecEdge>,
}

/// What a description came to.
#[derive(Debug, Clone, PartialEq)]
pub struct Built {
    pub xml: String,
    pub applied: Applied,
    pub preset: String,
    /// What a Mermaid text said that is not drawn.
    pub ignored: Vec<String>,
}

/// Where a description comes from.
#[derive(Debug, Clone)]
pub enum Input {
    Spec(Spec),
    Mermaid(String),
    Template(String),
}

/// The most nodes, groups and edges a spec may hold.
pub const MAX_PARTS: usize = 500;

fn invalid(why: impl Into<String>) -> Error {
    Error::Invalid(why.into())
}

/// The steps that make a spec, and the preset and direction to make it in.
pub fn steps_of(spec: &Spec) -> Result<(Vec<Step>, &'static str, &'static str)> {
    let preset = match spec
        .preset
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
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
    let direction = match spec
        .direction
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        None => preset.direction,
        Some(d) if d.eq_ignore_ascii_case("LR") => "LR",
        Some(d) if d.eq_ignore_ascii_case("TB") => "TB",
        Some(d) => return Err(invalid(format!("The direction is LR or TB, not “{d}”"))),
    };
    if spec.nodes.len() + spec.groups.len() + spec.edges.len() > MAX_PARTS {
        return Err(invalid(format!(
            "A spec may hold at most {MAX_PARTS} nodes, groups and edges in all; draw the rest with diagram_edit"
        )));
    }
    let laid_out = spec.layout.unwrap_or(true);
    let mut ids: HashSet<&str> = HashSet::new();
    for id in spec
        .nodes
        .iter()
        .map(|n| &n.id)
        .chain(spec.groups.iter().map(|g| &g.id))
    {
        if !ids.insert(id) {
            return Err(invalid(format!("The id “{id}” is used twice in the spec")));
        }
    }
    let group_ids: HashSet<&str> = spec.groups.iter().map(|g| g.id.as_str()).collect();
    let mut steps = Vec::new();
    for n in &spec.nodes {
        if let Some(g) = n.group.as_deref().filter(|g| !group_ids.contains(g)) {
            return Err(invalid(format!(
                "The node “{}” is in the group “{g}”, which the spec does not have",
                n.id
            )));
        }
        if n.x.is_some() != n.y.is_some() {
            return Err(invalid(format!(
                "The node “{}” needs both x and y, or neither",
                n.id
            )));
        }
        steps.push(Step::AddNode {
            id: n.id.clone(),
            label: n.label.clone(),
            kind: n.kind.clone(),
            shape: n.shape.clone(),
            x: n.x,
            y: n.y,
            w: None,
            h: None,
            group: None,
            near: None,
            side: None,
            set: n.set.clone(),
        });
    }
    for g in &spec.groups {
        if let Some(parent) = g.group.as_deref().filter(|p| !group_ids.contains(p)) {
            return Err(invalid(format!(
                "The group “{}” is in the group “{parent}”, which the spec does not have",
                g.id
            )));
        }
        let holds = spec
            .nodes
            .iter()
            .any(|n| n.group.as_deref() == Some(g.id.as_str()))
            || spec
                .groups
                .iter()
                .any(|c| c.group.as_deref() == Some(g.id.as_str()));
        if !holds {
            return Err(invalid(format!(
                "The group “{}” holds nothing: give a node or a group its group",
                g.id
            )));
        }
    }
    // Groups are made inside out: a group holds its nodes and the groups whose parent it is.
    let mut pending: Vec<&SpecGroup> = spec.groups.iter().collect();
    let mut made: HashSet<&str> = HashSet::new();
    while !pending.is_empty() {
        let before = pending.len();
        pending.retain(|g| {
            let inner = spec
                .groups
                .iter()
                .filter(|c| c.group.as_deref() == Some(g.id.as_str()));
            if inner.clone().any(|c| !made.contains(c.id.as_str())) {
                return true;
            }
            let mut members: Vec<String> = spec
                .nodes
                .iter()
                .filter(|n| n.group.as_deref() == Some(g.id.as_str()))
                .map(|n| n.id.clone())
                .collect();
            members.extend(inner.map(|c| c.id.clone()));
            steps.push(Step::Group {
                id: g.id.clone(),
                label: g.label.clone(),
                members,
                kind: g.kind.clone(),
                padding: None,
            });
            made.insert(g.id.as_str());
            false
        });
        if pending.len() == before {
            return Err(invalid(
                "The groups of the spec hold each other: a group cannot be inside itself",
            ));
        }
    }
    for e in &spec.edges {
        steps.push(Step::AddEdge {
            from: e.from.clone(),
            to: e.to.clone(),
            label: e.label.clone(),
            kind: e.kind.clone(),
            id: None,
            waypoints: None,
            set: e.set.clone(),
        });
    }
    if laid_out {
        steps.push(Step::Layout {
            scope: None,
            direction: Some(direction.to_owned()),
            spacing: None,
        });
    }
    Ok((steps, preset.id, direction))
}

/// A heading above the drawing and a page the size of it.
fn finish(edited: Edited, preset: &str, heading: Option<&str>) -> Result<Edited> {
    let doc = Doc::parse(&edited.xml)?;
    let page = &doc.pages[0];
    let boxes: Vec<_> = page.vertices().filter_map(|c| page.abs(&c.id)).collect();
    let (left, right, bottom) = boxes.iter().fold((f64::MAX, 0.0f64, 0.0f64), |a, r| {
        (a.0.min(r.x), a.1.max(r.right()), a.2.max(r.bottom()))
    });
    let mut steps = Vec::new();
    if let Some(text) = heading.map(str::trim).filter(|t| !t.is_empty()) {
        let id = page.free_id("diagram-title");
        let width = (right - left.min(right)).clamp(200.0, 800.0);
        steps.push(Step::AddNode {
            id,
            label: text.to_owned(),
            kind: Some("note".to_owned()),
            shape: None,
            x: Some(left.clamp(0.0, 40.0)),
            y: Some(5.0),
            w: Some(width),
            h: Some(30.0),
            group: None,
            near: None,
            side: None,
            set: Some(BTreeMap::from([
                ("fontSize".to_owned(), "20".to_owned()),
                ("fontStyle".to_owned(), "1".to_owned()),
                ("align".to_owned(), "left".to_owned()),
            ])),
        });
    }
    if !boxes.is_empty() {
        let up = |v: f64| ((v + 40.0) / 10.0).ceil() * 10.0;
        steps.push(Step::SetPage {
            page: page.id.clone(),
            name: None,
            width: Some(up(right).max(400.0)),
            height: Some(up(bottom).max(300.0)),
        });
    }
    let fitted = replay(&edited.xml, None, Some(preset), &steps)?;
    let mut applied = edited.applied;
    applied.ids.extend(fitted.applied.ids);
    Ok(Edited {
        xml: fitted.xml,
        applied,
        changed: true,
    })
}

/// A description as a spec, and what a Mermaid text said that is not drawn.
/// A template is headed with `title`.
pub fn resolve(input: Input, title: &str) -> Result<(Spec, Vec<String>)> {
    Ok(match input {
        Input::Spec(spec) => (spec, Vec::new()),
        Input::Mermaid(text) => {
            let parsed = mermaid::parse(&text)?;
            (parsed.spec, parsed.ignored)
        }
        Input::Template(id) => {
            let mut spec = templates::spec_for(&id, title).ok_or_else(|| {
                let names: Vec<&str> = templates().iter().map(|t| t.id).collect();
                invalid(format!(
                    "No template called “{id}”; the templates are {}",
                    names.join(", ")
                ))
            })?;
            spec.title = Some(title.to_owned());
            (spec, Vec::new())
        }
    })
}

/// Makes a diagram from a description.
pub fn build(input: Input, title: &str) -> Result<Built> {
    let (spec, ignored) = resolve(input, title)?;
    let (steps, preset, _) = steps_of(&spec)?;
    let edited = from_steps(Some(preset), &steps)?;
    let edited = finish(edited, preset, spec.title.as_deref())?;
    Ok(Built {
        xml: edited.xml,
        applied: edited.applied,
        preset: preset.to_owned(),
        ignored,
    })
}

/// The JSON a spec is written in, for the tool's description.
pub fn example() -> &'static str {
    r#"{"preset":"architecture-light","direction":"LR","groups":[{"id":"backend","label":"Backend","kind":"boundary"}],"nodes":[{"id":"web","label":"Web app","kind":"client"},{"id":"api","label":"API","kind":"service","group":"backend"},{"id":"db","label":"Orders","kind":"database","group":"backend"}],"edges":[{"from":"web","to":"api","label":"HTTPS"},{"from":"api","to":"db","label":"SQL"}]}"#
}
