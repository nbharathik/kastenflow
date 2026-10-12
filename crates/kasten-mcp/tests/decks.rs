//! The deck tools called in-process, as the app's chat calls them: slides-core's
//! tools on the vault, in the caller's session, with the same guardrails,
//! review queue and commits as the tools for notes.

mod common;

use std::fs;

use common::{OUTLINE, TempDir, deck_of_eight, slide_ids, vault};
use kasten_core::agent::Session;
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    let s = Session::start("kasten-chat", Instant::now());
    (v, k, s)
}

#[test]
fn the_deck_tools_are_listed_with_the_words_of_a_vault() {
    let all = specs();
    let get = |name: &str| {
        all.iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("no {name}"))
    };
    assert!(
        get("get_deck").input_schema["properties"]["deck"]["description"]
            .as_str()
            .unwrap()
            .contains("library/talk.deck")
    );
    assert_eq!(
        get("create_deck").input_schema["properties"]["project"]["type"],
        json!("string")
    );
    assert!(get("trash_deck").description.contains("always waits"));
    for name in [
        "list_decks",
        "get_slide",
        "add_diagram",
        "place_image",
        "set_steps",
        "lint_deck",
        "export",
    ] {
        get(name);
    }
}

#[test]
fn a_deck_made_from_an_outline_is_in_the_vault_and_the_commit_is_the_agents() {
    let (v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    assert_eq!(path, "projects/photo-organiser/decks/tool-use.deck");
    assert_eq!(ids.len(), 7, "a cover and six slides");
    assert!(v.0.join(&path).is_file());
    let last = &k.log(Some(&path), 1).unwrap()[0];
    assert_eq!(last.author, "agent:kasten-chat");
    assert_eq!(last.session.as_deref(), Some(s.id.as_str()));
    assert_eq!(last.op.as_deref(), Some("create_deck"));
    assert_eq!(last.summary, "deck: create Tool use");
    // Made without a project, it goes to the library and never over the first.
    let again = call(&k, &s, "create_deck", json!({"outline": OUTLINE})).unwrap();
    assert_eq!(again["result"]["deck"], json!("library/tool-use.deck"));
    let listed = call(&k, &s, "list_decks", Value::Null).unwrap();
    let names: Vec<&str> = listed["decks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["name"].as_str().unwrap())
        .collect();
    assert!(
        names.contains(&path.as_str()) && names.contains(&"library/tool-use.deck"),
        "{names:?}"
    );
}

#[test]
fn a_deck_is_named_by_its_path_its_title_or_its_file_name() {
    let (_v, k, s) = open();
    let (path, _) = deck_of_eight(&k, &s);
    let by_path = call(&k, &s, "get_deck", json!({"deck": path})).unwrap();
    for name in [
        "Tool use",
        "tool use",
        "tool-use",
        "tool-use.deck",
        "projects/photo-organiser/decks/tool-use",
    ] {
        let got = call(&k, &s, "get_deck", json!({"deck": name})).unwrap();
        assert_eq!(got["hash"], by_path["hash"], "{name}");
    }
    let outline = call(&k, &s, "get_outline", json!({"deck": "Tool use"})).unwrap();
    assert!(
        outline.as_str().unwrap().contains("## The loop"),
        "{outline}"
    );
    let missing = call(&k, &s, "get_deck", json!({"deck": "No such talk"})).unwrap_err();
    assert!(
        missing.contains("There is no deck called") && missing.contains("list_decks"),
        "{missing}"
    );
    // The vault has two decks by then, so leaving the name out is an error that lists them.
    let unnamed = call(&k, &s, "get_deck", json!({})).unwrap_err();
    assert!(
        unnamed.contains("Say which deck") && unnamed.contains("tool-use.deck"),
        "{unnamed}"
    );
}

#[test]
fn a_slide_template_may_be_read_and_not_changed_and_is_not_among_the_decks() {
    let (_v, k, s) = open();
    let (path, _) = deck_of_eight(&k, &s);
    let text = k.deck(&path).unwrap().text;
    let template = k
        .create_deck_template(&Actor::Human, "My look", &text, Instant::now())
        .unwrap();
    assert_eq!(template, "templates/slides/my-look.deck");

    // Listed apart: an assistant picks from the person's decks.
    let listed = call(&k, &s, "list_decks", Value::Null).unwrap();
    let names: Vec<&str> = listed["decks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["name"].as_str().unwrap())
        .collect();
    assert!(
        !names.iter().any(|n| n.starts_with("templates/")),
        "{names:?}"
    );
    // Named by its path it can be read ...
    let read = call(&k, &s, "get_deck", json!({"deck": template})).unwrap();
    assert!(read["hash"].is_string(), "{read}");
    // ... and not changed.
    let refused = call(
        &k,
        &s,
        "set_notes",
        json!({"deck": template, "slide": 1, "notes": "changed"}),
    )
    .unwrap_err();
    assert!(refused.contains("read-only"), "{refused}");
    assert_eq!(k.deck(&template).unwrap().text, text);
}

#[test]
fn a_change_commits_under_the_tools_name_and_reports_what_lint_thinks() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let added = call(
        &k,
        &s,
        "add_diagram",
        json!({"deck": path, "slide": ids[2], "nodes": [
            {"id": "m", "label": "Model"}, {"id": "h", "label": "Host", "emphasis": true}, {"id": "t", "label": "Tool"}],
            "edges": [{"from": "m", "to": "h", "label": "call"}, {"from": "h", "to": "t"}]}),
    )
    .unwrap();
    assert_eq!(added["status"], json!("done"), "{added}");
    assert_eq!(added["session"], json!(s.id));
    assert_eq!(added["result"]["changed"], json!(true));
    assert!(added["result"]["lint"]["errors"].is_number(), "{added}");
    let last = &k.log(Some(&path), 1).unwrap()[0];
    assert_eq!(last.op.as_deref(), Some("add_diagram"));
    assert_eq!(last.summary, "deck: edit Tool use § add diagram");
    assert_eq!(last.author, "agent:kasten-chat");
    // A batch says what it did in its commit.
    let batch = call(
        &k,
        &s,
        "update_elements",
        json!({"deck": path, "operations": [
            {"op": "set_notes", "input": {"slide": ids[1], "notes": "Say it slowly."}},
            {"op": "set_notes", "input": {"slide": ids[3], "notes": "Then the loop."}}]}),
    )
    .unwrap();
    assert_eq!(batch["status"], json!("done"), "{batch}");
    assert_eq!(
        k.log(Some(&path), 1).unwrap()[0].summary,
        "deck: edit Tool use § update elements (set notes)"
    );
    // The deck the tools read is the file the vault holds.
    let text = fs::read_to_string(_v.0.join(&path)).unwrap();
    assert!(text.contains("Say it slowly."));
}

#[test]
fn removing_three_slides_at_once_is_within_the_limit() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let three = call(
        &k,
        &s,
        "delete_slides",
        json!({"deck": path, "ids": &ids[4..7]}),
    )
    .unwrap();
    assert_eq!(three["status"], json!("done"), "{three}");
    assert_eq!(slide_ids(&k, &s, &path).len(), 4);
    assert!(k.proposals().unwrap().is_empty());
}

#[test]
fn removing_more_than_three_slides_waits_for_review_and_accepting_writes_it() {
    let (v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let before = fs::read_to_string(v.0.join(&path)).unwrap();
    let waiting = call(
        &k,
        &s,
        "delete_slides",
        json!({"deck": path, "ids": &ids[1..5]}),
    )
    .unwrap();
    assert_eq!(waiting["status"], json!("pending_review"), "{waiting}");
    assert_eq!(waiting["session"], json!(s.id));
    assert!(
        waiting["reason"].as_str().unwrap().contains("4 slides"),
        "{waiting}"
    );
    assert_eq!(
        fs::read_to_string(v.0.join(&path)).unwrap(),
        before,
        "nothing is written before the review"
    );

    // A batch that removes them waits as a whole, what else it does included.
    let batch = call(
        &k,
        &s,
        "update_elements",
        json!({"deck": path, "operations": [
            {"op": "set_notes", "input": {"slide": ids[0], "notes": "x"}},
            {"op": "delete_slides", "input": {"ids": &ids[1..5]}}]}),
    )
    .unwrap();
    assert_eq!(batch["status"], json!("pending_review"), "{batch}");
    assert_eq!(fs::read_to_string(v.0.join(&path)).unwrap(), before);
    assert_eq!(k.proposals().unwrap().len(), 2);

    // Accepting writes the deck as the agent left it, as the agent's commit with the approval.
    k.accept_proposal(waiting["proposal"].as_str().unwrap(), "me", Instant::now())
        .unwrap();
    assert_eq!(slide_ids(&k, &s, &path).len(), 3);
    let last = &k.log(Some(&path), 1).unwrap()[0];
    assert_eq!(last.author, "agent:kasten-chat");
    assert_eq!(last.approved_by.as_deref(), Some("me"));
    assert_eq!(last.op.as_deref(), Some("delete_slides"));
    assert_eq!(last.session.as_deref(), Some(s.id.as_str()));
}

#[test]
fn a_deck_goes_to_the_trash_only_when_the_person_accepts() {
    let (v, k, s) = open();
    let (path, _) = deck_of_eight(&k, &s);
    k.trust_session(&s.id, Instant::now().millis + 3_600_000)
        .unwrap();
    let waiting = call(&k, &s, "trash_deck", json!({"deck": path})).unwrap();
    assert_eq!(waiting["status"], json!("pending_review"), "{waiting}");
    assert!(
        waiting["reason"].as_str().unwrap().contains("always"),
        "{waiting}"
    );
    assert!(v.0.join(&path).is_file());
    k.accept_proposal(waiting["proposal"].as_str().unwrap(), "me", Instant::now())
        .unwrap();
    assert!(!v.0.join(&path).exists());
    assert!(k.list_trash().unwrap().iter().any(|t| t.original == path));
}

#[test]
fn what_a_person_saved_a_moment_ago_is_kept_by_the_agents_next_change() {
    let (v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    // The agent read the deck; then the person retitled a slide; then the agent changed another.
    call(&k, &s, "get_deck", json!({"deck": path})).unwrap();
    let file = k.deck(&path).unwrap();
    let person = file.text.replacen("The loop", "The agent loop", 1);
    k.save_deck(&Actor::Human, &path, &person, &file.hash, Instant::now())
        .unwrap();
    let done = call(
        &k,
        &s,
        "set_notes",
        json!({"deck": path, "slide": ids[5], "notes": "Wrap up."}),
    )
    .unwrap();
    assert_eq!(done["status"], json!("done"), "{done}");
    let text = fs::read_to_string(v.0.join(&path)).unwrap();
    assert!(
        text.contains("The agent loop") && text.contains("Wrap up."),
        "both changes are there"
    );
    let decks = k.decks().unwrap();
    assert!(
        decks.iter().all(|d| !d.path.contains("conflict")),
        "{decks:?}"
    );
}

#[test]
fn rendering_says_it_is_not_available_and_errors_read_like_the_note_tools() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    for tool in ["render_slide", "render_grid"] {
        let err = call(&k, &s, tool, json!({"deck": path, "slide": ids[1]})).unwrap_err();
        assert!(err.contains("not available"), "{tool}: {err}");
    }
    let unknown = call(&k, &s, "delete_everything", json!({})).unwrap_err();
    assert_eq!(unknown, "tool not found: delete_everything");
    let bad_slide = call(
        &k,
        &s,
        "get_slide",
        json!({"deck": path, "slide": "s-nope"}),
    )
    .unwrap_err();
    assert!(bad_slide.contains("There is no slide"), "{bad_slide}");
    let not_an_object = call(&k, &s, "get_deck", json!([1])).unwrap_err();
    assert!(not_an_object.contains("JSON object"), "{not_an_object}");
}

#[test]
fn a_batch_of_more_than_200_kb_is_refused_however_small_the_change_it_makes() {
    let (v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let before = fs::read_to_string(v.0.join(&path)).unwrap();
    let huge = "x".repeat(210 * 1024);
    let err = call(
        &k,
        &s,
        "set_notes",
        json!({"deck": path, "slide": ids[1], "notes": huge}),
    )
    .unwrap_err();
    assert!(err.contains("200 KB"), "{err}");
    assert_eq!(fs::read_to_string(v.0.join(&path)).unwrap(), before);
}

#[test]
fn looking_at_decks_changes_nothing_in_the_vault() {
    let (_v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let head = k.log(None, 1).unwrap()[0].id.clone();
    for (tool, args) in [
        ("list_decks", json!({})),
        ("get_deck", json!({"deck": path})),
        ("get_slide", json!({"deck": path, "slide": ids[1]})),
        ("get_outline", json!({"deck": path})),
        ("list_layouts", json!({"deck": path})),
        ("get_theme", json!({"deck": path})),
        ("search_assets", json!({})),
        ("lint_deck", json!({"deck": path})),
    ] {
        call(&k, &s, tool, args).unwrap_or_else(|e| panic!("{tool}: {e}"));
    }
    assert_eq!(k.log(None, 1).unwrap()[0].id, head);
    assert!(k.dirty().unwrap().is_empty(), "{:?}", k.dirty().unwrap());
    assert!(k.proposals().unwrap().is_empty());
}
