//! Mind maps: a central idea and branches that spread to the right.

use super::{EdgeKind, NodeKind, Preset};

pub(super) const NODES: &[NodeKind] = &[
    NodeKind {
        name: "idea",
        about: "the central idea of a mind map",
        style: "ellipse;whiteSpace=wrap;html=1;fontStyle=1;fillColor=#dae8fc;strokeColor=#6c8ebf;",
        w: 160.0,
        h: 80.0,
        shape: None,
        c4: None,
    },
    NodeKind {
        name: "branch",
        about: "a branch of a mind map",
        style: "rounded=1;whiteSpace=wrap;html=1;arcSize=40;fillColor=#fff2cc;strokeColor=#d6b656;",
        w: 140.0,
        h: 40.0,
        shape: None,
        c4: None,
    },
    NodeKind {
        name: "leaf",
        about: "a small point at the end of a branch",
        style: "rounded=1;whiteSpace=wrap;html=1;arcSize=40;",
        w: 120.0,
        h: 32.0,
        shape: None,
        c4: None,
    },
];

pub(super) const EDGES: &[EdgeKind] = &[EdgeKind {
    name: "branch-line",
    about: "a curved line from an idea to its branch",
    style: "edgeStyle=entityRelationEdgeStyle;startArrow=none;endArrow=none;segment=10;curved=1;html=1;",
}];

pub(super) const PRESETS: &[Preset] = &[Preset {
    id: "mind",
    title: "Mind map",
    about: "one idea and what branches off it; left to right",
    direction: "LR",
    default_node: "branch",
    default_edge: "branch-line",
    nodes: &["idea", "branch", "leaf", "note"],
    edges: &["branch-line"],
    groups: &[],
}];
