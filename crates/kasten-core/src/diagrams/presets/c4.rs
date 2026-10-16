//! The C4 model's kinds, written as the editor's own C4 shapes are: `object`
//! cells with `c4Name`, `c4Type`, `c4Description` (and `c4Technology` for
//! containers and components) whose label fills them in.

use super::{EdgeKind, GroupKind, NodeKind, Preset};

macro_rules! c4 {
    ($name:expr, $about:expr, $style:expr, $w:expr, $h:expr, $ty:expr) => {
        NodeKind {
            name: $name,
            about: $about,
            style: $style,
            w: $w,
            h: $h,
            shape: None,
            c4: Some($ty),
        }
    };
}

pub(super) const NODES: &[NodeKind] = &[
    c4!(
        "person",
        "C4: a person who uses the system",
        "html=1;fontSize=11;dashed=0;whiteSpace=wrap;fillColor=#083F75;strokeColor=#06315C;fontColor=#ffffff;shape=mxgraph.c4.person2;align=center;metaEdit=1;points=[[0.5,0,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0]];resizable=0;",
        200.0,
        180.0,
        "Person"
    ),
    c4!(
        "external-person",
        "C4: a person outside the organisation",
        "html=1;fontSize=11;dashed=0;whiteSpace=wrap;fillColor=#6C6477;strokeColor=#4D4D4D;fontColor=#ffffff;shape=mxgraph.c4.person2;align=center;metaEdit=1;points=[[0.5,0,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0]];resizable=0;",
        200.0,
        180.0,
        "Person"
    ),
    c4!(
        "system",
        "C4: a software system you build",
        "rounded=1;whiteSpace=wrap;html=1;labelBackgroundColor=none;fillColor=#1061B0;fontColor=#ffffff;align=center;arcSize=10;strokeColor=#0D5091;metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];",
        240.0,
        120.0,
        "Software System"
    ),
    c4!(
        "external-system",
        "C4: a software system someone else runs",
        "rounded=1;whiteSpace=wrap;html=1;labelBackgroundColor=none;fillColor=#8C8496;fontColor=#ffffff;align=center;arcSize=10;strokeColor=#736782;metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];",
        240.0,
        120.0,
        "Software System"
    ),
    c4!(
        "container",
        "C4: an application or process inside a system",
        "rounded=1;whiteSpace=wrap;html=1;fontSize=11;labelBackgroundColor=none;fillColor=#23A2D9;fontColor=#ffffff;align=center;arcSize=10;strokeColor=#0E7DAD;metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];",
        240.0,
        120.0,
        "Container"
    ),
    c4!(
        "data-container",
        "C4: a database or other store inside a system",
        "shape=cylinder3;size=15;whiteSpace=wrap;html=1;boundedLbl=1;rounded=0;labelBackgroundColor=none;fillColor=#23A2D9;fontSize=12;fontColor=#ffffff;align=center;strokeColor=#0E7DAD;metaEdit=1;points=[[0.5,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.5,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];resizable=0;",
        240.0,
        120.0,
        "Container"
    ),
    c4!(
        "component",
        "C4: a part of a container",
        "rounded=1;whiteSpace=wrap;html=1;labelBackgroundColor=none;fillColor=#63BEF2;fontColor=#ffffff;align=center;arcSize=6;strokeColor=#2086C9;metaEdit=1;resizable=0;points=[[0.25,0,0],[0.5,0,0],[0.75,0,0],[1,0.25,0],[1,0.5,0],[1,0.75,0],[0.75,1,0],[0.5,1,0],[0.25,1,0],[0,0.75,0],[0,0.5,0],[0,0.25,0]];",
        240.0,
        120.0,
        "Component"
    ),
];

pub(super) const EDGES: &[EdgeKind] = &[EdgeKind {
    name: "rel",
    about: "C4: a relationship; label it with what it does",
    style: "endArrow=blockThin;html=1;fontSize=10;fontColor=#404040;strokeWidth=1;endFill=1;strokeColor=#828282;elbow=vertical;endSize=14;startSize=14;rounded=0;edgeStyle=orthogonalEdgeStyle;",
}];

pub(super) const GROUPS: &[GroupKind] = &[GroupKind {
    name: "c4-boundary",
    about: "C4: a system or container boundary",
    style: "rounded=1;whiteSpace=wrap;html=1;fontSize=11;labelBackgroundColor=none;dashed=1;fillColor=none;strokeColor=#666666;fontColor=#333333;verticalAlign=top;align=left;spacingLeft=10;arcSize=4;container=1;collapsible=0;fontStyle=1;",
    stack: false,
}];

pub(super) const PRESETS: &[Preset] = &[Preset {
    id: "c4",
    title: "C4 model",
    about: "context, container and component diagrams; top to bottom",
    direction: "TB",
    default_node: "system",
    default_edge: "rel",
    nodes: &[
        "person",
        "external-person",
        "system",
        "external-system",
        "container",
        "data-container",
        "component",
    ],
    edges: &["rel"],
    groups: &["c4-boundary"],
}];

/// The label an `object` cell of this C4 type carries.
pub fn label_of(c4_type: &str) -> &'static str {
    match c4_type {
        "Person" => {
            "<font style=\"font-size: 16px\"><b>%c4Name%</b></font><div>[%c4Type%]</div><br><div><font style=\"font-size: 11px\"><font color=\"#cccccc\">%c4Description%</font></font></div>"
        }
        "Software System" => {
            "<font style=\"font-size: 16px\"><b>%c4Name%</b></font><div>[%c4Type%]</div><br><div><font style=\"font-size: 11px\"><font color=\"#cccccc\">%c4Description%</font></font></div>"
        }
        _ => {
            "<font style=\"font-size: 16px\"><b>%c4Name%</b></font><div>[%c4Type%: %c4Technology%]</div><br><div><font style=\"font-size: 11px\"><font color=\"#E6E6E6\">%c4Description%</font></font></div>"
        }
    }
}

/// Whether the type has a technology line.
pub fn has_technology(c4_type: &str) -> bool {
    matches!(c4_type, "Container" | "Component")
}
