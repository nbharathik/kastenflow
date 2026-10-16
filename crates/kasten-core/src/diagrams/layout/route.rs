//! Where an edge leaves and enters, and the points it bends at. A laid-out
//! edge is told which side to leave from and which to arrive at (the editor's
//! `exitX`, `exitY`, `entryX`, `entryY`), spread along the side when several
//! edges join the same two boxes, and given the stand-in points of the layers
//! it skips so it goes round the boxes between. The editor routes the rest.

use crate::diagrams::model::{Page, fmt_num};

/// One edge the layout placed.
#[derive(Debug, Clone)]
pub struct Route {
    pub edge: String,
    /// The group (or layer) the layout was made in: the bends are counted from its corner.
    pub frame: String,
    /// The bends, from the edge's source on.
    pub points: Vec<(f64, f64)>,
    /// The edge goes against the flow of the layout.
    pub back: bool,
    /// This is the `rank`-th of `of` edges joining the same two boxes.
    pub rank: usize,
    pub of: usize,
    /// Both ends are boxes of the level that was laid out (not inside a group below it).
    pub direct: bool,
}

/// Writes the routes into the edges of `page`.
pub fn apply(page: &mut Page, routes: &[Route], horizontal: bool) {
    for r in routes {
        let Some(origin) = page
            .get(&r.edge)
            .map(|c| page.origin_of(c.parent.as_deref()))
        else {
            continue;
        };
        // The frame may have moved since the bends were worked out: count from where it is now.
        let frame = page.origin_of(Some(&r.frame));
        let Some(cell) = page.get_mut(&r.edge) else {
            continue;
        };
        let t = fmt_num((r.rank as f64 + 1.0) / (r.of as f64 + 1.0));
        if r.direct {
            let hints: [(&str, &str); 4] = match (horizontal, r.back) {
                (true, false) => [
                    ("exitX", "1"),
                    ("exitY", &t),
                    ("entryX", "0"),
                    ("entryY", &t),
                ],
                (true, true) => [
                    ("exitX", &t),
                    ("exitY", "0"),
                    ("entryX", &t),
                    ("entryY", "0"),
                ],
                (false, false) => [
                    ("exitX", &t),
                    ("exitY", "1"),
                    ("entryX", &t),
                    ("entryY", "0"),
                ],
                (false, true) => [
                    ("exitX", "0"),
                    ("exitY", &t),
                    ("entryX", "0"),
                    ("entryY", &t),
                ],
            };
            for (k, v) in hints {
                cell.style.set(k, v);
            }
        }
        if let Some(geo) = cell.geo.as_mut() {
            geo.points = r
                .points
                .iter()
                .map(|(x, y)| (x + frame.0 - origin.0, y + frame.1 - origin.1))
                .collect();
        }
    }
}
