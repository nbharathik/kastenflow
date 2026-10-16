//! Flowchart kinds, drawn with the editor's built-in shapes so the draft
//! picture matches them exactly.

use super::{EdgeKind, GroupKind, NodeKind, Preset};

macro_rules! node {
    ($name:expr, $about:expr, $style:expr, $w:expr, $h:expr) => {
        NodeKind {
            name: $name,
            about: $about,
            style: $style,
            w: $w,
            h: $h,
            shape: None,
            c4: None,
        }
    };
}

pub(super) const NODES: &[NodeKind] = &[
    node!(
        "process",
        "a step",
        "rounded=0;whiteSpace=wrap;html=1;",
        120.0,
        60.0
    ),
    node!(
        "decision",
        "a yes/no or branching question",
        "rhombus;whiteSpace=wrap;html=1;",
        140.0,
        80.0
    ),
    node!(
        "terminator",
        "where the flow starts or ends",
        "rounded=1;whiteSpace=wrap;html=1;arcSize=50;",
        120.0,
        50.0
    ),
    node!(
        "io",
        "an input or output",
        "shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;",
        140.0,
        60.0
    ),
    node!(
        "document",
        "a document or report",
        "shape=document;whiteSpace=wrap;html=1;boundedLbl=1;",
        120.0,
        70.0
    ),
    node!(
        "subprocess",
        "a step that has its own flow",
        "shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;",
        120.0,
        60.0
    ),
    node!(
        "connector",
        "a small joining point",
        "ellipse;whiteSpace=wrap;html=1;aspect=fixed;",
        40.0,
        40.0
    ),
];

pub(super) const EDGES: &[EdgeKind] = &[EdgeKind {
    name: "flow",
    about: "the next step; label the branches of a decision",
    style: "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;",
}];

pub(super) const GROUPS: &[GroupKind] = &[];

pub(super) const PRESETS: &[Preset] = &[Preset {
    id: "flowchart",
    title: "Flowchart",
    about: "steps, decisions and where they lead; top to bottom",
    direction: "TB",
    default_node: "process",
    default_edge: "flow",
    nodes: &[
        "terminator",
        "process",
        "decision",
        "io",
        "document",
        "subprocess",
        "connector",
        "note",
    ],
    edges: &["flow", "async", "line"],
    groups: &["container", "lane"],
}];
