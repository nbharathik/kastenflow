//! The typed diagram tools: an agent describes, looks up shapes, makes a
//! diagram from a spec, Mermaid or a template, edits it with steps, checks it
//! and keeps a picture of it; reviews and previews work as for every other
//! write.

mod common;

use std::sync::Mutex;

use common::{Client, TempDir, vault};
use kasten_core::agent::{ApplyOutcome, Session};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{Writes, call, call_in, specs};
use serde_json::{Value, json};

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("claude-code", Instant::now());
    (v, k, s)
}

const SPEC: &str = r#"{
  "preset": "architecture-light", "direction": "LR",
  "groups": [{"id": "backend", "label": "Backend", "kind": "boundary"}],
  "nodes": [
    {"id": "users", "label": "Users", "kind": "actor"},
    {"id": "web", "label": "Web app", "kind": "client"},
    {"id": "api", "label": "API", "kind": "service", "group": "backend"},
    {"id": "db", "label": "Orders", "kind": "database", "group": "backend"}
  ],
  "edges": [
    {"from": "users", "to": "web"},
    {"from": "web", "to": "api", "label": "HTTPS"},
    {"from": "api", "to": "db", "label": "SQL"}
  ]
}"#;

fn spec() -> Value {
    serde_json::from_str(SPEC).unwrap()
}

#[test]
fn the_seven_tools_are_listed_with_words_that_teach_the_steps() {
    let specs = specs();
    let spec = |name: &str| {
        specs
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("no {name}"))
    };
    for name in [
        "diagram_describe",
        "diagram_find_shapes",
        "diagram_lint",
        "diagram_preview",
        "diagram_new",
        "diagram_edit",
        "diagram_export",
    ] {
        assert!(!spec(name).description.is_empty(), "{name}");
        assert_eq!(spec(name).input_schema["type"], json!("object"), "{name}");
    }
    assert_eq!(
        spec("diagram_edit").input_schema["required"],
        json!(["diagram", "steps"])
    );
    assert_eq!(
        spec("diagram_new").input_schema["required"],
        json!(["title"])
    );
    let edit = &spec("diagram_edit").description;
    for word in [
        "add_node",
        "add_edge",
        "layout",
        "pending_review",
        "page coordinates",
    ] {
        assert!(edit.contains(word), "{word}: {edit}");
    }
    // The kinds the descriptions name are the catalogue's.
    let new = &spec("diagram_new").description;
    for kind in [
        "service", "database", "cache", "queue", "storage", "actor", "client", "gateway",
        "external", "worker", "cloud",
    ] {
        assert!(
            kasten_core::diagrams::presets::node_kind(kind).is_some() && new.contains(kind),
            "{kind}"
        );
    }
    for kind in ["sync", "async", "data", "both", "depends", "line"] {
        assert!(
            kasten_core::diagrams::presets::edge_kind(kind).is_some() && new.contains(kind),
            "{kind}"
        );
    }
    for template in kasten_core::diagrams::spec::templates() {
        assert!(new.contains(template.id), "{}", template.id);
    }
    // The old XML tools stay.
    for name in [
        "create_diagram",
        "update_diagram",
        "get_diagram",
        "trash_diagram",
    ] {
        assert!(specs.iter().any(|s| s.name == name), "{name}");
    }
}

#[test]
fn a_diagram_is_made_from_a_spec_and_told_back_in_page_coordinates() {
    let (v, k, s) = open();
    let made = call(
        &k,
        &s,
        "diagram_new",
        json!({"title": "Shop", "project": "photo-organiser", "spec": spec()}),
    )
    .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    let path = made["result"]["path"].as_str().unwrap().to_owned();
    assert_eq!(path, "projects/photo-organiser/diagrams/Shop.drawio");
    assert_eq!(made["result"]["preset"], json!("architecture-light"));
    assert_eq!(
        made["result"]["lint"]["errors"],
        json!(0),
        "{}",
        made["result"]["lint"]
    );
    assert!(
        made["result"]["ids"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i == "api")
    );
    assert!(
        std::fs::read_to_string(v.0.join(&path))
            .unwrap()
            .contains("id=\"backend\"")
    );
    // One commit, in the agent's session.
    assert_eq!(k.log(None, 1).unwrap()[0].summary, "diagram: create Shop");

    let d = call(&k, &s, "diagram_describe", json!({"diagram": "Shop"})).unwrap();
    assert_eq!(d["path"], json!(path));
    let api = d["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "api")
        .unwrap();
    assert_eq!(
        (
            api["kind"].as_str(),
            api["group"].as_str(),
            api["w"].as_f64()
        ),
        (Some("service"), Some("backend"), Some(120.0))
    );
    assert_eq!(d["groups"][0]["members"], json!(["api", "db"]));
    assert!(
        d["text"]
            .as_str()
            .unwrap()
            .contains("web → api “HTTPS” [sync]"),
        "{}",
        d["text"]
    );
    assert!(d["free"]["right"][0].as_f64().unwrap() > 400.0);
    assert_eq!(d["lint"]["errors"], json!(0));
    assert_eq!(d["preview"], json!("draft"));
    assert_eq!(made["result"]["picture"], json!("draft"));
}

#[test]
fn a_draft_picture_is_given_as_svg_text_and_kept_in_assets_on_request() {
    let (v, k, s) = open();
    call(
        &k,
        &s,
        "diagram_new",
        json!({"title": "Shop", "spec": spec()}),
    )
    .unwrap();
    let p = call(&k, &s, "diagram_preview", json!({"diagram": "Shop"})).unwrap();
    assert_eq!(p["picture"], json!("draft"));
    let svg = p["svg"].as_str().unwrap();
    assert!(
        svg.starts_with("<svg ")
            && svg.contains(">Web app</text>")
            && !svg.contains("foreignObject"),
        "{}",
        &svg[..200.min(svg.len())]
    );
    assert!(p["note"].as_str().unwrap().contains("draft"));
    // The picture of a page that does not exist, and of a diagram that has nothing to draw, say so.
    assert!(
        call(
            &k,
            &s,
            "diagram_preview",
            json!({"diagram": "Shop", "page": "Nope"})
        )
        .unwrap_err()
        .contains("cannot be drawn")
    );
    call(
        &k,
        &s,
        "diagram_new",
        json!({"title": "Empty", "spec": {"nodes": []}}),
    )
    .unwrap();
    assert!(
        call(&k, &s, "diagram_preview", json!({"diagram": "Empty"}))
            .unwrap_err()
            .contains("nothing to draw")
    );
    // Exported, it is a file of the vault that a note can show.
    let kept = call(
        &k,
        &s,
        "diagram_export",
        json!({"diagram": "Shop", "format": "svg"}),
    )
    .unwrap();
    let path = kept["path"].as_str().unwrap();
    assert!(
        path.starts_with("assets/") && path.ends_with(".svg"),
        "{path}"
    );
    assert_eq!(kept["from"], json!("draft"));
    assert_eq!(kept["use"], json!(format!("![]({path})")));
    assert!(
        std::fs::read_to_string(v.0.join(path))
            .unwrap()
            .contains(">Web app</text>")
    );
    assert!(
        call(
            &k,
            &s,
            "diagram_export",
            json!({"diagram": "Shop", "format": "png"})
        )
        .unwrap_err()
        .contains("PNG")
    );
    assert!(
        call(
            &k,
            &s,
            "diagram_export",
            json!({"diagram": "Shop", "format": "pdf"})
        )
        .unwrap_err()
        .contains("svg and png")
    );
    // In a chat that previews, a picture the vault does not hold yet is staged with the rest
    // (one it holds already is just pointed at).
    call(
        &k,
        &s,
        "diagram_edit",
        json!({"diagram": "Shop", "steps": [{"op": "update", "id": "web", "label": "Browser"}]}),
    )
    .unwrap();
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    let staged = call_in(
        &k,
        &s,
        Writes::Staged(&set),
        "diagram_export",
        json!({"diagram": "Shop", "format": "svg"}),
    )
    .unwrap();
    assert_eq!(staged["staged"], json!(true));
    assert_eq!(set.lock().unwrap().assets.len(), 1);
}

#[test]
fn mermaid_and_templates_make_diagrams_and_mistakes_are_explained() {
    let (_v, k, s) = open();
    let m = call(&k, &s, "diagram_new", json!({"title": "Flow", "mermaid": "graph TD\nA[Start] --> B{Ok?}\nB -->|yes| C[Done]\nclassDef x fill:#fff"})).unwrap();
    assert_eq!(m["status"], json!("done"), "{m}");
    assert_eq!(m["result"]["preset"], json!("flowchart"));
    assert!(
        m["result"]["ignored"][0]
            .as_str()
            .unwrap()
            .contains("Styling"),
        "{m}"
    );
    let t = call(
        &k,
        &s,
        "diagram_new",
        json!({"title": "Pipeline", "template": "data-pipeline"}),
    )
    .unwrap();
    assert_eq!(t["status"], json!("done"), "{t}");
    for (args, why) in [
        (
            json!({"title": "X"}),
            "exactly one of spec, mermaid or template",
        ),
        (
            json!({"title": "X", "spec": {}, "mermaid": "graph LR"}),
            "exactly one",
        ),
        (
            json!({"title": "X", "template": "nope"}),
            "the templates are",
        ),
        (
            json!({"title": "X", "mermaid": "sequenceDiagram\nA->>B: hi"}),
            "Only Mermaid flowcharts",
        ),
        (
            json!({"title": "X", "spec": {"nodes": [{"id": "a", "kind": "unicorn"}]}}),
            "No node kind",
        ),
        (json!({"title": "X", "spec": {"nodez": []}}), "not one"),
        (json!({"title": "A|B", "template": "ci-cd"}), "title"),
    ] {
        let message = call(&k, &s, "diagram_new", args.clone()).unwrap_err();
        assert!(message.contains(why), "{args}: {message}");
    }
    assert_eq!(k.diagrams().unwrap().len(), 2);
}

#[test]
fn steps_change_the_diagram_and_the_answer_says_what_was_made_and_what_is_wrong() {
    let (v, k, s) = open();
    call(
        &k,
        &s,
        "diagram_new",
        json!({"title": "Shop", "spec": spec()}),
    )
    .unwrap();
    let edited = call(
        &k,
        &s,
        "diagram_edit",
        json!({"diagram": "Shop", "steps": [
            {"op": "add_node", "id": "cache", "label": "Cache", "kind": "cache", "near": "api", "side": "below"},
            {"op": "add_edge", "from": "api", "to": "cache", "label": "get", "kind": "async"},
            {"op": "restyle", "ids": ["web"], "token": "purple"},
        ]}),
    )
    .unwrap();
    assert_eq!(edited["status"], json!("done"), "{edited}");
    let result = &edited["result"];
    assert_eq!(
        (result["status"].as_str(), result["ids"].clone()),
        (Some("saved"), json!(["cache", "e-api-cache"]))
    );
    assert_eq!(result["lint"]["errors"], json!(0));
    assert!(result["hash"].as_str().unwrap().len() >= 8);
    let path = result["path"].as_str().unwrap();
    let xml = std::fs::read_to_string(v.0.join(path)).unwrap();
    assert!(xml.contains("id=\"cache\"") && xml.contains("fillColor=#e1d5e7"));
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "diagram: edit Shop — add 1 node, 1 link, restyle 1 item"
    );
    // A step that cannot be made says which and why; a step that is not a step says so.
    let bad = call(
        &k,
        &s,
        "diagram_edit",
        json!({"diagram": "Shop", "steps": [{"op": "add_edge", "from": "api", "to": "ghost"}]}),
    )
    .unwrap_err();
    assert!(
        bad.starts_with("Step 1 (add_edge)") && bad.contains("ghost"),
        "{bad}"
    );
    let notstep = call(
        &k,
        &s,
        "diagram_edit",
        json!({"diagram": "Shop", "steps": [{"op": "teleport"}]}),
    )
    .unwrap_err();
    assert!(notstep.contains("Step 1 is not a step"), "{notstep}");
    assert!(
        call(
            &k,
            &s,
            "diagram_edit",
            json!({"diagram": "Shop", "steps": []})
        )
        .unwrap_err()
        .contains("at least one step")
    );
    // A lint finding the edit caused comes back with it: two boxes put on each other.
    let piled = call(
        &k,
        &s,
        "diagram_edit",
        json!({"diagram": "Shop", "steps": [
            {"op": "add_node", "id": "p1", "label": "P1", "x": 900, "y": 900},
            {"op": "add_node", "id": "p2", "label": "P2", "x": 910, "y": 910},
        ]}),
    )
    .unwrap();
    let issues = piled["result"]["lint"]["issues"].as_array().unwrap();
    assert!(
        issues
            .iter()
            .any(|i| i["rule"] == "overlap" && i["cell"] == "p1"),
        "{issues:?}"
    );
    // And the check on its own, and the layout that clears it.
    let lint = call(&k, &s, "diagram_lint", json!({"diagram": "Shop"})).unwrap();
    assert!(lint["warnings"].as_u64().unwrap() >= 1);
}

#[test]
fn shapes_are_looked_up_by_name_and_used_by_key() {
    let (_v, k, s) = open();
    let found = call(&k, &s, "diagram_find_shapes", json!({"query": "lambda"})).unwrap();
    assert_eq!(found["shapes"][0]["key"], json!("aws4.lambda"));
    assert!(
        found["shapes"][0]["style"]
            .as_str()
            .unwrap()
            .contains("resIcon=mxgraph.aws4.lambda")
    );
    let templates = call(&k, &s, "diagram_find_shapes", json!({"query": "network"})).unwrap();
    assert!(
        templates["templates"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["id"] == "network")
    );
    let all = call(&k, &s, "diagram_find_shapes", json!({})).unwrap();
    assert!(
        all["libraries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|l| l["name"] == "azure2")
    );
    assert!(
        call(&k, &s, "diagram_find_shapes", json!({"query": "zzzzqqqq"})).unwrap()["note"]
            .as_str()
            .unwrap()
            .contains("No shape matches")
    );
    call(&k, &s, "diagram_new", json!({"title": "Cloud", "spec": {"nodes": [{"id": "fn", "label": "Handler", "shape": "aws4.lambda"}, {"id": "q", "label": "Jobs", "kind": "aws-queue"}], "edges": [{"from": "q", "to": "fn"}]}})).unwrap();
    let edited = call(&k, &s, "diagram_edit", json!({"diagram": "Cloud", "steps": [{"op": "add_node", "id": "db", "label": "Orders", "shape": "aws4.dynamodb", "near": "fn"}]})).unwrap();
    assert_eq!(edited["status"], json!("done"), "{edited}");
    let xml = k
        .diagram(edited["result"]["path"].as_str().unwrap())
        .unwrap()
        .xml;
    assert!(xml.contains("resIcon=mxgraph.aws4.dynamodb"), "{xml}");
}

#[test]
fn an_edit_that_takes_out_or_moves_most_of_the_diagram_waits_for_review_and_is_made_on_what_is_there_then()
 {
    let (v, k, s) = open();
    call(
        &k,
        &s,
        "diagram_new",
        json!({"title": "Shop", "spec": spec()}),
    )
    .unwrap();
    let waiting = call(&k, &s, "diagram_edit", json!({"diagram": "Shop", "steps": [{"op": "delete", "ids": ["api", "db", "web"]}], "reason": "Simplify"})).unwrap();
    assert_eq!(waiting["status"], json!("pending_review"), "{waiting}");
    assert!(waiting["reason"].as_str().unwrap().contains("elements out"));
    let path = "library/Shop.drawio";
    assert!(
        std::fs::read_to_string(v.0.join(path))
            .unwrap()
            .contains("id=\"api\"")
    );
    // A person adds a box while it waits; accepting makes the steps on that, without a conflict copy.
    let read = k.diagram(path).unwrap();
    let steps: Vec<kasten_core::diagrams::steps::Step> = serde_json::from_value(
        json!([{"op": "add_node", "id": "mine", "label": "Mine", "x": 700, "y": 400}]),
    )
    .unwrap();
    let theirs = kasten_core::diagrams::steps::replay(&read.xml, None, None, &steps).unwrap();
    k.save_diagram(
        &Actor::Human,
        path,
        &theirs.xml,
        None,
        &read.hash,
        Instant::now(),
    )
    .unwrap();
    k.commit_edits().unwrap();
    let id = waiting["proposal"].as_str().unwrap();
    let accepted = k.accept_proposal(id, "me", Instant::now()).unwrap();
    assert_eq!(accepted["status"], json!("saved"), "{accepted}");
    let now = k.diagram(path).unwrap().xml;
    assert!(now.contains("id=\"mine\"") && !now.contains("id=\"api\""));
}

#[test]
fn a_chat_that_previews_stages_the_tools_and_reads_them_back() {
    let (_v, k, s) = open();
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    let staged = |name: &str, args: Value| call_in(&k, &s, Writes::Staged(&set), name, args);
    let made = staged("diagram_new", json!({"title": "Shop", "spec": spec()})).unwrap();
    assert_eq!(made["status"], json!("staged"), "{made}");
    let path = made["result"]["path"].as_str().unwrap().to_owned();
    assert!(k.diagram(&path).is_err(), "nothing is in the vault yet");
    // Reads see the staged diagram, and so does the next edit.
    let d = staged("diagram_describe", json!({"diagram": "Shop"})).unwrap();
    assert_eq!(d["nodes"].as_array().unwrap().len(), 4);
    let edited = staged("diagram_edit", json!({"diagram": "Shop", "steps": [{"op": "add_node", "id": "cache", "label": "Cache", "kind": "cache", "near": "api"}]})).unwrap();
    assert_eq!(edited["status"], json!("staged"), "{edited}");
    assert!(
        edited["note"]
            .as_str()
            .unwrap()
            .contains("Nothing was written")
    );
    assert_eq!(
        staged("diagram_lint", json!({"diagram": "Shop"})).unwrap()["errors"],
        json!(0)
    );
    assert_eq!(
        staged("diagram_describe", json!({"diagram": "Shop"})).unwrap()["nodes"]
            .as_array()
            .unwrap()
            .len(),
        5
    );
    let set_now = set.lock().unwrap().clone();
    assert!(matches!(
        k.apply_changes(&set_now, "Ada", Instant::now()).unwrap(),
        ApplyOutcome::Applied { .. }
    ));
    assert!(k.diagram(&path).unwrap().xml.contains("id=\"cache\""));
}

#[test]
fn an_external_client_makes_edits_checks_and_keeps_a_diagram_over_stdio() {
    let v = vault();
    let mut c = Client::start(&v.0, "claude-code");
    assert!(
        c.instructions.contains("diagram_new") && c.instructions.contains("diagram_edit"),
        "{}",
        c.instructions
    );
    // The conventions and the catalogue the skill is written from are what the server says.
    assert!(
        c.instructions
            .contains(&kasten_core::diagrams::presets::instructions())
    );
    let tools = c.tools();
    for name in [
        "diagram_describe",
        "diagram_find_shapes",
        "diagram_lint",
        "diagram_preview",
        "diagram_new",
        "diagram_edit",
        "diagram_export",
    ] {
        assert!(tools.contains(&name.to_owned()), "{name}");
    }
    let made = c
        .call("diagram_new", json!({"title": "Shop", "spec": spec()}))
        .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    let edited = c
        .call("diagram_edit", json!({"diagram": "Shop", "steps": [
            {"op": "add_node", "id": "cache", "label": "Cache", "kind": "cache", "near": "api", "side": "below"},
            {"op": "add_edge", "from": "api", "to": "cache", "kind": "async"},
            {"op": "restyle", "ids": ["cache"], "token": "orange"},
        ]}))
        .unwrap();
    assert_eq!(edited["result"]["status"], json!("saved"), "{edited}");
    let lint = c.call("diagram_lint", json!({"diagram": "Shop"})).unwrap();
    assert_eq!(lint["errors"], json!(0), "{lint}");
    let d = c
        .call("diagram_describe", json!({"diagram": "Shop"}))
        .unwrap();
    assert_eq!(d["nodes"].as_array().unwrap().len(), 5);
    // A person's edit, made while the client is connected, is there for the client's next read and survives its next edit.
    let k = Kasten::open(&v.0).unwrap();
    let read = k.diagram("library/Shop.drawio").unwrap();
    let steps: Vec<kasten_core::diagrams::steps::Step> = serde_json::from_value(
        json!([{"op": "add_node", "id": "mine", "label": "Mine", "x": 900, "y": 40}]),
    )
    .unwrap();
    let theirs = kasten_core::diagrams::steps::replay(&read.xml, None, None, &steps).unwrap();
    k.save_diagram(
        &Actor::Human,
        "library/Shop.drawio",
        &theirs.xml,
        None,
        &read.hash,
        Instant::now(),
    )
    .unwrap();
    k.commit_edits().unwrap();
    let after = c.call("diagram_edit", json!({"diagram": "Shop", "steps": [{"op": "update", "id": "api", "label": "Orders API"}]})).unwrap();
    assert_eq!(after["result"]["status"], json!("saved"), "{after}");
    let xml = k.diagram("library/Shop.drawio").unwrap().xml;
    assert!(
        xml.contains("id=\"mine\"") && xml.contains("Orders API") && xml.contains("id=\"cache\"")
    );
}
