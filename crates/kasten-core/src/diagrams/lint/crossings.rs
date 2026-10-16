//! Where edges run: edges that cross and edges that go through a box. Both
//! estimate an edge as a line from the border of its source to the border of
//! its target through its waypoints; the editor's own routing may differ,
//! which the hints say.

use super::geometry::{cross, hits, polyline};
use super::{MAX_EDGES_CHECKED, Severity, Sink};
use crate::diagrams::model::Rect;

pub(super) fn run(s: &mut Sink) {
    let page = s.page;
    let edges: Vec<_> = page
        .edges()
        .filter_map(|e| polyline(page, e).map(|p| (e, p)))
        .collect();
    if edges.len() > MAX_EDGES_CHECKED {
        s.skipped.push(format!(
            "crossings, edge-through-node: more than {MAX_EDGES_CHECKED} edges"
        ));
        return;
    }
    let mut pairs: Vec<(String, String)> = Vec::new();
    for (i, (a, pa)) in edges.iter().enumerate() {
        for (b, pb) in &edges[i + 1..] {
            let ends_b = [b.source.as_deref(), b.target.as_deref()];
            let shares = [a.source.as_deref(), a.target.as_deref()]
                .iter()
                .flatten()
                .any(|x| ends_b.iter().flatten().any(|y| x == y));
            if shares {
                continue;
            }
            let crossing = pa
                .windows(2)
                .any(|sa| pb.windows(2).any(|sb| cross(sa[0], sa[1], sb[0], sb[1])));
            if crossing {
                pairs.push((a.id.clone(), b.id.clone()));
            }
        }
    }
    if !pairs.is_empty() {
        let n = pairs.len();
        let named: Vec<String> = pairs
            .iter()
            .take(3)
            .map(|(a, b)| format!("“{a}” and “{b}”"))
            .collect();
        s.add(
            "crossings",
            if n > 2 {
                Severity::Warning
            } else {
                Severity::Info
            },
            Some(&pairs[0].0),
            format!(
                "{n} pair{} of edges cross (estimated from straight lines): {}{}",
                if n == 1 { "" } else { "s" },
                named.join(", "),
                if n > 3 { ", …" } else { "" }
            ),
            "Lay the diagram out again, or move the nodes that talk the most next to each other",
        );
    }
    let boxes: Vec<(String, Rect)> = page
        .vertices()
        .filter_map(|c| page.abs(&c.id).map(|r| (c.id.clone(), r)))
        .collect();
    let mut through = Vec::new();
    for (e, points) in &edges {
        let ends: Vec<String> = [&e.source, &e.target]
            .into_iter()
            .flatten()
            .cloned()
            .collect();
        for (id, rect) in &boxes {
            // The ends, the groups around them and what they hold are not in the way.
            let related = ends
                .iter()
                .any(|end| page.inside(end, id) || page.inside(id, end));
            if related {
                continue;
            }
            if points.windows(2).any(|w| hits(w[0], w[1], rect, 4.0)) {
                through.push((
                    e.id.clone(),
                    format!(
                        "The edge “{}” runs through “{id}” (estimated from straight lines)",
                        e.id
                    ),
                ));
                break;
            }
        }
    }
    s.many(
        "edge-through-node",
        Severity::Warning,
        through,
        "Move the node out of the way, add a waypoint to the edge, or lay the diagram out again",
    );
}
