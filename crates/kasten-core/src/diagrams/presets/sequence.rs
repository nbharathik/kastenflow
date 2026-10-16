//! Sequence diagrams: lifelines side by side and messages between them.
//! A message is an edge whose ends sit at the same height on the two
//! lifelines (`exitY`/`entryY` are fractions of a lifeline's length), so the
//! order of the messages is the order down the page.

use super::{EdgeKind, NodeKind, Preset};

pub(super) const NODES: &[NodeKind] = &[NodeKind {
    name: "lifeline",
    about: "a participant of a sequence diagram, with the line dropping from it",
    style: "shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=0;dropTarget=0;collapsible=0;recursiveResize=0;outlineConnect=0;portConstraint=eastwest;",
    w: 100.0,
    h: 300.0,
    shape: None,
    c4: None,
}];

pub(super) const EDGES: &[EdgeKind] = &[
    EdgeKind {
        name: "message",
        about: "a call from one lifeline to another",
        style: "edgeStyle=none;html=1;verticalAlign=bottom;endArrow=block;curved=0;rounded=0;",
    },
    EdgeKind {
        name: "reply",
        about: "the answer to a call",
        style: "edgeStyle=none;html=1;verticalAlign=bottom;endArrow=open;dashed=1;endSize=8;curved=0;rounded=0;",
    },
];

pub(super) const PRESETS: &[Preset] = &[Preset {
    id: "sequence",
    title: "Sequence",
    about: "who calls whom, in order; lifelines left to right, messages down the page",
    direction: "LR",
    default_node: "lifeline",
    default_edge: "message",
    nodes: &["lifeline", "actor", "note"],
    edges: &["message", "reply"],
    groups: &[],
}];
