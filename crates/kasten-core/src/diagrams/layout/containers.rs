//! Laying out one level at a time: the boxes of the page, or of one group,
//! with groups laid out first (deepest first) and then taken as boxes of the
//! level above, sized to hold what they hold. A level is split into the
//! pieces that are joined by edges; each piece is layered, and boxes with no
//! edges go into a grid after them.

use std::collections::HashMap;

use super::coords::place;
use super::layers::{Graph, layer};
use super::place::{GRID, snap};
use super::route::Route;
use crate::diagrams::model::{Geo, Kind, Page, Style};
use crate::diagrams::presets::HEADER;

/// Room kept between a group's edge and what it holds.
pub(super) const PAD: f64 = 20.0;
/// Where the top level starts.
pub(super) const START: f64 = 40.0;
const PIECE_GAP: f64 = 60.0;
const DEFAULT: (f64, f64) = (120.0, 60.0);

pub(super) struct Driver<'a> {
    pub page: &'a mut Page,
    pub horizontal: bool,
    pub spacing: f64,
    pub routes: Vec<Route>,
    pub crossings: usize,
}

/// An edge of the level: the boxes it joins (as indexes of the level's boxes).
pub(super) struct Joint {
    pub id: String,
    pub a: usize,
    pub b: usize,
    pub direct: bool,
    pub label: usize,
}

/// For each edge, which of the edges joining the same two boxes it is, and how many there are.
pub(super) fn rank_pairs(joints: &[&Joint]) -> Vec<(usize, usize)> {
    let pair = |j: &Joint| (j.a.min(j.b), j.a.max(j.b));
    let mut counts: HashMap<(usize, usize), usize> = HashMap::new();
    for j in joints {
        *counts.entry(pair(j)).or_default() += 1;
    }
    let mut seen: HashMap<(usize, usize), usize> = HashMap::new();
    joints
        .iter()
        .map(|j| {
            let rank = seen.entry(pair(j)).or_default();
            *rank += 1;
            (*rank - 1, counts[&pair(j)])
        })
        .collect()
}

pub(super) fn up(v: f64) -> f64 {
    (v / GRID).ceil() * GRID
}

impl Driver<'_> {
    pub(super) fn size(&self, id: &str) -> (f64, f64) {
        self.page
            .get(id)
            .and_then(|c| c.geo.as_ref())
            .map_or(DEFAULT, |g| {
                (
                    if g.w > 0.0 { g.w } else { DEFAULT.0 },
                    if g.h > 0.0 { g.h } else { DEFAULT.1 },
                )
            })
    }

    pub(super) fn set_pos(&mut self, id: &str, x: f64, y: f64) {
        if let Some(c) = self.page.get_mut(id) {
            let g = c.geo.get_or_insert_with(Geo::default);
            (g.x, g.y) = (x, y);
            if g.w <= 0.0 || g.h <= 0.0 {
                (g.w, g.h) = DEFAULT;
            }
        }
    }

    pub(super) fn set_size(&mut self, id: &str, w: f64, h: f64) {
        if let Some(c) = self.page.get_mut(id) {
            let g = c.geo.get_or_insert_with(Geo::default);
            (g.w, g.h) = (w, h);
        }
    }

    /// The vertices directly in `container`, in the file's order.
    pub(super) fn kids(&self, container: &str) -> Vec<String> {
        self.page
            .children_of(container)
            .filter(|c| c.kind == Kind::Vertex)
            .map(|c| c.id.clone())
            .collect()
    }

    fn style(&self, id: &str) -> Style {
        self.page
            .get(id)
            .map(|c| c.style.clone())
            .unwrap_or_default()
    }

    /// Lays out every group, the deepest first, then the page.
    pub(super) fn all(&mut self) {
        let layer = self.page.default_parent();
        let mut groups: Vec<(usize, usize, String)> = self
            .page
            .vertices()
            .enumerate()
            .filter(|(_, c)| self.page.children_of(&c.id).any(|k| k.kind == Kind::Vertex))
            .map(|(order, c)| (self.page.ancestors(&c.id).len(), order, c.id.clone()))
            .collect();
        groups.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        for (_, _, id) in groups {
            self.level(&id);
        }
        self.level(&layer);
    }

    /// Lays out one group and the groups inside it, and makes the groups
    /// around it big enough to hold it. The group itself stays where it is.
    pub(super) fn within(&mut self, scope: &str) {
        let mut inner: Vec<(usize, usize, String)> = self
            .page
            .descendants(scope)
            .into_iter()
            .enumerate()
            .filter(|(_, id)| self.page.children_of(id).any(|k| k.kind == Kind::Vertex))
            .map(|(order, id)| (self.page.ancestors(&id).len(), order, id))
            .collect();
        inner.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        for (_, _, id) in inner {
            self.level(&id);
        }
        self.level(scope);
        let mut child = scope.to_owned();
        for outer in self.page.ancestors(scope).into_iter().skip(1) {
            if let (Some(inside), Some(group)) = (self.page.abs(&child), self.page.abs(&outer)) {
                let (w, h) = (
                    group.w.max(inside.right() + PAD - group.x),
                    group.h.max(inside.bottom() + PAD - group.y),
                );
                if (w, h) != (group.w, group.h) {
                    self.set_size(&outer, up(w), up(h));
                }
            }
            child = outer;
        }
    }

    /// Lays out the boxes directly in `container` (a group, or the layer).
    pub(super) fn level(&mut self, container: &str) {
        let kids = self.kids(container);
        if kids.is_empty() {
            return;
        }
        let top = self
            .page
            .get(container)
            .is_none_or(|c| c.kind != Kind::Vertex);
        let style = self.style(container);
        if !top && style.get("childLayout") == Some("stackLayout") {
            self.stack(container, &kids);
            return;
        }
        if kids.iter().all(|k| self.is_lane(k)) {
            self.lanes(container, &kids, top);
            return;
        }
        let (off_x, off_y) = if top {
            (START, START)
        } else if style.get("horizontal") == Some("0") {
            (PAD + HEADER, PAD)
        } else {
            (PAD, PAD + HEADER)
        };
        let joints = self.joints(&kids);
        let n = kids.len();
        let mut parent: Vec<usize> = (0..n).collect();
        fn find(parent: &mut [usize], mut x: usize) -> usize {
            while parent[x] != x {
                parent[x] = parent[parent[x]];
                x = parent[x];
            }
            x
        }
        for j in &joints {
            let (ra, rb) = (find(&mut parent, j.a), find(&mut parent, j.b));
            if ra != rb {
                parent[ra.max(rb)] = ra.min(rb);
            }
        }
        let mut pieces: Vec<Vec<usize>> = Vec::new();
        let mut slot: HashMap<usize, usize> = HashMap::new();
        for i in 0..n {
            let r = find(&mut parent, i);
            let at = *slot.entry(r).or_insert_with(|| {
                pieces.push(Vec::new());
                pieces.len() - 1
            });
            pieces[at].push(i);
        }
        let mut cursor = 0.0;
        let horizontal = self.horizontal;
        let (mut right, mut bottom) = (0.0f64, 0.0f64);
        let singles: Vec<usize> = pieces
            .iter()
            .filter(|m| m.len() == 1)
            .map(|m| m[0])
            .collect();
        for members in pieces.iter().filter(|m| m.len() > 1) {
            let local: HashMap<usize, usize> =
                members.iter().enumerate().map(|(l, &g)| (g, l)).collect();
            let mine: Vec<&Joint> = joints.iter().filter(|j| local.contains_key(&j.a)).collect();
            let graph = Graph {
                nodes: members.len(),
                edges: mine.iter().map(|j| (local[&j.a], local[&j.b])).collect(),
            };
            let lay = layer(&graph);
            let sizes: Vec<(f64, f64)> = members.iter().map(|&m| self.size(&kids[m])).collect();
            let mut extra = vec![0.0; lay.layers.len()];
            for (e, j) in mine.iter().enumerate() {
                let from = lay.layer[lay.forward[e].0];
                let room = if self.horizontal {
                    (j.label as f64 * 6.0 + 16.0).min(140.0)
                } else {
                    20.0
                };
                if j.label > 0 && room > extra[from] {
                    extra[from] = room;
                }
            }
            let (main_gap, cross_gap) = (
                if self.horizontal { 80.0 } else { 60.0 } * self.spacing,
                40.0 * self.spacing,
            );
            let placed = place(
                &lay,
                mine.len(),
                &sizes,
                self.horizontal,
                main_gap,
                cross_gap,
                &extra,
            );
            self.crossings += lay.crossings;
            let at = cursor;
            let shift = move |p: (f64, f64)| {
                if horizontal {
                    (p.0, p.1 + at)
                } else {
                    (p.0 + at, p.1)
                }
            };
            for (l, &m) in members.iter().enumerate() {
                let (x, y) = shift(placed.pos[l]);
                let (x, y) = (snap(off_x + x), snap(off_y + y));
                self.set_pos(&kids[m], x, y);
                right = right.max(x + sizes[l].0);
                bottom = bottom.max(y + sizes[l].1);
            }
            let ranks = rank_pairs(&mine);
            for (e, j) in mine.iter().enumerate() {
                let points = placed.paths[e]
                    .iter()
                    .map(|&p| {
                        let (x, y) = shift(p);
                        (off_x + x, off_y + y)
                    })
                    .collect();
                self.routes.push(Route {
                    edge: j.id.clone(),
                    frame: container.to_owned(),
                    points,
                    back: lay.back[e],
                    rank: ranks[e].0,
                    of: ranks[e].1,
                    direct: j.direct,
                });
            }
            cursor += (if horizontal {
                placed.total.1
            } else {
                placed.total.0
            }) + PIECE_GAP;
        }
        if !singles.is_empty() {
            let (cell_w, cell_h) = singles.iter().fold((0.0f64, 0.0f64), |a, &s| {
                let (w, h) = self.size(&kids[s]);
                (a.0.max(w), a.1.max(h))
            });
            let columns = ((singles.len() as f64).sqrt().ceil() as usize).clamp(1, 6);
            let start = if self.horizontal {
                (0.0, cursor)
            } else {
                (cursor, 0.0)
            };
            for (k, &s) in singles.iter().enumerate() {
                let (col, row) = (k % columns, k / columns);
                let x = snap(off_x + start.0 + col as f64 * (cell_w + 40.0 * self.spacing));
                let y = snap(off_y + start.1 + row as f64 * (cell_h + 40.0 * self.spacing));
                self.set_pos(&kids[s], x, y);
                let (w, h) = self.size(&kids[s]);
                right = right.max(x + w);
                bottom = bottom.max(y + h);
            }
        }
        if !top {
            self.fit(container, right + PAD, bottom + PAD);
        }
    }

    /// Sizes a group to `w` by `h` (its content and room), on the grid.
    pub(super) fn fit(&mut self, container: &str, w: f64, h: f64) {
        let min = (80.0, HEADER + 2.0 * PAD);
        self.set_size(container, up(w.max(min.0)), up(h.max(min.1)));
    }

    /// The edges between the level's boxes, each end taken up to the box of
    /// the level that holds it.
    pub(super) fn joints(&self, kids: &[String]) -> Vec<Joint> {
        let index: HashMap<&str, usize> = kids
            .iter()
            .enumerate()
            .map(|(i, k)| (k.as_str(), i))
            .collect();
        let lift = |id: &str| {
            self.page
                .ancestors(id)
                .iter()
                .find_map(|a| index.get(a.as_str()).copied())
        };
        let mut out = Vec::new();
        for e in self.page.edges() {
            let (Some(s), Some(t)) = (&e.source, &e.target) else {
                continue;
            };
            let (Some(a), Some(b)) = (lift(s), lift(t)) else {
                continue;
            };
            if a == b {
                continue;
            }
            out.push(Joint {
                id: e.id.clone(),
                a,
                b,
                direct: *s == kids[a] && *t == kids[b],
                label: e.text().chars().count(),
            });
        }
        out
    }

    pub(super) fn is_lane(&self, id: &str) -> bool {
        let s = self.style(id);
        s.bare() == Some("swimlane") && s.get("horizontal") == Some("0")
    }

    /// A table or a class box: the rows one under the other, as wide as the box.
    fn stack(&mut self, container: &str, rows: &[String]) {
        let (width, _) = self.size(container);
        let mut y = HEADER;
        for r in rows {
            let (_, h) = self.size(r);
            self.set_pos(r, 0.0, y);
            self.set_size(r, width, h);
            y += h;
        }
        self.set_size(container, width, y + 6.0);
    }
}
