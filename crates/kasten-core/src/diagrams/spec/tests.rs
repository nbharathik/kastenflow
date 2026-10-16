//! Diagrams from descriptions: the JSON spec, Mermaid and the templates.

use super::*;
use crate::diagrams::lint::lint;
use crate::diagrams::model::Doc;

fn spec(text: &str) -> Spec {
    serde_json::from_str(text).unwrap()
}

fn page(xml: &str) -> crate::diagrams::model::Page {
    Doc::parse(xml).unwrap().pages.swap_remove(0)
}

fn mermaid(text: &str) -> Parsed {
    parse_mermaid(text).unwrap()
}

fn err(input: Input) -> String {
    build(input, "T").unwrap_err().to_string()
}

#[test]
fn a_json_spec_becomes_a_diagram_that_is_laid_out_titled_and_fitted_to_its_page() {
    let mut s = spec(example());
    s.title = Some("Orders".into());
    let built = build(Input::Spec(s), "Orders").unwrap();
    let p = page(&built.xml);
    assert_eq!(built.preset, "architecture-light");
    assert_eq!(
        (
            p.get("api").unwrap().parent.as_deref(),
            p.get("web").unwrap().parent.as_deref()
        ),
        (Some("backend"), Some("1"))
    );
    assert_eq!(p.get("db").unwrap().style.get("shape"), Some("cylinder3"));
    // Left to right: the client, then the backend group holding the API and the store.
    let (web, backend) = (p.abs("web").unwrap(), p.abs("backend").unwrap());
    assert!(web.right() < backend.x);
    assert!(backend.contains(&p.abs("api").unwrap()) && backend.contains(&p.abs("db").unwrap()));
    // A heading above everything, and a page that fits what is drawn.
    let title = p.get("diagram-title").unwrap();
    assert_eq!(title.text(), "Orders");
    assert!(p.abs("diagram-title").unwrap().bottom() <= backend.y.min(web.y));
    let right = p
        .vertices()
        .filter_map(|c| p.abs(&c.id))
        .map(|r| r.right())
        .fold(0.0, f64::max);
    assert!(
        p.width.unwrap() >= right + 40.0 && p.width.unwrap() < right + 60.0,
        "{:?} {right}",
        p.width
    );
    // The edges came out with their words and pass the lint.
    assert_eq!(p.get("e-web-api").unwrap().text(), "HTTPS");
    let report = lint(&built.xml, None).unwrap();
    assert_eq!(report.errors, 0, "{:?}", report.issues);
    assert!(built.applied.ids.contains(&"web".to_owned()) && built.ignored.is_empty());
}

#[test]
fn a_long_pipeline_is_drawn_on_a_page_as_wide_as_it_is() {
    let n = 90;
    let nodes: Vec<String> = (0..n)
        .map(|i| format!(r#"{{"id":"s{i}","label":"Step {i}"}}"#))
        .collect();
    let edges: Vec<String> = (1..n)
        .map(|i| format!(r#"{{"from":"s{}","to":"s{i}"}}"#, i - 1))
        .collect();
    let text = format!(
        r#"{{"direction":"LR","nodes":[{}],"edges":[{}]}}"#,
        nodes.join(","),
        edges.join(",")
    );
    let built = build(Input::Spec(spec(&text)), "Pipeline").unwrap();
    let p = page(&built.xml);
    let right = p
        .vertices()
        .filter_map(|c| p.abs(&c.id))
        .map(|r| r.right())
        .fold(0.0, f64::max);
    assert!(right > 5000.0, "{right}");
    assert!(p.width.unwrap() >= right + 40.0, "{:?} {right}", p.width);
}

#[test]
fn a_spec_without_layout_keeps_the_places_it_gives() {
    let s = spec(
        r#"{"layout":false,"nodes":[{"id":"a","label":"A","x":100,"y":200},{"id":"b","label":"B","x":400,"y":200}],"edges":[{"from":"a","to":"b"}]}"#,
    );
    let p = page(&build(Input::Spec(s), "T").unwrap().xml);
    assert_eq!(
        (p.abs("a").unwrap().x, p.abs("b").unwrap().y),
        (100.0, 200.0)
    );
    // Without places it still puts boxes where there is room, in the order given.
    let s = spec(r#"{"layout":false,"nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}"#);
    let p = page(&build(Input::Spec(s), "T").unwrap().xml);
    assert!(!p.abs("a").unwrap().overlaps(&p.abs("b").unwrap(), 0.0));
    assert!(err(Input::Spec(spec(r#"{"nodes":[{"id":"a","x":5}]}"#))).contains("both x and y"));
}

#[test]
fn nested_groups_are_made_from_the_inside_out() {
    let s = spec(
        r#"{"groups":[{"id":"cloud","label":"Cloud","kind":"boundary"},{"id":"vpc","label":"VPC","kind":"container","group":"cloud"}],
        "nodes":[{"id":"a","label":"A","group":"vpc"},{"id":"b","label":"B","group":"vpc"},{"id":"c","label":"C","group":"cloud"},{"id":"u","label":"User","kind":"actor"}],
        "edges":[{"from":"u","to":"a"},{"from":"a","to":"b"},{"from":"b","to":"c"}]}"#,
    );
    let p = page(&build(Input::Spec(s), "T").unwrap().xml);
    assert_eq!(p.get("a").unwrap().parent.as_deref(), Some("vpc"));
    assert_eq!(p.get("vpc").unwrap().parent.as_deref(), Some("cloud"));
    assert_eq!(p.get("c").unwrap().parent.as_deref(), Some("cloud"));
    assert!(p.abs("cloud").unwrap().contains(&p.abs("vpc").unwrap()));
    assert!(p.abs("vpc").unwrap().contains(&p.abs("b").unwrap()));
}

#[test]
fn a_spec_that_cannot_be_drawn_says_why() {
    for (text, why) in [
        (r#"{"nodes":[{"id":"a"},{"id":"a"}]}"#, "used twice"),
        (r#"{"nodes":[{"id":"a","group":"nope"}]}"#, "does not have"),
        (
            r#"{"groups":[{"id":"g"}],"nodes":[{"id":"a"}]}"#,
            "holds nothing",
        ),
        (
            r#"{"groups":[{"id":"g","group":"h"},{"id":"h","group":"g"}],"nodes":[]}"#,
            "hold each other",
        ),
        (r#"{"preset":"neon","nodes":[]}"#, "No preset called"),
        (r#"{"direction":"sideways","nodes":[]}"#, "LR or TB"),
        (
            r#"{"nodes":[{"id":"a"}],"edges":[{"from":"a","to":"ghost"}]}"#,
            "ghost",
        ),
        (r#"{"nodes":[{"id":"a","kind":"unicorn"}]}"#, "No node kind"),
        (
            r#"{"nodes":[{"id":"a","shape":"aws4.lambda"}],"edges":[]}"#,
            "",
        ),
    ] {
        let result = build(Input::Spec(spec(text)), "T");
        match (result, why) {
            (Ok(_), "") => {}
            (Err(e), why) => assert!(
                e.to_string().contains(why) && !why.is_empty(),
                "{text}: {e}"
            ),
            (Ok(_), _) => panic!("{text} should be refused"),
        }
    }
    assert!(serde_json::from_str::<Spec>(r#"{"nodez":[]}"#).is_err());
    let many = Spec {
        nodes: (0..501)
            .map(|i| SpecNode {
                id: format!("n{i}"),
                label: String::new(),
                kind: None,
                shape: None,
                group: None,
                x: None,
                y: None,
                set: None,
            })
            .collect(),
        ..Spec::default()
    };
    assert!(err(Input::Spec(many)).contains("at most 500"));
}

#[test]
fn a_node_may_be_a_shape_of_the_libraries() {
    let s = spec(
        r#"{"nodes":[{"id":"fn","label":"Handler","shape":"aws4.lambda"},{"id":"q","label":"Jobs","kind":"queue"}],"edges":[{"from":"q","to":"fn"}]}"#,
    );
    let p = page(&build(Input::Spec(s), "T").unwrap().xml);
    assert!(
        p.get("fn")
            .unwrap()
            .style
            .get("resIcon")
            .is_some_and(|r| r.ends_with("lambda"))
    );
}

#[test]
fn mermaid_flowcharts_become_specs_with_their_shapes_and_arrows() {
    let parsed = mermaid(
        "graph LR\n  A[Start] --> B{Ready?}\n  B -->|yes| C([Go])\n  B -- no --> D[(Wait)]\n  C -.-> E((Done)) ==> F[[Sub]]\n  %% a comment\n  G & H --> I\n",
    );
    let s = &parsed.spec;
    assert_eq!(s.direction.as_deref(), Some("LR"));
    let kind = |id: &str| {
        s.nodes
            .iter()
            .find(|n| n.id == id)
            .and_then(|n| n.kind.clone())
            .unwrap()
    };
    assert_eq!(
        ["A", "B", "C", "D", "E", "F"].map(kind),
        [
            "process",
            "decision",
            "terminator",
            "database",
            "connector",
            "subprocess"
        ]
    );
    assert_eq!(s.nodes.iter().find(|n| n.id == "A").unwrap().label, "Start");
    assert_eq!(s.nodes.iter().find(|n| n.id == "G").unwrap().label, "G");
    let edge = |a: &str, b: &str| {
        s.edges
            .iter()
            .find(|e| e.from == a && e.to == b)
            .unwrap_or_else(|| panic!("{a}-{b}"))
    };
    assert_eq!(edge("B", "C").label.as_deref(), Some("yes"));
    assert_eq!(edge("B", "D").label.as_deref(), Some("no"));
    assert_eq!(edge("C", "E").kind.as_deref(), Some("async"));
    assert_eq!(edge("E", "F").set.as_ref().unwrap()["strokeWidth"], "3");
    assert_eq!(
        (
            edge("G", "I").kind.as_deref(),
            edge("H", "I").kind.as_deref()
        ),
        (Some("flow"), Some("flow"))
    );
    assert!(parsed.ignored.is_empty());
    assert_eq!(s.preset.as_deref(), Some("flowchart"));
    // And it draws.
    let p = page(
        &build(
            Input::Mermaid("graph TD\nA[Start] --> B{Ok?}\nB -->|yes| C[Done]\nB -->|no| A".into()),
            "T",
        )
        .unwrap()
        .xml,
    );
    assert_eq!(p.count(), 6);
    assert_eq!(p.get("B").unwrap().style.bare(), Some("rhombus"));
}

#[test]
fn mermaid_subgraphs_become_groups_and_styling_is_left_out_and_said() {
    let parsed = mermaid(
        "flowchart TB\nsubgraph one [Front end]\n  A[Web] --> B[Api]\nend\nsubgraph \"Back end\"\n  C[(Db)]\nend\nB --> C\none --> D:::hot\nclassDef hot fill:#f00\nstyle A fill:#fff\nclick A callback\nlinkStyle 0 stroke:red\n",
    );
    let s = &parsed.spec;
    assert_eq!(
        s.groups
            .iter()
            .map(|g| (g.id.as_str(), g.label.as_str()))
            .collect::<Vec<_>>(),
        [("one", "Front end"), ("Back-end", "Back end")]
    );
    assert_eq!(
        s.nodes
            .iter()
            .find(|n| n.id == "A")
            .unwrap()
            .group
            .as_deref(),
        Some("one")
    );
    assert_eq!(
        s.nodes
            .iter()
            .find(|n| n.id == "C")
            .unwrap()
            .group
            .as_deref(),
        Some("Back-end")
    );
    assert!(
        s.nodes
            .iter()
            .find(|n| n.id == "D")
            .unwrap()
            .group
            .is_none()
    );
    // An arrow from the subgraph itself joins the group, not a node of the same name.
    assert!(
        s.nodes.iter().all(|n| n.id != "one")
            && s.edges.iter().any(|e| e.from == "one" && e.to == "D")
    );
    assert_eq!(parsed.ignored.len(), 5, "{:?}", parsed.ignored);
    let built = build(
        Input::Mermaid(
            "flowchart TB\nsubgraph g [Group]\nA --> B\nend\nclassDef x fill:#fff".into(),
        ),
        "T",
    )
    .unwrap();
    assert_eq!(built.ignored.len(), 1);
    assert_eq!(
        page(&built.xml).get("A").unwrap().parent.as_deref(),
        Some("g")
    );
}

#[test]
fn mermaid_that_is_not_a_flowchart_or_is_broken_is_refused_with_a_pointer() {
    for (text, why) in [
        ("sequenceDiagram\nA->>B: hi", "Only Mermaid flowcharts"),
        ("A --> B", "Start the text with graph"),
        ("graph LR\nsubgraph g\nA --> B", "never closed"),
        ("graph LR\nA => B", "Expected an arrow"),
        ("graph LR\nA[Open --> B", "not closed"),
        ("graph LR\n--> B", "Expected a node name"),
    ] {
        let message = parse_mermaid(text).err().unwrap().to_string();
        assert!(message.contains(why), "{text}: {message}");
    }
    let bt = mermaid("graph RL\nA --> B");
    assert_eq!(bt.spec.direction.as_deref(), Some("LR"));
    assert_eq!(bt.ignored.len(), 1);
}

#[test]
fn every_template_builds_a_diagram_with_no_errors_and_no_boxes_on_each_other() {
    for t in templates() {
        let built = build(Input::Template(t.id.to_owned()), t.title)
            .unwrap_or_else(|e| panic!("{}: {e}", t.id));
        let report = lint(&built.xml, None).unwrap();
        let bad: Vec<_> = report
            .issues
            .iter()
            .filter(|i| i.severity == crate::diagrams::lint::Severity::Error || i.rule == "overlap")
            .collect();
        assert!(bad.is_empty(), "{}: {bad:?}", t.id);
        let p = page(&built.xml);
        assert!(p.count() >= 6, "{}: {} cells", t.id, p.count());
        assert_eq!(p.get("diagram-title").unwrap().text(), t.title);
        // Laid out on the grid unless the template places its own boxes.
        if t.id != "sequence" {
            let boxes = p
                .vertices()
                .filter(|c| c.parent.as_deref() == Some("1") && c.id != "diagram-title");
            assert!(
                boxes
                    .filter_map(|c| p.abs(&c.id))
                    .all(|r| r.x % 10.0 == 0.0 && r.y % 10.0 == 0.0),
                "{}",
                t.id
            );
        }
    }
    assert!(err(Input::Template("nope".into())).contains("the templates are"));
    assert_eq!(templates().len(), 10);
}

#[test]
fn the_c4_templates_are_made_of_c4_objects_and_the_er_template_of_tables() {
    let p = page(
        &build(Input::Template("c4-container".into()), "Shop")
            .unwrap()
            .xml,
    );
    assert_eq!(p.get("api").unwrap().wrapper.as_deref(), Some("object"));
    assert_eq!(p.get("api").unwrap().attr("c4Technology"), Some("Rust"));
    assert_eq!(p.get("api").unwrap().parent.as_deref(), Some("shop"));
    let p = page(&build(Input::Template("er".into()), "Shop").unwrap().xml);
    assert_eq!(
        p.get("customer").unwrap().style.get("childLayout"),
        Some("stackLayout")
    );
    assert_eq!(p.children_of("order").count(), 3);
    let seq = page(
        &build(Input::Template("sequence".into()), "Login")
            .unwrap()
            .xml,
    );
    assert_eq!(
        seq.get("e-user-web").unwrap().style.get("exitY"),
        Some("0.15")
    );
    assert_eq!(
        seq.get("e-db-api").unwrap().style.get("exitY"),
        Some("0.54")
    );
}
