//! Coordinates for a layering: layers get their place along the flow, and
//! the boxes of a layer their place across it, as near the middle of their
//! neighbours as the room allows (the closest fit that keeps the order and
//! the gaps, found by pooling adjacent violators).

use super::layers::{Layering, Slot};

/// A layered layout in page units: the top left of each box, how big the
/// whole is, and the points an edge passes through between its two ends.
pub struct Placed {
    pub pos: Vec<(f64, f64)>,
    pub total: (f64, f64),
    /// For each edge (as given, not as layered), the stand-in points it passes, from its source on.
    pub paths: Vec<Vec<(f64, f64)>>,
}

/// The closest positions to `desired` that keep the order and `seps[i]`
/// between neighbours `i` and `i + 1`.
fn resolve(desired: &[f64], seps: &[f64]) -> Vec<f64> {
    let n = desired.len();
    let mut offset = vec![0.0; n];
    for i in 1..n {
        offset[i] = offset[i - 1] + seps[i - 1];
    }
    // Pool adjacent violators on desired - offset, which must not decrease.
    let mut blocks: Vec<(f64, usize)> = Vec::new();
    for i in 0..n {
        blocks.push((desired[i] - offset[i], 1));
        while blocks.len() >= 2 {
            let (a, b) = (blocks[blocks.len() - 2], blocks[blocks.len() - 1]);
            if a.0 / a.1 as f64 <= b.0 / b.1 as f64 {
                break;
            }
            blocks.truncate(blocks.len() - 2);
            blocks.push((a.0 + b.0, a.1 + b.1));
        }
    }
    let mut out = Vec::with_capacity(n);
    for (sum, count) in blocks {
        let mean = sum / count as f64;
        out.extend(std::iter::repeat_n(mean, count));
    }
    out.iter().zip(&offset).map(|(y, o)| y + o).collect()
}

/// Places the layering. `sizes` are the boxes' width and height; `extra_after[l]`
/// is room added after layer `l` (for the words on the edges there).
pub fn place(
    lay: &Layering,
    edges: usize,
    sizes: &[(f64, f64)],
    horizontal: bool,
    main_gap: f64,
    cross_gap: f64,
    extra_after: &[f64],
) -> Placed {
    let count = lay.layers.len();
    let cross = |s: Slot| match s {
        Slot::Node(v) => {
            if horizontal {
                sizes[v].1
            } else {
                sizes[v].0
            }
        }
        Slot::Dummy(_) => 10.0,
    };
    let main = |s: Slot| match s {
        Slot::Node(v) => {
            if horizontal {
                sizes[v].0
            } else {
                sizes[v].1
            }
        }
        Slot::Dummy(_) => 0.0,
    };
    let main_size: Vec<f64> = lay
        .layers
        .iter()
        .map(|l| l.iter().map(|&s| main(s)).fold(0.0, f64::max))
        .collect();
    let mut main_start = vec![0.0; count];
    let mut at = 0.0;
    for l in 0..count {
        main_start[l] = at;
        at += main_size[l] + main_gap + extra_after.get(l).copied().unwrap_or(0.0);
    }
    let total_main = (at
        - main_gap
        - extra_after
            .get(count.saturating_sub(1))
            .copied()
            .unwrap_or(0.0))
    .max(0.0);

    let seps: Vec<Vec<f64>> = lay
        .layers
        .iter()
        .map(|layer| {
            layer
                .windows(2)
                .map(|w| {
                    let gap = if matches!((w[0], w[1]), (Slot::Node(_), Slot::Node(_))) {
                        cross_gap
                    } else {
                        cross_gap / 2.0
                    };
                    (cross(w[0]) + cross(w[1])) / 2.0 + gap
                })
                .collect()
        })
        .collect();
    // Packed to start with, and each layer centred on the widest.
    let mut centres: Vec<Vec<f64>> = lay
        .layers
        .iter()
        .zip(&seps)
        .map(|(layer, s)| resolve(&vec![0.0; layer.len()], s))
        .collect();
    for c in &mut centres {
        if let (Some(first), Some(last)) = (c.first().copied(), c.last().copied()) {
            let mid = (first + last) / 2.0;
            c.iter_mut().for_each(|x| *x -= mid);
        }
    }
    let index: Vec<std::collections::HashMap<Slot, usize>> = lay
        .layers
        .iter()
        .map(|layer| layer.iter().enumerate().map(|(i, &s)| (s, i)).collect())
        .collect();
    for _ in 0..6 {
        for l in 1..count {
            let desired: Vec<f64> = lay.layers[l]
                .iter()
                .enumerate()
                .map(|(i, &s)| {
                    mean_of(&lay.above(s, l), &index[l - 1], &centres[l - 1])
                        .unwrap_or(centres[l][i])
                })
                .collect();
            centres[l] = resolve(&desired, &seps[l]);
        }
        for l in (0..count.saturating_sub(1)).rev() {
            let desired: Vec<f64> = lay.layers[l]
                .iter()
                .enumerate()
                .map(|(i, &s)| {
                    mean_of(&lay.below(s, l), &index[l + 1], &centres[l + 1])
                        .unwrap_or(centres[l][i])
                })
                .collect();
            centres[l] = resolve(&desired, &seps[l]);
        }
    }
    let low = lay
        .layers
        .iter()
        .zip(&centres)
        .flat_map(|(layer, c)| layer.iter().zip(c).map(|(&s, &x)| x - cross(s) / 2.0))
        .fold(f64::MAX, f64::min);
    let high = lay
        .layers
        .iter()
        .zip(&centres)
        .flat_map(|(layer, c)| layer.iter().zip(c).map(|(&s, &x)| x + cross(s) / 2.0))
        .fold(f64::MIN, f64::max);
    let (low, high) = if low > high { (0.0, 0.0) } else { (low, high) };
    let flow = |m: f64, c: f64| {
        if horizontal {
            (m, c - low)
        } else {
            (c - low, m)
        }
    };

    let mut pos = vec![(0.0, 0.0); sizes.len()];
    let mut paths: Vec<Vec<(f64, f64)>> = vec![Vec::new(); edges];
    for (l, layer) in lay.layers.iter().enumerate() {
        for (i, &slot) in layer.iter().enumerate() {
            let c = centres[l][i];
            match slot {
                Slot::Node(v) => {
                    let m = main_start[l] + (main_size[l] - main(slot)) / 2.0;
                    let (x, y) = flow(m, c - cross(slot) / 2.0);
                    pos[v] = (x, y);
                }
                Slot::Dummy(e) => paths[e].push(flow(main_start[l] + main_size[l] / 2.0, c)),
            }
        }
    }
    for (e, path) in paths.iter_mut().enumerate() {
        if lay.back.get(e).copied().unwrap_or(false) {
            path.reverse();
        }
    }
    let total_cross = high - low;
    let total = if horizontal {
        (total_main, total_cross)
    } else {
        (total_cross, total_main)
    };
    Placed { pos, total, paths }
}

fn mean_of(
    neighbours: &[Slot],
    index: &std::collections::HashMap<Slot, usize>,
    centres: &[f64],
) -> Option<f64> {
    let found: Vec<f64> = neighbours
        .iter()
        .filter_map(|n| index.get(n))
        .map(|&i| centres[i])
        .collect();
    (!found.is_empty()).then(|| found.iter().sum::<f64>() / found.len() as f64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagrams::layout::layers::{Graph, layer};

    #[test]
    fn pooling_keeps_the_order_and_the_gaps_and_stays_near_what_was_wanted() {
        assert_eq!(resolve(&[0.0, 0.0, 0.0], &[10.0, 10.0]), [-10.0, 0.0, 10.0]);
        assert_eq!(resolve(&[0.0, 100.0], &[10.0]), [0.0, 100.0]);
        let out = resolve(&[50.0, 0.0], &[30.0]);
        // Both want to be as near as they can: 50 and 0 are pulled together to 30 apart.
        assert_eq!(out, [10.0, 40.0]);
    }

    #[test]
    fn a_chain_runs_along_the_flow_and_a_fork_is_centred_on_its_parent() {
        let g = Graph {
            nodes: 3,
            edges: vec![(0, 1), (0, 2)],
        };
        let lay = layer(&g);
        let sizes = [(100.0, 50.0), (100.0, 50.0), (100.0, 50.0)];
        let placed = place(&lay, 2, &sizes, true, 80.0, 40.0, &[0.0, 0.0]);
        assert_eq!(placed.pos[0].0, 0.0);
        assert_eq!(placed.pos[1].0, 180.0);
        // The two children sit above and below the parent's middle.
        let mid = |i: usize| placed.pos[i].1 + 25.0;
        assert!((mid(1) + mid(2)) / 2.0 - mid(0) < 1e-9);
        assert!(mid(2) - mid(1) >= 90.0);
        assert_eq!(placed.total.0, 280.0);
        // Top to bottom swaps the axes.
        let down = place(&lay, 2, &sizes, false, 60.0, 40.0, &[0.0, 0.0]);
        assert_eq!(down.pos[1].1, 110.0);
        assert!(down.pos[1].0 < down.pos[2].0);
    }

    #[test]
    fn a_long_edge_passes_a_stand_in_point_in_the_layer_it_skips() {
        let g = Graph {
            nodes: 3,
            edges: vec![(0, 1), (1, 2), (0, 2)],
        };
        let lay = layer(&g);
        let sizes = [(100.0, 50.0); 3];
        let placed = place(&lay, 3, &sizes, true, 80.0, 40.0, &[0.0; 3]);
        assert_eq!(placed.paths[2].len(), 1);
        assert_eq!(placed.paths[2][0].0, 180.0 + 50.0);
        assert!(placed.paths[0].is_empty() && placed.paths[1].is_empty());
        // The stand-in does not sit on the box in its layer.
        let (_, y) = placed.paths[2][0];
        let b = placed.pos[1].1;
        assert!(y < b || y > b + 50.0, "{y} {b}");
    }
}
