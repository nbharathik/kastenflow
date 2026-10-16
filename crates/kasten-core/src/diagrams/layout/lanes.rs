//! Swimlanes: bands side by side across the flow, each holding the boxes of
//! one actor. The whole is layered as one graph so a box is in the column its
//! place in the flow gives it, whichever lane it is in; the boxes of a lane
//! that share a column are stacked inside the lane, and a lane is as tall as
//! its fullest column needs.

use std::collections::HashMap;

use super::containers::{Driver, PAD, START, rank_pairs, up};
use super::coords::place;
use super::layers::{Graph, Slot, layer};
use super::place::snap;
use super::route::Route;
use crate::diagrams::presets::HEADER;

const STACK_GAP: f64 = 30.0;
const MIN_BAND: f64 = 100.0;

impl Driver<'_> {
    /// Lays out lanes whose titles run down their left side; the flow goes left to right.
    pub(super) fn lanes(&mut self, container: &str, lanes: &[String], top: bool) {
        let mut nodes: Vec<(usize, String)> = Vec::new();
        for (i, lane) in lanes.iter().enumerate() {
            nodes.extend(self.kids(lane).into_iter().map(|k| (i, k)));
        }
        let (off_x, off_y) = if top {
            (START, START)
        } else {
            (PAD, PAD + HEADER)
        };
        let ids: Vec<String> = nodes.iter().map(|(_, id)| id.clone()).collect();
        let joints = self.joints(&ids);
        let graph = Graph {
            nodes: nodes.len(),
            edges: joints.iter().map(|j| (j.a, j.b)).collect(),
        };
        let lay = layer(&graph);
        let sizes: Vec<(f64, f64)> = ids.iter().map(|id| self.size(id)).collect();
        let mut extra = vec![0.0; lay.layers.len()];
        for (e, j) in joints.iter().enumerate() {
            let from = lay.layer[lay.forward[e].0];
            let room = (j.label as f64 * 6.0 + 16.0).min(140.0);
            if j.label > 0 && room > extra[from] {
                extra[from] = room;
            }
        }
        let placed = place(
            &lay,
            joints.len(),
            &sizes,
            true,
            80.0 * self.spacing,
            40.0 * self.spacing,
            &extra,
        );
        self.crossings += lay.crossings;
        // Per lane and column, the boxes in the order the layering gave them.
        let mut stacks: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
        for (l, slots) in lay.layers.iter().enumerate() {
            for slot in slots {
                if let Slot::Node(v) = slot {
                    stacks.entry((nodes[*v].0, l)).or_default().push(*v);
                }
            }
        }
        let height_of = |lane: usize| {
            stacks
                .iter()
                .filter(|((li, _), _)| *li == lane)
                .map(|(_, vs)| {
                    vs.iter().map(|&v| sizes[v].1).sum::<f64>()
                        + STACK_GAP * (vs.len() as f64 - 1.0)
                })
                .fold(0.0, f64::max)
        };
        let width = up(placed.total.0 + HEADER + 2.0 * PAD);
        let mut y = off_y;
        let mut right = 0.0f64;
        for (li, lane) in lanes.iter().enumerate() {
            let band = up((height_of(li) + 2.0 * PAD).max(MIN_BAND));
            self.set_pos(lane, snap(off_x), snap(y));
            self.set_size(lane, width, band);
            for l in 0..lay.layers.len() {
                let Some(vs) = stacks.get(&(li, l)) else {
                    continue;
                };
                let mut at = PAD;
                for &v in vs {
                    let x = snap(HEADER + PAD + placed.pos[v].0);
                    self.set_pos(&ids[v], x, snap(at));
                    at += sizes[v].1 + STACK_GAP;
                }
            }
            y += band;
            right = right.max(off_x + width);
        }
        let ranks = rank_pairs(&joints.iter().collect::<Vec<_>>());
        for (e, j) in joints.iter().enumerate() {
            self.routes.push(Route {
                edge: j.id.clone(),
                frame: container.to_owned(),
                points: Vec::new(),
                back: lay.back[e],
                rank: ranks[e].0,
                of: ranks[e].1,
                // The ends are in lanes: they leave and arrive at the boxes' own sides all the same.
                direct: true,
            });
        }
        if !top {
            self.fit(container, right + PAD, y + PAD);
        }
    }
}
