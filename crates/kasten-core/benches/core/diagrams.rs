//! Diagrams at the sizes agents draw: a described diagram made and laid out,
//! laid out from nothing, checked, and drawn as a draft picture. Budgets:
//! laying out 100 nodes takes under 20 ms and 300 nodes under 100 ms.

use criterion::Criterion;
use kasten_core::diagrams::draw::draft;
use kasten_core::diagrams::lint::lint;
use kasten_core::diagrams::spec::{Input, Spec, SpecEdge, SpecGroup, SpecNode, build};
use kasten_core::diagrams::steps::{Step, replay};

/// `n` nodes in groups of ten, each linked to the next and every third to a
/// node far off (so there are cycles, long edges and edges between groups).
fn links(n: usize) -> Vec<(usize, usize)> {
    let mut links: Vec<(usize, usize)> = (0..n - 1).map(|i| (i, i + 1)).collect();
    links.extend(
        (0..n)
            .step_by(3)
            .map(|i| (i, (i * 7 + 3) % n))
            .filter(|(from, to)| from != to),
    );
    links
}

/// A spec of `n` nodes (a spec may hold 500 parts in all, so `n` is at most 150).
fn spec(n: usize) -> Spec {
    let node = |i: usize| SpecNode {
        id: format!("n{i}"),
        label: format!("Service {i}"),
        kind: Some(
            if i.is_multiple_of(7) {
                "database"
            } else {
                "service"
            }
            .into(),
        ),
        shape: None,
        group: Some(format!("g{}", i / 10)),
        x: None,
        y: None,
        set: None,
    };
    let edge = |(from, to): (usize, usize)| SpecEdge {
        from: format!("n{from}"),
        to: format!("n{to}"),
        label: from.is_multiple_of(5).then(|| "calls".into()),
        kind: None,
        set: None,
    };
    Spec {
        title: Some("Benchmark".into()),
        groups: (0..n.div_ceil(10))
            .map(|g| SpecGroup {
                id: format!("g{g}"),
                label: format!("Group {g}"),
                kind: None,
                group: None,
            })
            .collect(),
        nodes: (0..n).map(node).collect(),
        edges: links(n).into_iter().map(edge).collect(),
        ..Spec::default()
    }
}

/// The file of a diagram of `n` nodes in groups of ten with every box on the
/// same spot, as an agent's or a person's untidy draft would be.
fn untidy(n: usize) -> String {
    let mut cells = String::new();
    for g in 0..n.div_ceil(10) {
        cells.push_str(&format!(
            "<mxCell id=\"g{g}\" value=\"Group {g}\" style=\"swimlane;startSize=30;\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"0\" y=\"0\" width=\"200\" height=\"100\" as=\"geometry\"/></mxCell>\n"
        ));
    }
    for i in 0..n {
        cells.push_str(&format!(
            "<mxCell id=\"n{i}\" value=\"Service {i}\" style=\"rounded=1;whiteSpace=wrap;html=1;\" vertex=\"1\" parent=\"g{}\"><mxGeometry x=\"10\" y=\"40\" width=\"120\" height=\"60\" as=\"geometry\"/></mxCell>\n",
            i / 10
        ));
    }
    for (k, (from, to)) in links(n).into_iter().enumerate() {
        cells.push_str(&format!(
            "<mxCell id=\"e{k}\" style=\"edgeStyle=orthogonalEdgeStyle;html=1;\" edge=\"1\" parent=\"1\" source=\"n{from}\" target=\"n{to}\"><mxGeometry relative=\"1\" as=\"geometry\"/></mxCell>\n"
        ));
    }
    format!(
        "<mxfile>\n<diagram id=\"d\" name=\"Page-1\">\n<mxGraphModel pageWidth=\"850\" pageHeight=\"1100\">\n<root>\n<mxCell id=\"0\"/>\n<mxCell id=\"1\" parent=\"0\"/>\n{cells}</root>\n</mxGraphModel>\n</diagram>\n</mxfile>\n"
    )
}

pub fn group(c: &mut Criterion) {
    let mut group = c.benchmark_group("diagrams");
    group.sample_size(20);
    let spec = spec(100);
    group.bench_function("make and lay out 100 nodes from a spec", |b| {
        b.iter(|| build(Input::Spec(spec.clone()), "Benchmark").unwrap())
    });
    let layout = [Step::Layout {
        scope: None,
        direction: None,
        spacing: None,
    }];
    for n in [100, 300] {
        let untidy = untidy(n);
        let tidy = replay(&untidy, None, None, &layout).unwrap().xml;
        group.bench_function(format!("lay out {n} nodes"), |b| {
            b.iter(|| replay(&untidy, None, None, &layout).unwrap())
        });
        group.bench_function(format!("lay out {n} laid-out nodes again"), |b| {
            b.iter(|| replay(&tidy, None, None, &layout).unwrap())
        });
        group.bench_function(format!("lint {n} nodes"), |b| {
            b.iter(|| lint(&tidy, None).unwrap())
        });
        group.bench_function(format!("draw a draft of {n} nodes"), |b| {
            b.iter(|| draft(&tidy, None).unwrap())
        });
    }
    group.finish();
}
