//! Entity-relationship diagrams: an entity is a titled box (`entity` group)
//! with one text row per field, stacked; relationships are lines.

use super::{EdgeKind, GroupKind, NodeKind, Preset};

pub(super) const NODES: &[NodeKind] = &[NodeKind {
    name: "field",
    about: "one row of an entity: a column and its type",
    style: "text;strokeColor=none;fillColor=none;align=left;verticalAlign=top;spacingLeft=4;spacingRight=4;overflow=hidden;rotatable=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;whiteSpace=wrap;html=1;",
    w: 160.0,
    h: 26.0,
    shape: None,
    c4: None,
}];

pub(super) const EDGES: &[EdgeKind] = &[
    EdgeKind {
        name: "one-to-many",
        about: "one row on the left, many on the right",
        style: "edgeStyle=entityRelationEdgeStyle;fontSize=12;html=1;endArrow=ERmany;startArrow=ERmandOne;endFill=0;startFill=0;",
    },
    EdgeKind {
        name: "one-to-one",
        about: "one row each side",
        style: "edgeStyle=entityRelationEdgeStyle;fontSize=12;html=1;endArrow=ERmandOne;startArrow=ERmandOne;endFill=0;startFill=0;",
    },
    EdgeKind {
        name: "many-to-many",
        about: "many rows each side",
        style: "edgeStyle=entityRelationEdgeStyle;fontSize=12;html=1;endArrow=ERmany;startArrow=ERmany;endFill=0;startFill=0;",
    },
];

pub(super) const GROUPS: &[GroupKind] = &[GroupKind {
    name: "entity",
    about: "an entity: a titled box whose children are its fields",
    style: "swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;startSize=30;horizontalStack=0;resizeParent=1;resizeParentMax=0;resizeLast=0;collapsible=0;marginBottom=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;",
    stack: true,
}];

pub(super) const PRESETS: &[Preset] = &[Preset {
    id: "er",
    title: "Entity-relationship",
    about: "tables and how they relate; left to right",
    direction: "LR",
    default_node: "field",
    default_edge: "one-to-many",
    nodes: &["field", "note"],
    edges: &["one-to-many", "one-to-one", "many-to-many"],
    groups: &["entity"],
}];
