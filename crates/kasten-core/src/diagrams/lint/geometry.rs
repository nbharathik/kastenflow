//! The geometry lint needs: where an edge runs (estimated from the middles
//! of its ends and its waypoints), whether lines cross and whether a line
//! goes through a box.

use crate::diagrams::model::{Cell, Page, Rect};

pub type Point = (f64, f64);

/// Where the line from the middle of `r` towards `toward` leaves `r`.
pub fn border(r: &Rect, toward: Point) -> Point {
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

/// The points an edge runs through, in page coordinates, or none when an
/// end is not a box with a place.
pub fn polyline(page: &Page, edge: &Cell) -> Option<Vec<Point>> {
    let (src, tgt) = (
        page.abs(edge.source.as_deref()?)?,
        page.abs(edge.target.as_deref()?)?,
    );
    let (ox, oy) = page.origin_of(edge.parent.as_deref());
    let bends: Vec<Point> = edge
        .geo
        .as_ref()
        .map(|g| g.points.iter().map(|(x, y)| (x + ox, y + oy)).collect())
        .unwrap_or_default();
    let first = bends.first().copied().unwrap_or_else(|| tgt.center());
    let last = bends.last().copied().unwrap_or_else(|| src.center());
    let mut points = vec![border(&src, first)];
    points.extend(bends);
    points.push(border(&tgt, last));
    Some(points)
}

fn orient(a: Point, b: Point, c: Point) -> f64 {
    (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0)
}

/// Whether the segments cross in a point that is not an end of either.
pub fn cross(a1: Point, a2: Point, b1: Point, b2: Point) -> bool {
    let (d1, d2) = (orient(b1, b2, a1), orient(b1, b2, a2));
    let (d3, d4) = (orient(a1, a2, b1), orient(a1, a2, b2));
    d1 * d2 < 0.0 && d3 * d4 < 0.0
}

/// Whether the segment `a`–`b` goes through `r`, ignoring a margin at its edge.
pub fn hits(a: Point, b: Point, r: &Rect, margin: f64) -> bool {
    let inner = Rect {
        x: r.x + margin,
        y: r.y + margin,
        w: r.w - 2.0 * margin,
        h: r.h - 2.0 * margin,
    };
    if inner.w <= 0.0 || inner.h <= 0.0 {
        return false;
    }
    let inside =
        |p: Point| p.0 > inner.x && p.0 < inner.right() && p.1 > inner.y && p.1 < inner.bottom();
    if inside(a) || inside(b) {
        return true;
    }
    let corners = [
        (inner.x, inner.y),
        (inner.right(), inner.y),
        (inner.right(), inner.bottom()),
        (inner.x, inner.bottom()),
    ];
    (0..4).any(|i| cross(a, b, corners[i], corners[(i + 1) % 4]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_line_leaves_a_box_at_its_border_towards_the_other_end() {
        let r = Rect {
            x: 0.0,
            y: 0.0,
            w: 100.0,
            h: 50.0,
        };
        assert_eq!(border(&r, (300.0, 25.0)), (100.0, 25.0));
        assert_eq!(border(&r, (50.0, -200.0)), (50.0, 0.0));
        assert_eq!(border(&r, (50.0, 25.0)), (50.0, 25.0));
    }

    #[test]
    fn crossing_means_a_point_inside_both_lines() {
        assert!(cross((0.0, 0.0), (10.0, 10.0), (0.0, 10.0), (10.0, 0.0)));
        assert!(!cross((0.0, 0.0), (10.0, 0.0), (10.0, 0.0), (10.0, 10.0)));
        assert!(!cross((0.0, 0.0), (10.0, 0.0), (0.0, 5.0), (10.0, 5.0)));
    }

    #[test]
    fn a_line_hits_a_box_it_passes_through_and_not_one_it_passes_by() {
        let r = Rect {
            x: 40.0,
            y: 40.0,
            w: 20.0,
            h: 20.0,
        };
        assert!(hits((0.0, 50.0), (100.0, 50.0), &r, 2.0));
        assert!(!hits((0.0, 20.0), (100.0, 20.0), &r, 2.0));
        assert!(hits((50.0, 50.0), (200.0, 200.0), &r, 2.0));
        assert!(!hits((0.0, 41.0), (100.0, 41.0), &r, 2.0));
    }
}
