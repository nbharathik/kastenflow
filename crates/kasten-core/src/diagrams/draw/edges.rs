//! Edges in the draft picture: where they run (straight, or in right angles
//! out of the side the style asks for, through their waypoints), arrowheads,
//! dashes, and their words on a white ground.

use super::style::{Look, n, number};
use super::text;
use crate::diagrams::model::{Cell, Page, Rect, scan};

type P = (f64, f64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Dir {
    N,
    E,
    S,
    W,
}

impl Dir {
    fn horizontal(self) -> bool {
        matches!(self, Dir::E | Dir::W)
    }

    fn opposite(self) -> Dir {
        match self {
            Dir::N => Dir::S,
            Dir::S => Dir::N,
            Dir::E => Dir::W,
            Dir::W => Dir::E,
        }
    }

    /// Which side a point of the box's border given as fractions is on.
    fn of(fx: f64, fy: f64) -> Dir {
        if fx <= 0.01 {
            Dir::W
        } else if fx >= 0.99 {
            Dir::E
        } else if fy <= 0.01 {
            Dir::N
        } else {
            Dir::S
        }
    }

    /// The middle of this side of the box.
    fn middle(self, r: &Rect) -> P {
        match self {
            Dir::N => (r.x + r.w / 2.0, r.y),
            Dir::S => (r.x + r.w / 2.0, r.bottom()),
            Dir::W => (r.x, r.y + r.h / 2.0),
            Dir::E => (r.right(), r.y + r.h / 2.0),
        }
    }
}

/// A point of the box's border from the style's fractions, if it has both.
fn hint(style: &crate::diagrams::model::Style, kx: &str, ky: &str, r: &Rect) -> Option<(P, Dir)> {
    let (fx, fy) = (
        number(style.get(kx), 0.0, 1.0)?,
        number(style.get(ky), 0.0, 1.0)?,
    );
    Some(((r.x + fx * r.w, r.y + fy * r.h), Dir::of(fx, fy)))
}

fn border(r: &Rect, toward: P) -> P {
    let (cx, cy) = r.center();
    let (dx, dy) = (toward.0 - cx, toward.1 - cy);
    if dx == 0.0 && dy == 0.0 {
        return (cx, cy);
    }
    let sx = if dx == 0.0 {
        f64::MAX
    } else {
        (r.w / 2.0) / dx.abs()
    };
    let sy = if dy == 0.0 {
        f64::MAX
    } else {
        (r.h / 2.0) / dy.abs()
    };
    let s = sx.min(sy).min(1.0);
    (cx + dx * s, cy + dy * s)
}

/// The point named by a raw `<mxPoint … as="sourcePoint"/>` kept with the edge.
fn named_point(cell: &Cell, name: &str) -> Option<P> {
    cell.extra_points.iter().find_map(|raw| {
        let tree = scan::parse(raw).ok()?;
        let node = &tree.nodes[tree.root];
        (node.value("as") == Some(name)).then(|| {
            let v = |k: &str| {
                node.value(k)
                    .and_then(|v| v.parse::<f64>().ok())
                    .filter(|v| v.is_finite())
            };
            Some((v("x")?, v("y")?))
        })?
    })
}

fn dedupe(points: Vec<P>) -> Vec<P> {
    let mut out: Vec<P> = Vec::with_capacity(points.len());
    for p in points {
        if out
            .last()
            .is_none_or(|l| (l.0 - p.0).abs() > 0.01 || (l.1 - p.1).abs() > 0.01)
        {
            out.push(p);
        }
    }
    out
}

/// The points an edge runs through, in page coordinates.
pub fn route(page: &Page, edge: &Cell) -> Option<Vec<P>> {
    let (ox, oy) = page.origin_of(edge.parent.as_deref());
    let bends: Vec<P> = edge
        .geo
        .as_ref()
        .map(|g| g.points.iter().map(|(x, y)| (x + ox, y + oy)).collect())
        .unwrap_or_default();
    let src = edge.source.as_deref().and_then(|s| page.abs(s));
    let tgt = edge.target.as_deref().and_then(|t| page.abs(t));
    let loose = |name: &str| named_point(edge, name).map(|(x, y)| (x + ox, y + oy));
    let (src_rect, tgt_rect) = match (src, tgt) {
        (None, None) => {
            let (a, b) = (loose("sourcePoint")?, loose("targetPoint")?);
            return Some(dedupe([vec![a], bends, vec![b]].concat()));
        }
        (Some(s), None) => {
            let b = loose("targetPoint")?;
            let first = bends.first().copied().unwrap_or(b);
            return Some(dedupe([vec![border(&s, first)], bends, vec![b]].concat()));
        }
        (None, Some(t)) => {
            let a = loose("sourcePoint")?;
            let last = bends.last().copied().unwrap_or(a);
            return Some(dedupe([vec![a], bends, vec![border(&t, last)]].concat()));
        }
        (Some(s), Some(t)) => (s, t),
    };
    if edge.source == edge.target {
        let (r, cy) = (src_rect.right(), src_rect.y + src_rect.h / 2.0);
        return Some(vec![
            (r, cy - 8.0),
            (r + 25.0, cy - 8.0),
            (r + 25.0, cy + 8.0),
            (r, cy + 8.0),
        ]);
    }
    let orthogonal = matches!(
        edge.style.get("edgeStyle"),
        Some("orthogonalEdgeStyle" | "elbowEdgeStyle" | "entityRelationEdgeStyle")
    );
    let exit = hint(&edge.style, "exitX", "exitY", &src_rect);
    let entry = hint(&edge.style, "entryX", "entryY", &tgt_rect);
    if !orthogonal {
        let first = bends
            .first()
            .copied()
            .unwrap_or_else(|| entry.map_or(tgt_rect.center(), |e| e.0));
        let last = bends
            .last()
            .copied()
            .unwrap_or_else(|| exit.map_or(src_rect.center(), |e| e.0));
        let a = exit.map_or_else(|| border(&src_rect, first), |e| e.0);
        let b = entry.map_or_else(|| border(&tgt_rect, last), |e| e.0);
        return Some(dedupe([vec![a], bends, vec![b]].concat()));
    }
    // In right angles: out of the side the style names, else the side that faces the way it goes.
    let toward = bends.first().copied().unwrap_or_else(|| tgt_rect.center());
    let (sc, tc) = (src_rect.center(), tgt_rect.center());
    let wide = (toward.0 - sc.0).abs() / (src_rect.w / 2.0 + tgt_rect.w / 2.0).max(1.0);
    let tall = (toward.1 - sc.1).abs() / (src_rect.h / 2.0 + tgt_rect.h / 2.0).max(1.0);
    let guessed = if wide >= tall {
        if toward.0 >= sc.0 { Dir::E } else { Dir::W }
    } else if toward.1 >= sc.1 {
        Dir::S
    } else {
        Dir::N
    };
    let start_dir = exit.map_or(guessed, |e| e.1);
    let end_dir = entry.map_or_else(
        || match bends.last() {
            Some(last) => {
                let wide = (tc.0 - last.0).abs() >= (tc.1 - last.1).abs();
                match (wide, last.0 <= tc.0, last.1 <= tc.1) {
                    (true, true, _) => Dir::W,
                    (true, false, _) => Dir::E,
                    (false, _, true) => Dir::N,
                    (false, _, false) => Dir::S,
                }
            }
            None => start_dir.opposite(),
        },
        |e| e.1,
    );
    let s0 = exit.map_or_else(|| start_dir.middle(&src_rect), |e| e.0);
    let e0 = entry.map_or_else(|| end_dir.middle(&tgt_rect), |e| e.0);
    let mut points = vec![s0];
    if bends.is_empty() {
        match (start_dir.horizontal(), end_dir.horizontal()) {
            (true, true) => {
                let xm = if start_dir == end_dir {
                    if start_dir == Dir::E {
                        s0.0.max(e0.0) + 30.0
                    } else {
                        s0.0.min(e0.0) - 30.0
                    }
                } else {
                    (s0.0 + e0.0) / 2.0
                };
                points.extend([(xm, s0.1), (xm, e0.1)]);
            }
            (false, false) => {
                let ym = if start_dir == end_dir {
                    if start_dir == Dir::S {
                        s0.1.max(e0.1) + 30.0
                    } else {
                        s0.1.min(e0.1) - 30.0
                    }
                } else {
                    (s0.1 + e0.1) / 2.0
                };
                points.extend([(s0.0, ym), (e0.0, ym)]);
            }
            (true, false) => points.push((e0.0, s0.1)),
            (false, true) => points.push((s0.0, e0.1)),
        }
    } else {
        let horizontal = start_dir.horizontal();
        for wp in &bends {
            let cur = points.last().copied().unwrap_or(s0);
            points.push(if horizontal {
                (wp.0, cur.1)
            } else {
                (cur.0, wp.1)
            });
            points.push(*wp);
        }
        let last = points.last().copied().unwrap_or(s0);
        points.push(if end_dir.horizontal() {
            (last.0, e0.1)
        } else {
            (e0.0, last.1)
        });
    }
    points.push(e0);
    Some(dedupe(points))
}

/// Straight segments with the corners rounded when asked.
fn path_of(points: &[P], rounded: bool) -> String {
    let mut d = format!("M {} {}", n(points[0].0), n(points[0].1));
    for i in 1..points.len() {
        if rounded && i + 1 < points.len() {
            let (a, b, c) = (points[i - 1], points[i], points[i + 1]);
            let (la, lc) = (
                ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt(),
                ((c.0 - b.0).powi(2) + (c.1 - b.1).powi(2)).sqrt(),
            );
            let r = 8.0f64.min(la / 2.0).min(lc / 2.0);
            if r > 0.5 {
                let from = (b.0 + (a.0 - b.0) * r / la, b.1 + (a.1 - b.1) * r / la);
                let to = (b.0 + (c.0 - b.0) * r / lc, b.1 + (c.1 - b.1) * r / lc);
                d.push_str(&format!(
                    " L {} {} Q {} {} {} {}",
                    n(from.0),
                    n(from.1),
                    n(b.0),
                    n(b.1),
                    n(to.0),
                    n(to.1)
                ));
                continue;
            }
        }
        d.push_str(&format!(" L {} {}", n(points[i].0), n(points[i].1)));
    }
    d
}

/// An arrowhead of `kind` whose tip is `tip`, on a line that arrives from `from`.
fn head(out: &mut String, kind: &str, tip: P, from: P, size: f64, look: &Look, filled: bool) {
    let (dx, dy) = (tip.0 - from.0, tip.1 - from.1);
    let len = (dx * dx + dy * dy).sqrt();
    if len < 0.01 || kind == "none" {
        return;
    }
    let (ux, uy) = (dx / len, dy / len);
    let (px, py) = (-uy, ux);
    let ink = look.stroke.as_deref().unwrap_or("#000000");
    let fill = if filled { ink } else { "#ffffff" };
    let at = |back: f64, side: f64| (tip.0 - ux * back + px * side, tip.1 - uy * back + py * side);
    let (l, w) = (size, size * 0.6);
    let shape = match kind {
        "open" | "openThin" | "async" => {
            let (a, b) = (at(l, w / 2.0), at(l, -w / 2.0));
            format!(
                "<path d=\"M {} {} L {} {} L {} {}\" fill=\"none\" stroke=\"{ink}\" stroke-width=\"{}\" stroke-linejoin=\"round\"/>\n",
                n(a.0),
                n(a.1),
                n(tip.0),
                n(tip.1),
                n(b.0),
                n(b.1),
                n(look.width)
            )
        }
        "oval" => {
            let c = at(l / 2.0, 0.0);
            format!(
                "<circle cx=\"{}\" cy=\"{}\" r=\"{}\" fill=\"{fill}\" stroke=\"{ink}\" stroke-width=\"{}\"/>\n",
                n(c.0),
                n(c.1),
                n(l / 2.0),
                n(look.width)
            )
        }
        "diamond" | "diamondThin" => {
            let (a, m, b) = (at(l / 2.0, w / 2.0), at(l, 0.0), at(l / 2.0, -w / 2.0));
            format!(
                "<polygon points=\"{} {} {} {} {} {} {} {}\" fill=\"{fill}\" stroke=\"{ink}\" stroke-width=\"{}\"/>\n",
                n(tip.0),
                n(tip.1),
                n(a.0),
                n(a.1),
                n(m.0),
                n(m.1),
                n(b.0),
                n(b.1),
                n(look.width)
            )
        }
        "block" | "blockThin" => {
            let (a, b) = (at(l, w / 2.0), at(l, -w / 2.0));
            format!(
                "<polygon points=\"{} {} {} {} {} {}\" fill=\"{fill}\" stroke=\"{ink}\" stroke-width=\"{}\"/>\n",
                n(tip.0),
                n(tip.1),
                n(a.0),
                n(a.1),
                n(b.0),
                n(b.1),
                n(look.width)
            )
        }
        _ => {
            let (a, notch, b) = (at(l, w / 2.0), at(l * 0.75, 0.0), at(l, -w / 2.0));
            format!(
                "<polygon points=\"{} {} {} {} {} {} {} {}\" fill=\"{fill}\" stroke=\"{ink}\" stroke-width=\"{}\"/>\n",
                n(tip.0),
                n(tip.1),
                n(a.0),
                n(a.1),
                n(notch.0),
                n(notch.1),
                n(b.0),
                n(b.1),
                n(look.width)
            )
        }
    };
    out.push_str(&shape);
}

/// The point halfway along a line, by length.
fn middle(points: &[P]) -> P {
    let total: f64 = points
        .windows(2)
        .map(|w| ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt())
        .sum();
    let mut left = total / 2.0;
    for w in points.windows(2) {
        let len = ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt();
        if len >= left && len > 0.0 {
            let t = left / len;
            return (
                w[0].0 + (w[1].0 - w[0].0) * t,
                w[0].1 + (w[1].1 - w[0].1) * t,
            );
        }
        left -= len;
    }
    points[0]
}

/// Draws an edge; returns the points it ran through (for the picture's bounds).
pub fn draw(out: &mut String, page: &Page, edge: &Cell) -> Vec<P> {
    let Some(points) = route(page, edge).filter(|p| p.len() >= 2) else {
        return Vec::new();
    };
    let look = Look::of(&edge.style, true, false);
    out.push_str(&format!(
        "<path d=\"{}\"{}/>\n",
        path_of(&points, look.rounded),
        look.line()
    ));
    let size = number(edge.style.get("endSize"), 1.0, 40.0).unwrap_or(6.0) + 4.0;
    let start = number(edge.style.get("startSize"), 1.0, 40.0).unwrap_or(6.0) + 4.0;
    let end_kind = edge.style.get("endArrow").unwrap_or("classic");
    let start_kind = edge.style.get("startArrow").unwrap_or("none");
    let last = points.len() - 1;
    head(
        out,
        end_kind,
        points[last],
        points[last - 1],
        size,
        &look,
        edge.style.get("endFill") != Some("0"),
    );
    head(
        out,
        start_kind,
        points[0],
        points[1],
        start,
        &look,
        edge.style.get("startFill") != Some("0"),
    );
    text::put_on_ground(out, &edge.text(), &look, middle(&points));
    points
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagrams::model::Doc;

    fn page(cells: &str) -> Page {
        let xml = format!(
            "<mxfile><diagram id=\"p\" name=\"P\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/>{cells}</root></mxGraphModel></diagram></mxfile>"
        );
        Doc::parse(&xml).unwrap().pages.swap_remove(0)
    }

    fn vertex(id: &str, x: i32, y: i32) -> String {
        format!(
            "<mxCell id=\"{id}\" value=\"{id}\" vertex=\"1\" parent=\"1\" style=\"\"><mxGeometry x=\"{x}\" y=\"{y}\" width=\"100\" height=\"50\" as=\"geometry\"/></mxCell>"
        )
    }

    fn edge(style: &str, points: &str) -> String {
        format!(
            "<mxCell id=\"e\" value=\"go\" style=\"{style}\" edge=\"1\" parent=\"1\" source=\"a\" target=\"b\"><mxGeometry relative=\"1\" as=\"geometry\">{points}</mxGeometry></mxCell>"
        )
    }

    fn route_of(style: &str, points: &str, b: (i32, i32)) -> Vec<P> {
        let p = page(&format!(
            "{}{}{}",
            vertex("a", 0, 0),
            vertex("b", b.0, b.1),
            edge(style, points)
        ));
        route(&p, p.get("e").unwrap()).unwrap()
    }

    #[test]
    fn a_plain_edge_is_a_line_from_border_to_border() {
        assert_eq!(
            route_of("endArrow=classic;", "", (300, 0)),
            vec![(100.0, 25.0), (300.0, 25.0)]
        );
        let bent = route_of(
            "",
            "<Array as=\"points\"><mxPoint x=\"200\" y=\"100\"/></Array>",
            (300, 0),
        );
        assert_eq!(bent.len(), 3);
        assert_eq!(bent[1], (200.0, 100.0));
    }

    #[test]
    fn in_right_angles_an_edge_leaves_the_facing_side_and_bends_halfway() {
        let z = route_of("edgeStyle=orthogonalEdgeStyle;", "", (300, 100));
        assert_eq!(
            z,
            vec![(100.0, 25.0), (200.0, 25.0), (200.0, 125.0), (300.0, 125.0)]
        );
        let down = route_of("edgeStyle=orthogonalEdgeStyle;", "", (20, 200));
        assert_eq!(down[0], (50.0, 50.0));
        assert_eq!(*down.last().unwrap(), (70.0, 200.0));
        assert!(
            down.iter().all(|p| p.0 == 50.0
                || p.0 == 70.0
                || p.1 == 125.0
                || p.1 == 50.0
                || p.1 == 200.0),
            "{down:?}"
        );
        // A hint names the side: out of the top and back in at the top goes over both.
        let over = route_of(
            "edgeStyle=orthogonalEdgeStyle;exitX=0.5;exitY=0;entryX=0.5;entryY=0;",
            "",
            (300, 0),
        );
        assert_eq!(
            over,
            vec![(50.0, 0.0), (50.0, -30.0), (350.0, -30.0), (350.0, 0.0)]
        );
        // Through a waypoint, in right angles.
        let through = route_of(
            "edgeStyle=orthogonalEdgeStyle;",
            "<Array as=\"points\"><mxPoint x=\"200\" y=\"150\"/></Array>",
            (300, 0),
        );
        assert!(
            through
                .windows(2)
                .all(|w| w[0].0 == w[1].0 || w[0].1 == w[1].1),
            "{through:?}"
        );
        assert!(through.contains(&(200.0, 150.0)));
    }

    #[test]
    fn a_loop_and_a_floating_edge_are_drawn_too() {
        let p = page(&format!(
            "{}<mxCell id=\"e\" edge=\"1\" parent=\"1\" source=\"a\" target=\"a\"><mxGeometry relative=\"1\" as=\"geometry\"/></mxCell>",
            vertex("a", 0, 0)
        ));
        assert_eq!(route(&p, p.get("e").unwrap()).unwrap().len(), 4);
        let floating = page(
            "<mxCell id=\"e\" edge=\"1\" parent=\"1\"><mxGeometry relative=\"1\" as=\"geometry\"><mxPoint x=\"10\" y=\"20\" as=\"sourcePoint\"/><mxPoint x=\"110\" y=\"20\" as=\"targetPoint\"/></mxGeometry></mxCell>",
        );
        assert_eq!(
            route(&floating, floating.get("e").unwrap()).unwrap(),
            vec![(10.0, 20.0), (110.0, 20.0)]
        );
        let nothing = page(
            "<mxCell id=\"e\" edge=\"1\" parent=\"1\"><mxGeometry relative=\"1\" as=\"geometry\"/></mxCell>",
        );
        assert!(route(&nothing, nothing.get("e").unwrap()).is_none());
    }

    #[test]
    fn arrowheads_dashes_and_words_are_drawn_as_the_style_says() {
        let p = page(&format!(
            "{}{}{}",
            vertex("a", 0, 0),
            vertex("b", 300, 0),
            edge(
                "endArrow=open;startArrow=oval;dashed=1;strokeColor=#82b366;",
                ""
            )
        ));
        let mut svg = String::new();
        let points = draw(&mut svg, &p, p.get("e").unwrap());
        assert_eq!(points.len(), 2);
        assert!(
            svg.contains("stroke-dasharray=\"3 3\"") && svg.contains("stroke=\"#82b366\""),
            "{svg}"
        );
        assert!(svg.contains("<circle") && svg.contains("fill=\"none\" stroke=\"#82b366\" stroke-width=\"1\" stroke-linejoin=\"round\"/>"), "{svg}");
        assert!(svg.contains(">go</text>") && svg.contains("fill=\"#ffffff\""));
        for (kind, element) in [
            ("classic", "<polygon"),
            ("block", "<polygon"),
            ("diamond", "<polygon"),
            ("oval", "<circle"),
        ] {
            let q = page(&format!(
                "{}{}{}",
                vertex("a", 0, 0),
                vertex("b", 300, 0),
                edge(&format!("endArrow={kind};"), "")
            ));
            let mut s = String::new();
            draw(&mut s, &q, q.get("e").unwrap());
            assert!(s.contains(element), "{kind}: {s}");
        }
        let q = page(&format!(
            "{}{}{}",
            vertex("a", 0, 0),
            vertex("b", 300, 0),
            edge("endArrow=none;", "")
        ));
        let mut s = String::new();
        draw(&mut s, &q, q.get("e").unwrap());
        assert!(!s.contains("<polygon") && !s.contains("<circle"));
    }

    #[test]
    fn rounded_corners_and_the_middle_of_a_line() {
        let square = path_of(&[(0.0, 0.0), (100.0, 0.0), (100.0, 100.0)], true);
        assert_eq!(square, "M 0 0 L 92 0 Q 100 0 100 8 L 100 100");
        assert_eq!(
            path_of(&[(0.0, 0.0), (100.0, 0.0), (100.0, 100.0)], false),
            "M 0 0 L 100 0 L 100 100"
        );
        assert_eq!(
            middle(&[(0.0, 0.0), (100.0, 0.0), (100.0, 100.0)]),
            (100.0, 0.0)
        );
        assert_eq!(middle(&[(0.0, 0.0), (10.0, 0.0)]), (5.0, 0.0));
    }
}
