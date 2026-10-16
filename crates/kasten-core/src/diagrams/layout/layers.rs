//! Layering: which column (or row) each box goes in, and in what order down
//! it. The boxes are a directed graph; a cycle is broken at the edge that
//! closes it, which is then drawn going back. An edge that skips layers gets
//! a stand-in slot in each layer it crosses, so real boxes make room for the
//! line instead of sitting on it. The order is swept to the middle of the
//! neighbours several times and the order with the fewest crossings kept.
//! The method follows the Slides diagram layout; this one also counts
//! crossings and works for any number of boxes in the same order every time.

use std::collections::HashMap;

/// The graph: how many boxes, and the edges between them by index.
pub struct Graph {
    pub nodes: usize,
    pub edges: Vec<(usize, usize)>,
}

/// A place in a layer: a box, or the room an edge takes as it passes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Slot {
    Node(usize),
    Dummy(usize),
}

pub struct Layering {
    /// The layer of each box.
    pub layer: Vec<usize>,
    /// The slots of each layer, in order.
    pub layers: Vec<Vec<Slot>>,
    /// Whether an edge goes against the direction of the layers.
    pub back: Vec<bool>,
    /// The edges as the layers see them: always forward.
    pub forward: Vec<(usize, usize)>,
    /// How many edges cross in the order chosen.
    pub crossings: usize,
    links: Links,
}

impl Layering {
    /// The slots of layer `l - 1` that `slot` of layer `l` is joined to.
    pub fn above(&self, slot: Slot, l: usize) -> Vec<Slot> {
        self.links.above(&self.forward, &self.layer, slot, l)
    }

    /// The slots of layer `l + 1` that `slot` of layer `l` is joined to.
    pub fn below(&self, slot: Slot, l: usize) -> Vec<Slot> {
        self.links.below(&self.forward, &self.layer, slot, l)
    }
}

/// The edges that close a cycle, found by walking from the boxes in order.
fn back_edges(graph: &Graph) -> Vec<bool> {
    let mut out: Vec<Vec<(usize, usize)>> = vec![Vec::new(); graph.nodes];
    for (e, &(u, v)) in graph.edges.iter().enumerate() {
        out[u].push((e, v));
    }
    // 0 unseen, 1 on the way down, 2 done.
    let mut state = vec![0u8; graph.nodes];
    let mut back = vec![false; graph.edges.len()];
    for root in 0..graph.nodes {
        if state[root] != 0 {
            continue;
        }
        let mut stack = vec![(root, 0usize)];
        state[root] = 1;
        while let Some(&(u, next)) = stack.last() {
            match out[u].get(next) {
                Some(&(e, v)) => {
                    if let Some(top) = stack.last_mut() {
                        top.1 += 1;
                    }
                    match state[v] {
                        0 => {
                            state[v] = 1;
                            stack.push((v, 0));
                        }
                        1 => back[e] = true,
                        _ => {}
                    }
                }
                None => {
                    state[u] = 2;
                    stack.pop();
                }
            }
        }
    }
    back
}

/// Neighbours of a slot in the layer above or below, as `Slot`s.
struct Links {
    ins: Vec<Vec<usize>>,
    outs: Vec<Vec<usize>>,
}

impl Links {
    fn above(
        &self,
        forward: &[(usize, usize)],
        layer: &[usize],
        slot: Slot,
        l: usize,
    ) -> Vec<Slot> {
        let edges: Vec<usize> = match slot {
            Slot::Node(v) => self.ins[v].clone(),
            Slot::Dummy(e) => vec![e],
        };
        edges
            .into_iter()
            .map(|e| {
                if layer[forward[e].0] + 1 == l {
                    Slot::Node(forward[e].0)
                } else {
                    Slot::Dummy(e)
                }
            })
            .collect()
    }

    fn below(
        &self,
        forward: &[(usize, usize)],
        layer: &[usize],
        slot: Slot,
        l: usize,
    ) -> Vec<Slot> {
        let edges: Vec<usize> = match slot {
            Slot::Node(u) => self.outs[u].clone(),
            Slot::Dummy(e) => vec![e],
        };
        edges
            .into_iter()
            .map(|e| {
                if layer[forward[e].1] == l + 1 {
                    Slot::Node(forward[e].1)
                } else {
                    Slot::Dummy(e)
                }
            })
            .collect()
    }
}

/// How many pairs of links between layer `l` and `l + 1` cross.
fn crossings_between(
    layers: &[Vec<Slot>],
    links: &Links,
    forward: &[(usize, usize)],
    layer: &[usize],
    l: usize,
) -> usize {
    let upper: HashMap<Slot, usize> = layers[l].iter().enumerate().map(|(i, &s)| (s, i)).collect();
    let mut pairs: Vec<(usize, usize)> = Vec::new();
    for (j, &slot) in layers[l + 1].iter().enumerate() {
        for n in links.above(forward, layer, slot, l + 1) {
            if let Some(&i) = upper.get(&n) {
                pairs.push((i, j));
            }
        }
    }
    let mut count = 0;
    for (a, &(i1, j1)) in pairs.iter().enumerate() {
        for &(i2, j2) in &pairs[a + 1..] {
            if (i1 < i2 && j1 > j2) || (i1 > i2 && j1 < j2) {
                count += 1;
            }
        }
    }
    count
}

fn total_crossings(
    layers: &[Vec<Slot>],
    links: &Links,
    forward: &[(usize, usize)],
    layer: &[usize],
) -> usize {
    (0..layers.len().saturating_sub(1))
        .map(|l| crossings_between(layers, links, forward, layer, l))
        .sum()
}

fn reorder(
    layers: &mut [Vec<Slot>],
    at: usize,
    beside: usize,
    neighbours: impl Fn(Slot) -> Vec<Slot>,
) {
    let places: HashMap<Slot, usize> = layers[beside]
        .iter()
        .enumerate()
        .map(|(i, &s)| (s, i))
        .collect();
    let mut keyed: Vec<(f64, usize, Slot)> = layers[at]
        .iter()
        .enumerate()
        .map(|(i, &slot)| {
            let found: Vec<f64> = neighbours(slot)
                .iter()
                .filter_map(|n| places.get(n))
                .map(|&p| p as f64)
                .collect();
            let middle = if found.is_empty() {
                i as f64
            } else {
                found.iter().sum::<f64>() / found.len() as f64
            };
            (middle, i, slot)
        })
        .collect();
    keyed.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    layers[at] = keyed.into_iter().map(|(_, _, s)| s).collect();
}

pub fn layer(graph: &Graph) -> Layering {
    let back = back_edges(graph);
    let forward: Vec<(usize, usize)> = graph
        .edges
        .iter()
        .zip(&back)
        .map(|(&(u, v), &b)| if b { (v, u) } else { (u, v) })
        .collect();
    let mut ins: Vec<Vec<usize>> = vec![Vec::new(); graph.nodes];
    let mut outs: Vec<Vec<usize>> = vec![Vec::new(); graph.nodes];
    for (e, &(u, v)) in forward.iter().enumerate() {
        outs[u].push(e);
        ins[v].push(e);
    }
    // Topological order, the lowest index first among those that are ready.
    let mut waiting: Vec<usize> = ins.iter().map(Vec::len).collect();
    let mut ready: Vec<usize> = (0..graph.nodes).filter(|&v| waiting[v] == 0).collect();
    let mut order = Vec::with_capacity(graph.nodes);
    while !ready.is_empty() {
        ready.sort_unstable_by(|a, b| b.cmp(a));
        let Some(u) = ready.pop() else { break };
        order.push(u);
        for &e in &outs[u] {
            let v = forward[e].1;
            waiting[v] -= 1;
            if waiting[v] == 0 {
                ready.push(v);
            }
        }
    }
    let mut layer = vec![0usize; graph.nodes];
    for &v in &order {
        layer[v] = ins[v]
            .iter()
            .map(|&e| layer[forward[e].0] + 1)
            .max()
            .unwrap_or(0);
    }
    // A box nothing leads to sits next to the first thing it leads to, not at the far end.
    for &v in order.iter().rev() {
        if ins[v].is_empty()
            && let Some(nearest) = outs[v].iter().map(|&e| layer[forward[e].1]).min()
        {
            layer[v] = nearest.saturating_sub(1);
        }
    }
    let count = layer.iter().max().map_or(1, |m| m + 1);
    let mut layers: Vec<Vec<Slot>> = vec![Vec::new(); count];
    for (v, &l) in layer.iter().enumerate() {
        layers[l].push(Slot::Node(v));
    }
    for (e, &(u, v)) in forward.iter().enumerate() {
        for crossed in layers.iter_mut().take(layer[v]).skip(layer[u] + 1) {
            crossed.push(Slot::Dummy(e));
        }
    }
    let links = Links { ins, outs };
    let mut best = layers.clone();
    let mut best_count = total_crossings(&best, &links, &forward, &layer);
    // Sweep down and up, putting each slot at the middle of its neighbours in the next layer.
    for _ in 0..8 {
        if best_count == 0 {
            break;
        }
        for l in 1..count {
            reorder(&mut layers, l, l - 1, |s| {
                links.above(&forward, &layer, s, l)
            });
        }
        for l in (0..count.saturating_sub(1)).rev() {
            reorder(&mut layers, l, l + 1, |s| {
                links.below(&forward, &layer, s, l)
            });
        }
        let now = total_crossings(&layers, &links, &forward, &layer);
        if now < best_count {
            best = layers.clone();
            best_count = now;
        }
    }
    Layering {
        layer,
        layers: best,
        back,
        forward,
        crossings: best_count,
        links,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn graph(nodes: usize, edges: &[(usize, usize)]) -> Graph {
        Graph {
            nodes,
            edges: edges.to_vec(),
        }
    }

    #[test]
    fn a_chain_has_a_layer_for_each_box() {
        let l = layer(&graph(4, &[(0, 1), (1, 2), (2, 3)]));
        assert_eq!(l.layer, [0, 1, 2, 3]);
        assert!(l.back.iter().all(|b| !b));
        assert!(l.layers.iter().all(|s| s.len() == 1));
        assert_eq!(l.crossings, 0);
    }

    #[test]
    fn a_long_edge_leaves_a_stand_in_in_each_layer_it_crosses() {
        let l = layer(&graph(3, &[(0, 1), (1, 2), (0, 2)]));
        assert_eq!(l.layer, [0, 1, 2]);
        assert_eq!(l.layers[1].len(), 2);
        assert!(l.layers[1].contains(&Slot::Dummy(2)));
    }

    #[test]
    fn a_cycle_is_broken_at_the_edge_that_closes_it() {
        let l = layer(&graph(3, &[(0, 1), (1, 2), (2, 0)]));
        assert_eq!(l.back, [false, false, true]);
        assert_eq!(l.layer, [0, 1, 2]);
        assert_eq!(l.forward[2], (0, 2));
    }

    #[test]
    fn a_box_nothing_leads_to_sits_next_to_what_it_leads_to() {
        let l = layer(&graph(4, &[(0, 1), (1, 2), (3, 2)]));
        assert_eq!(l.layer[3], 1);
    }

    #[test]
    fn the_sweeps_untangle_a_crossing_when_the_order_can_be_changed() {
        // Two sources feeding two sinks the wrong way round: one crossing in the given order, none after.
        let g = graph(4, &[(0, 3), (1, 2)]);
        let l = layer(&g);
        assert_eq!(l.crossings, 0, "{:?}", l.layers);
        // K2,2 cannot do better than one crossing.
        let k = layer(&graph(4, &[(0, 2), (0, 3), (1, 2), (1, 3)]));
        assert_eq!(k.crossings, 1);
    }

    #[test]
    fn the_same_graph_is_always_laid_out_the_same_way() {
        let g = graph(6, &[(0, 3), (0, 4), (1, 3), (2, 4), (3, 5), (4, 5), (5, 0)]);
        let (a, b) = (layer(&g), layer(&g));
        assert_eq!(a.layers, b.layers);
        assert_eq!(a.layer, b.layer);
    }
}
