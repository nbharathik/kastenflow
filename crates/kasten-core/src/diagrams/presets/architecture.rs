//! The general kinds: boxes, stores, queues, people, and the arrows and
//! containers between them. Every other preset builds on these names.

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

/// A picture from the editor's own clip-art folder, labelled below.
macro_rules! net {
    ($file:expr) => {
        concat!(
            "image;html=1;verticalLabelPosition=bottom;verticalAlign=top;imageAspect=0;image=img/lib/clip_art/networking/",
            $file,
            ";"
        )
    };
}

pub(super) const NODES: &[NodeKind] = &[
    node!(
        "service",
        "a service, app or component",
        "rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=#dae8fc;strokeColor=#6c8ebf;",
        120.0,
        60.0
    ),
    node!(
        "database",
        "a database or other store of records",
        "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;",
        80.0,
        100.0
    ),
    node!(
        "cache",
        "a cache or fast store",
        "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;fillColor=#ffe6cc;strokeColor=#d79b00;",
        80.0,
        100.0
    ),
    node!(
        "queue",
        "a queue, topic or event bus",
        "shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;",
        120.0,
        60.0
    ),
    node!(
        "storage",
        "files or object storage",
        "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;fillColor=#fff2cc;strokeColor=#d6b656;",
        80.0,
        100.0
    ),
    node!(
        "actor",
        "a person or a user",
        "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;",
        30.0,
        60.0
    ),
    node!(
        "client",
        "a browser, app or device that calls in",
        "rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=#e1d5e7;strokeColor=#9673a6;",
        120.0,
        60.0
    ),
    node!(
        "gateway",
        "a gateway, proxy or load balancer",
        "rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=#d5e8d4;strokeColor=#82b366;",
        120.0,
        60.0
    ),
    node!(
        "external",
        "a system outside the one drawn",
        "rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=#f5f5f5;strokeColor=#666666;",
        120.0,
        60.0
    ),
    node!(
        "worker",
        "a job, worker or scheduler",
        "rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=#fff2cc;strokeColor=#d6b656;",
        120.0,
        60.0
    ),
    node!(
        "alert",
        "something that can fail or needs attention",
        "rounded=1;whiteSpace=wrap;html=1;arcSize=12;fillColor=#f8cecc;strokeColor=#b85450;",
        120.0,
        60.0
    ),
    node!(
        "cloud",
        "the internet or a cloud",
        "ellipse;shape=cloud;whiteSpace=wrap;html=1;",
        120.0,
        80.0
    ),
    node!(
        "note",
        "a note or a label with no box",
        "text;html=1;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;",
        120.0,
        40.0
    ),
    node!("router", "a router", net!("Router_128x128.png"), 70.0, 70.0),
    node!(
        "switch",
        "a network switch",
        net!("Switch_128x128.png"),
        70.0,
        70.0
    ),
    node!(
        "firewall",
        "a firewall",
        net!("Firewall_128x128.png"),
        70.0,
        70.0
    ),
    node!(
        "server",
        "a server",
        net!("Cloud_Server_128x128.png"),
        70.0,
        70.0
    ),
];

pub(super) const EDGES: &[EdgeKind] = &[
    EdgeKind {
        name: "sync",
        about: "a call that waits for the answer",
        style: "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;",
    },
    EdgeKind {
        name: "async",
        about: "a message or event that does not wait",
        style: "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;dashed=1;",
    },
    EdgeKind {
        name: "data",
        about: "data flowing one way",
        style: "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=open;",
    },
    EdgeKind {
        name: "both",
        about: "traffic both ways",
        style: "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;startArrow=classic;",
    },
    EdgeKind {
        name: "depends",
        about: "depends on, uses",
        style: "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=open;dashed=1;",
    },
    EdgeKind {
        name: "line",
        about: "a plain line with no arrow",
        style: "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=none;",
    },
];

pub(super) const GROUPS: &[GroupKind] = &[
    GroupKind {
        name: "container",
        about: "a titled box that holds others",
        style: "swimlane;whiteSpace=wrap;html=1;startSize=30;collapsible=0;fillColor=#f5f5f5;strokeColor=#666666;",
        stack: false,
    },
    GroupKind {
        name: "boundary",
        about: "a dashed boundary: a network, a trust zone, a system's edge",
        style: "rounded=1;whiteSpace=wrap;html=1;dashed=1;fillColor=none;strokeColor=#666666;verticalAlign=top;align=left;spacingLeft=10;container=1;collapsible=0;arcSize=4;fontStyle=1;",
        stack: false,
    },
    GroupKind {
        name: "lane",
        about: "a swimlane across the diagram",
        style: "swimlane;horizontal=0;whiteSpace=wrap;html=1;startSize=30;collapsible=0;",
        stack: false,
    },
];

pub(super) const PRESETS: &[Preset] = &[
    Preset {
        id: "architecture-light",
        title: "Architecture (light)",
        about: "services, stores, queues and the calls between them; left to right",
        direction: "LR",
        default_node: "service",
        default_edge: "sync",
        nodes: &[
            "service", "database", "cache", "queue", "storage", "actor", "client", "gateway",
            "external", "worker", "alert", "cloud", "note",
        ],
        edges: &["sync", "async", "data", "both", "depends", "line"],
        groups: &["container", "boundary", "lane"],
    },
    Preset {
        id: "network",
        title: "Network",
        about: "routers, switches, firewalls and servers; top to bottom",
        direction: "TB",
        default_node: "server",
        default_edge: "line",
        nodes: &[
            "router", "switch", "firewall", "server", "cloud", "client", "note",
        ],
        edges: &["line", "both", "data"],
        groups: &["boundary", "container"],
    },
];
