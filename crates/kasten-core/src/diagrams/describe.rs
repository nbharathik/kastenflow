//! A diagram told to an agent: what is on a page in page coordinates (the
//! ones the steps take), as structured cells and as a few lines of words,
//! with where there is free room to put more.

use serde::Serialize;

use super::model::{Cell, Doc, Kind, Page, Rect, Style};
use super::presets;
use crate::error::Result;

/// The most cells told one by one.
const MAX_LISTED: usize = 300;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NodeInfo {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub group: Option<String>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EdgeInfo {
    pub id: String,
    pub from: Option<String>,
    pub to: Option<String>,
    pub label: String,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GroupInfo {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub members: Vec<String>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PageInfo {
    pub id: String,
    pub name: String,
    pub width: f64,
    pub height: f64,
    pub nodes: usize,
    pub edges: usize,
}

/// Where more can go without landing on anything.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Free {
    /// A place to the right of everything, level with its top.
    pub right: (f64, f64),
    /// A place below everything, at its left edge.
    pub below: (f64, f64),
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Description {
    pub page: String,
    pub pages: Vec<PageInfo>,
    pub nodes: Vec<NodeInfo>,
    pub edges: Vec<EdgeInfo>,
    pub groups: Vec<GroupInfo>,
    pub free: Free,
    /// More cells than are listed.
    pub truncated: bool,
    /// The page in words.
    pub text: String,
}

/// The kind of preset a cell looks like, else a word for its shape.
pub fn kind_of(cell: &Cell) -> String {
    if let Some(ty) = cell.attr("c4Type") {
        return format!("c4:{}", ty.to_lowercase().replace(' ', "-"));
    }
    let same = |style: &str| Style::parse(style) == cell.style;
    if cell.is_edge() {
        return presets::edge_kind_names()
            .into_iter()
            .find(|n| presets::edge_kind(n).is_some_and(|k| same(k.style)))
            .map_or_else(|| "edge".to_owned(), str::to_owned);
    }
    if let Some(k) = presets::node_kind_names()
        .into_iter()
        .filter_map(presets::node_kind)
        .find(|k| k.shape.is_none() && k.c4.is_none() && same(k.style))
    {
        return k.name.to_owned();
    }
    if let Some(k) = presets::group_kind_names()
        .into_iter()
        .filter_map(presets::group_kind)
        .find(|k| same(k.style))
    {
        return k.name.to_owned();
    }
    if let Some(icon) = cell
        .style
        .get("resIcon")
        .or_else(|| cell.style.get("prIcon"))
    {
        return format!("shape:{}", icon.trim_start_matches("mxgraph."));
    }
    if let Some(shape) = cell.style.get("shape") {
        return format!("shape:{}", shape.trim_start_matches("mxgraph."));
    }
    cell.style
        .bare()
        .map_or_else(|| "box".to_owned(), str::to_owned)
}

fn rect(page: &Page, id: &str) -> Rect {
    page.abs(id).unwrap_or_default()
}

fn one_line(text: &str) -> String {
    text.replace('\n', " / ")
}

fn describe_page(page: &Page, pages: Vec<PageInfo>) -> Description {
    let is_group = |c: &Cell| page.children_of(&c.id).any(|k| k.kind == Kind::Vertex);
    let group_of = |c: &Cell| {
        c.parent
            .clone()
            .filter(|p| page.get(p).is_some_and(Cell::is_vertex))
    };
    let nodes: Vec<NodeInfo> = page
        .vertices()
        .filter(|c| !is_group(c))
        .map(|c| {
            let r = rect(page, &c.id);
            NodeInfo {
                id: c.id.clone(),
                label: c.text(),
                kind: kind_of(c),
                group: group_of(c),
                x: r.x,
                y: r.y,
                w: r.w,
                h: r.h,
            }
        })
        .collect();
    let edges: Vec<EdgeInfo> = page
        .edges()
        .map(|c| EdgeInfo {
            id: c.id.clone(),
            from: c.source.clone(),
            to: c.target.clone(),
            label: c.text(),
            kind: kind_of(c),
        })
        .collect();
    let groups: Vec<GroupInfo> = page
        .vertices()
        .filter(|c| is_group(c))
        .map(|c| {
            let r = rect(page, &c.id);
            GroupInfo {
                id: c.id.clone(),
                label: c.text(),
                kind: kind_of(c),
                members: page
                    .children_of(&c.id)
                    .filter(|k| k.kind == Kind::Vertex)
                    .map(|k| k.id.clone())
                    .collect(),
                x: r.x,
                y: r.y,
                w: r.w,
                h: r.h,
            }
        })
        .collect();
    let boxes: Vec<Rect> = page.vertices().filter_map(|c| page.abs(&c.id)).collect();
    let top = boxes.iter().map(|r| r.y).fold(f64::MAX, f64::min);
    let left = boxes.iter().map(|r| r.x).fold(f64::MAX, f64::min);
    let free = if boxes.is_empty() {
        Free {
            right: (40.0, 40.0),
            below: (40.0, 40.0),
        }
    } else {
        let up = |v: f64| ((v + 40.0) / 10.0).ceil() * 10.0;
        Free {
            right: (
                up(boxes.iter().map(Rect::right).fold(0.0, f64::max)),
                top.max(0.0),
            ),
            below: (
                left.max(0.0),
                up(boxes.iter().map(Rect::bottom).fold(0.0, f64::max)),
            ),
        }
    };
    let (w, h) = (page.width.unwrap_or(850.0), page.height.unwrap_or(1100.0));
    let mut text = format!(
        "Page “{}” ({w}×{h}): {} nodes, {} edges, {} groups.\n",
        page.name,
        nodes.len(),
        edges.len(),
        groups.len()
    );
    if !nodes.is_empty() {
        text.push_str("Nodes (id: label [kind] at x,y width×height):\n");
        for n in nodes.iter().take(MAX_LISTED) {
            let inside = n
                .group
                .as_ref()
                .map_or(String::new(), |g| format!(" in {g}"));
            text.push_str(&format!(
                "  {}: {} [{}] at {},{} {}×{}{inside}\n",
                n.id,
                one_line(&n.label),
                n.kind,
                n.x,
                n.y,
                n.w,
                n.h
            ));
        }
    }
    if !edges.is_empty() {
        text.push_str("Edges (from → to “label” [kind]):\n");
        for e in edges.iter().take(MAX_LISTED) {
            let label = if e.label.is_empty() {
                String::new()
            } else {
                format!(" “{}”", one_line(&e.label))
            };
            text.push_str(&format!(
                "  {} → {}{label} [{}] ({})\n",
                e.from.as_deref().unwrap_or("?"),
                e.to.as_deref().unwrap_or("?"),
                e.kind,
                e.id
            ));
        }
    }
    for g in &groups {
        text.push_str(&format!(
            "Group {} “{}” [{}] at {},{} {}×{} holds {}\n",
            g.id,
            one_line(&g.label),
            g.kind,
            g.x,
            g.y,
            g.w,
            g.h,
            g.members.join(", ")
        ));
    }
    text.push_str(&format!(
        "Free room: right of everything from x={}, y={}; below everything from x={}, y={}.\n",
        free.right.0, free.right.1, free.below.0, free.below.1
    ));
    let truncated = nodes.len() > MAX_LISTED || edges.len() > MAX_LISTED;
    let mut d = Description {
        page: page.name.clone(),
        pages,
        nodes,
        edges,
        groups,
        free,
        truncated,
        text,
    };
    d.nodes.truncate(MAX_LISTED);
    d.edges.truncate(MAX_LISTED);
    if truncated {
        d.text.push_str(&format!(
            "Only the first {MAX_LISTED} nodes and edges are listed.\n"
        ));
    }
    d
}

/// Describes a page of the diagram `xml` (the first when none is named).
pub fn describe(xml: &str, page: Option<&str>) -> Result<Description> {
    let doc = Doc::parse(xml)?;
    let at = doc.find_page(page)?;
    let pages = doc
        .pages
        .iter()
        .map(|p| PageInfo {
            id: p.id.clone(),
            name: p.name.clone(),
            width: p.width.unwrap_or(850.0),
            height: p.height.unwrap_or(1100.0),
            nodes: p.vertices().count(),
            edges: p.edges().count(),
        })
        .collect();
    Ok(describe_page(&doc.pages[at], pages))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagrams::spec::{Input, build};

    #[test]
    fn a_diagram_is_told_in_page_coordinates_with_the_kinds_it_was_made_with() {
        let built = build(Input::Template("three-tier".into()), "Shop").unwrap();
        let d = describe(&built.xml, None).unwrap();
        let kind = |id: &str| d.nodes.iter().find(|n| n.id == id).map(|n| n.kind.as_str());
        assert_eq!(
            (kind("db"), kind("api"), kind("users")),
            (Some("database"), Some("service"), Some("actor"))
        );
        assert_eq!(
            d.groups.iter().map(|g| g.id.as_str()).collect::<Vec<_>>(),
            ["presentation", "application", "data"]
        );
        assert_eq!(d.groups[1].members, ["api", "worker"]);
        let api = d.nodes.iter().find(|n| n.id == "api").unwrap();
        assert_eq!(api.group.as_deref(), Some("application"));
        let group = d.groups.iter().find(|g| g.id == "application").unwrap();
        assert!(api.x >= group.x && api.y >= group.y + 30.0 && api.x + api.w <= group.x + group.w);
        assert_eq!(
            d.edges.iter().find(|e| e.id == "e-web-api").unwrap().label,
            "HTTPS"
        );
        assert!(
            d.text.contains("api: API [service] at") && d.text.contains("web → api “HTTPS” [sync]"),
            "{}",
            d.text
        );
        // The free room is beyond everything drawn.
        let right = d
            .nodes
            .iter()
            .map(|n| n.x + n.w)
            .chain(d.groups.iter().map(|g| g.x + g.w))
            .fold(0.0, f64::max);
        assert!(
            d.free.right.0 > right
                && d.free.below.1 > d.nodes.iter().map(|n| n.y + n.h).fold(0.0, f64::max)
        );
        assert!(!d.truncated && d.pages.len() == 1);
    }

    #[test]
    fn c4_cells_name_their_c4_type_and_icons_their_shape() {
        let c4 = build(Input::Template("c4-context".into()), "C").unwrap();
        let d = describe(&c4.xml, None).unwrap();
        assert!(
            d.nodes.iter().any(|n| n.kind == "c4:person")
                && d.nodes.iter().any(|n| n.kind == "c4:software-system")
        );
        assert!(
            d.nodes
                .iter()
                .find(|n| n.id == "customer")
                .unwrap()
                .label
                .starts_with("Customer")
        );
        let aws = build(Input::Spec(serde_json::from_str(r#"{"nodes":[{"id":"f","shape":"aws4.lambda"},{"id":"v","kind":"aws-database"}]}"#).unwrap()), "A").unwrap();
        let d = describe(&aws.xml, None).unwrap();
        assert_eq!(
            d.nodes.iter().find(|n| n.id == "f").unwrap().kind,
            "shape:aws4.lambda"
        );
        assert!(describe(&aws.xml, Some("Nope")).is_err());
    }

    #[test]
    fn an_empty_page_has_room_at_the_corner() {
        let d = describe(&crate::diagrams::blank_xml(), None).unwrap();
        assert_eq!((d.free.right, d.free.below), ((40.0, 40.0), (40.0, 40.0)));
        assert!(d.text.contains("0 nodes"));
    }
}
