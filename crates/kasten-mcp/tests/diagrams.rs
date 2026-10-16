//! The diagram tools: an agent lists, reads, makes and rewrites diagrams as
//! draw.io XML; a rewrite that takes a lot out and a trashed diagram wait for
//! the user; a request that is not a diagram is refused with words that say why.

mod common;

use common::{Client, TempDir, vault};
use kasten_core::agent::Session;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("claude-code", Instant::now());
    (v, k, s)
}

fn xml(cells: &[&str]) -> String {
    let body: String = cells
        .iter()
        .map(|id| format!("<mxCell id=\"{id}\" value=\"{id}\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"10\" y=\"10\" width=\"80\" height=\"40\" as=\"geometry\"/></mxCell>"))
        .collect();
    format!(
        "<mxfile><diagram name=\"Page-1\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/>{body}</root></mxGraphModel></diagram></mxfile>"
    )
}

#[test]
fn the_tools_are_listed_and_their_words_teach_the_xml() {
    let specs = specs();
    let spec = |name: &str| {
        specs
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("no {name}"))
    };
    for name in [
        "list_diagrams",
        "get_diagram",
        "create_diagram",
        "update_diagram",
        "trash_diagram",
    ] {
        assert!(!spec(name).description.is_empty(), "{name}");
    }
    let create = spec("create_diagram");
    for word in [
        "mxfile",
        "mxCell",
        "vertex=\"1\"",
        "edge=\"1\"",
        "unique id",
    ] {
        assert!(
            create.description.contains(word),
            "{word}: {}",
            create.description
        );
    }
    assert_eq!(create.input_schema["required"], json!(["title"]));
    assert!(
        spec("update_diagram")
            .description
            .contains("keep the id of every cell")
    );
    assert!(
        spec("update_diagram")
            .description
            .contains("pending_review")
    );
    assert!(spec("trash_diagram").description.contains("Always waits"));
    assert_eq!(
        spec("update_diagram").input_schema["required"],
        json!(["diagram", "xml"])
    );
}

#[test]
fn an_agent_makes_reads_and_changes_a_diagram() {
    let (v, k, s) = open();
    let source = xml(&["a", "b", "c", "d"]);
    let made = call(
        &k,
        &s,
        "create_diagram",
        json!({"title": "Login flow", "xml": source, "project": "photo-organiser"}),
    )
    .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    let path = made["result"]["path"].as_str().unwrap().to_owned();
    assert_eq!(path, "projects/photo-organiser/diagrams/Login-flow.drawio");
    assert_eq!(std::fs::read_to_string(v.0.join(&path)).unwrap(), source);

    let list = call(&k, &s, "list_diagrams", Value::Null).unwrap();
    assert_eq!(list[0]["title"], json!("Login flow"));
    assert_eq!(list[0]["project"], json!("photo-organiser"));
    // A draft picture comes with what an agent makes; the editor draws the exact one later.
    assert_eq!(list[0]["preview"], json!("draft"));

    // By title or by path.
    for name in ["Login flow", "login flow", path.as_str()] {
        let got = call(&k, &s, "get_diagram", json!({"diagram": name})).unwrap();
        assert_eq!(got["path"], json!(path), "{name}");
        assert_eq!(got["title"], json!("Login flow"));
        assert_eq!(got["xml"], json!(source));
    }

    // Keeping most of the cells is done at once, in the agent's session.
    let next = xml(&["a", "b", "c", "e"]);
    let changed = call(
        &k,
        &s,
        "update_diagram",
        json!({"diagram": "Login flow", "xml": next}),
    )
    .unwrap();
    assert_eq!(changed["status"], json!("done"), "{changed}");
    assert_eq!(changed["result"]["status"], json!("saved"));
    assert_eq!(changed["session"], json!(s.id));
    assert_eq!(
        call(&k, &s, "get_diagram", json!({"diagram": &path})).unwrap()["xml"],
        json!(next)
    );
    let last = &k.log(Some(&path), 1).unwrap()[0];
    assert!(
        last.message.contains(&format!("Kasten-Session: {}", s.id)),
        "{}",
        last.message
    );

    // Taking most of them out waits for the user, and nothing is written.
    let gutted = call(
        &k,
        &s,
        "update_diagram",
        json!({"diagram": &path, "xml": xml(&["a"]), "reason": "Simplify"}),
    )
    .unwrap();
    assert_eq!(gutted["status"], json!("pending_review"), "{gutted}");
    assert!(
        gutted["reason"].as_str().unwrap().contains("elements out"),
        "{gutted}"
    );
    assert_eq!(std::fs::read_to_string(v.0.join(&path)).unwrap(), next);

    // The trash waits, always, and the files stay where they are.
    let trash = call(
        &k,
        &s,
        "trash_diagram",
        json!({"diagram": "Login flow", "reason": "Old"}),
    )
    .unwrap();
    assert_eq!(trash["status"], json!("pending_review"), "{trash}");
    assert!(v.0.join(&path).exists());
    assert_eq!(k.proposals().unwrap().len(), 2);
}

#[test]
fn what_is_not_a_diagram_or_not_there_is_an_error_the_agent_can_read() {
    let (_v, k, s) = open();
    let made = call(&k, &s, "create_diagram", json!({"title": "Login flow"})).unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    let errors = [
        call(
            &k,
            &s,
            "create_diagram",
            json!({"title": "X", "xml": "<html/>"}),
        ),
        call(
            &k,
            &s,
            "create_diagram",
            json!({"title": "X", "xml": "<mxfile><diagram></mxfile>"}),
        ),
        call(&k, &s, "create_diagram", json!({"title": "A|B"})),
        call(&k, &s, "get_diagram", json!({"diagram": "Nowhere"})),
        call(
            &k,
            &s,
            "update_diagram",
            json!({"diagram": "Login flow", "xml": "not xml"}),
        ),
        call(&k, &s, "trash_diagram", json!({"diagram": "Nowhere"})),
        call(&k, &s, "update_diagram", json!({"diagram": "Login flow"})),
    ];
    let wanted = [
        "not a diagram",
        "closing",
        "title",
        "No diagram called",
        "outside",
        "No diagram called",
        "failed to deserialize",
    ];
    for (error, wanted) in errors.into_iter().zip(wanted) {
        let message = error.unwrap_err();
        assert!(message.contains(wanted), "{wanted}: {message}");
    }
    assert_eq!(
        call(&k, &s, "list_diagrams", Value::Null)
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn a_connected_client_is_told_about_diagrams_and_can_use_them() {
    let v = vault();
    let mut c = Client::start(&v.0, "claude-code");
    assert!(
        c.instructions.contains("get_diagram") && c.instructions.contains("trash_diagram"),
        "{}",
        c.instructions
    );
    let tools = c.tools();
    for name in [
        "list_diagrams",
        "get_diagram",
        "create_diagram",
        "update_diagram",
        "trash_diagram",
    ] {
        assert!(tools.contains(&name.to_owned()), "{name} in {tools:?}");
    }
    let made = c
        .call(
            "create_diagram",
            json!({"title": "Over stdio", "xml": xml(&["a"])}),
        )
        .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    let got = c
        .call("get_diagram", json!({"diagram": "Over stdio"}))
        .unwrap();
    assert_eq!(got["xml"], json!(xml(&["a"])));
}
