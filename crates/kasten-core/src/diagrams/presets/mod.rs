//! The style catalogue agents draw with: kinds of node, edge and group, each
//! a name for a style and a default size, gathered into versioned presets.
//! Neutral nodes carry no hard-coded font or stroke colour, so the editor's
//! dark mode adapts them; coloured ones use only the editor's own swatches.
//! The same catalogue writes the agent instructions (`instructions`), so what
//! an agent is told is what the tools accept.

mod architecture;
mod c4;
mod cloud;
mod er;
mod flow;
mod instructions;
mod mind;
mod sequence;
mod tokens;

pub use c4::{has_technology as c4_has_technology, label_of as c4_label};
pub use instructions::{instructions, skill};
pub use tokens::{SWATCHES, Swatch, apply_token, swatch};

/// The catalogue's version, written into the instructions: a change to any
/// style or size bumps it.
pub const VERSION: u32 = 1;

/// The preset a diagram is drawn with when the call names none.
pub const DEFAULT: &str = "architecture-light";

/// The height of a container's title strip, in pixels.
pub const HEADER: f64 = 30.0;

/// How a node of this kind looks and how big it starts.
#[derive(Debug, Clone, Copy)]
pub struct NodeKind {
    pub name: &'static str,
    pub about: &'static str,
    pub style: &'static str,
    pub w: f64,
    pub h: f64,
    /// A key of the shape index to draw with instead of `style`.
    pub shape: Option<&'static str>,
    /// An `object` cell with C4 fields of this type, written as the editor's C4 shapes are.
    pub c4: Option<&'static str>,
}

#[derive(Debug, Clone, Copy)]
pub struct EdgeKind {
    pub name: &'static str,
    pub about: &'static str,
    pub style: &'static str,
}

#[derive(Debug, Clone, Copy)]
pub struct GroupKind {
    pub name: &'static str,
    pub about: &'static str,
    pub style: &'static str,
    /// Children are laid out one under the other (a table or a class box).
    pub stack: bool,
}

/// A named way of drawing: which kinds to reach for and which way to lay out.
#[derive(Debug, Clone, Copy)]
pub struct Preset {
    pub id: &'static str,
    pub title: &'static str,
    pub about: &'static str,
    /// `LR` or `TB`.
    pub direction: &'static str,
    pub default_node: &'static str,
    pub default_edge: &'static str,
    pub nodes: &'static [&'static str],
    pub edges: &'static [&'static str],
    pub groups: &'static [&'static str],
}

fn node_kinds() -> impl Iterator<Item = &'static NodeKind> {
    [
        architecture::NODES,
        flow::NODES,
        c4::NODES,
        sequence::NODES,
        er::NODES,
        mind::NODES,
        cloud::NODES,
    ]
    .into_iter()
    .flatten()
}

fn edge_kinds() -> impl Iterator<Item = &'static EdgeKind> {
    [
        architecture::EDGES,
        flow::EDGES,
        c4::EDGES,
        sequence::EDGES,
        er::EDGES,
        mind::EDGES,
    ]
    .into_iter()
    .flatten()
}

fn group_kinds() -> impl Iterator<Item = &'static GroupKind> {
    [
        architecture::GROUPS,
        flow::GROUPS,
        c4::GROUPS,
        er::GROUPS,
        cloud::GROUPS,
    ]
    .into_iter()
    .flatten()
}

/// Every preset, in the order the instructions list them.
pub fn all() -> Vec<&'static Preset> {
    [
        architecture::PRESETS,
        c4::PRESETS,
        cloud::PRESETS,
        flow::PRESETS,
        sequence::PRESETS,
        er::PRESETS,
        mind::PRESETS,
    ]
    .into_iter()
    .flatten()
    .collect()
}

pub fn preset(id: &str) -> Option<&'static Preset> {
    all().into_iter().find(|p| p.id == id)
}

pub fn node_kind(name: &str) -> Option<&'static NodeKind> {
    node_kinds().find(|k| k.name == name)
}

pub fn edge_kind(name: &str) -> Option<&'static EdgeKind> {
    edge_kinds().find(|k| k.name == name)
}

pub fn group_kind(name: &str) -> Option<&'static GroupKind> {
    group_kinds().find(|k| k.name == name)
}

/// The names of the node kinds, for an error message.
pub fn node_kind_names() -> Vec<&'static str> {
    node_kinds().map(|k| k.name).collect()
}

pub fn edge_kind_names() -> Vec<&'static str> {
    edge_kinds().map(|k| k.name).collect()
}

pub fn group_kind_names() -> Vec<&'static str> {
    group_kinds().map(|k| k.name).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagrams::model::Style;

    #[test]
    fn every_kind_is_found_by_its_name_and_names_are_not_reused() {
        for names in [node_kind_names(), edge_kind_names(), group_kind_names()] {
            let mut sorted = names.clone();
            sorted.sort_unstable();
            sorted.dedup();
            assert_eq!(sorted.len(), names.len(), "{names:?}");
        }
        assert!(node_kind("service").is_some() && edge_kind("sync").is_some());
        assert!(group_kind("boundary").is_some() && node_kind("nope").is_none());
    }

    #[test]
    fn every_preset_names_kinds_that_exist_and_a_direction() {
        let presets = all();
        assert!(presets.len() >= 11, "{}", presets.len());
        for p in presets {
            assert!(matches!(p.direction, "LR" | "TB"), "{}", p.id);
            assert!(
                node_kind(p.default_node).is_some(),
                "{} {}",
                p.id,
                p.default_node
            );
            assert!(
                edge_kind(p.default_edge).is_some(),
                "{} {}",
                p.id,
                p.default_edge
            );
            for n in p.nodes {
                assert!(node_kind(n).is_some(), "{}: node {n}", p.id);
            }
            for e in p.edges {
                assert!(edge_kind(e).is_some(), "{}: edge {e}", p.id);
            }
            for g in p.groups {
                assert!(group_kind(g).is_some(), "{}: group {g}", p.id);
            }
        }
        assert!(preset(DEFAULT).is_some());
    }

    #[test]
    fn styles_use_only_the_editors_swatches_and_no_text_colour_on_neutral_nodes() {
        let swatches: Vec<&str> = SWATCHES.iter().flat_map(|s| [s.fill, s.stroke]).collect();
        for k in node_kinds().filter(|k| k.c4.is_none() && k.shape.is_none()) {
            let style = Style::parse(k.style);
            for key in ["fillColor", "strokeColor"] {
                if let Some(c) = style.get(key).filter(|c| c.starts_with('#')) {
                    assert!(swatches.contains(&c), "{}: {key}={c}", k.name);
                }
            }
            assert!(style.get("fontColor").is_none(), "{}", k.name);
            assert!(k.w >= 20.0 && k.h >= 20.0, "{}", k.name);
        }
    }
}
