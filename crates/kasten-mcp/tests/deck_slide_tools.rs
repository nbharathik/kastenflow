//! The four deck tools that used to be the editor's alone (`move_slides`, `set_rich_text`,
//! `set_slide_steps`, `apply_deck_template`), met through the vault: listed with their
//! schemas, written as the agent's commit, held to the agent modes, refused on a template
//! and over 200 KB, and never changing a deck they were refused on.

mod common;

use std::fs;

use common::{Client, TempDir, deck_of_eight, slide_ids, vault};
use kasten_core::agent::Session;
use kasten_core::config_keys::{AgentMode, AgentsConfig};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{call, specs};
use serde_json::{Value, json};

const FOUR: [&str; 4] = [
    "move_slides",
    "set_rich_text",
    "set_slide_steps",
    "apply_deck_template",
];

fn open() -> (TempDir, Kasten, Session) {
    let v = vault();
    let k = Kasten::open(&v.0).unwrap();
    (v, k, Session::start("kasten-chat", Instant::now()))
}

fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

fn deck_json(v: &TempDir, path: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(v.0.join(path)).unwrap()).unwrap()
}

/// The id of a slide's body text box.
fn body_of(k: &Kasten, s: &Session, deck: &str, slide: &str) -> String {
    let got = call(k, s, "get_slide", json!({ "deck": deck, "slide": slide })).unwrap();
    got["slide"]["elements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["type"] == "text" && e["placeholder"] == "body")
        .map(|e| e["id"].as_str().unwrap().to_owned())
        .unwrap_or_else(|| panic!("no body: {got}"))
}

/// A template in `templates/slides/` with the Dark look; returns its path.
fn dark_template(k: &Kasten, s: &Session) -> String {
    let made = call(
        k,
        s,
        "create_deck",
        json!({ "outline": "# Dark look\n\n## Only a title", "theme": "Dark" }),
    )
    .unwrap();
    let path = made["result"]["deck"].as_str().unwrap().to_owned();
    let text = k.deck(&path).unwrap().text;
    k.create_deck_template(&Actor::Human, "Dark look", &text, Instant::now())
        .unwrap()
}

#[test]
fn the_chat_tells_what_each_one_set_out_to_do_in_plain_words() {
    use kasten_mcp::decks::words::action;
    let deck = json!({ "deck": "library/talk.deck" });
    let with = |extra: Value| {
        let mut input = deck.clone();
        input
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        input
    };
    assert_eq!(
        action("move_slides", &with(json!({ "ids": ["s-1"], "to": 0 }))).unwrap(),
        "move slides in “library/talk”"
    );
    assert_eq!(
        action("set_slide_steps", &with(json!({ "slide": 2, "steps": 3 }))).unwrap(),
        "set the clicks of slide 2 of “library/talk”"
    );
    assert_eq!(
        action(
            "apply_deck_template",
            &with(json!({ "template": "templates/slides/dark.deck" }))
        )
        .unwrap(),
        "put the look of “templates/slides/dark” on “library/talk”"
    );
    assert!(action("set_rich_text", &deck).unwrap().contains("words"));
}

#[test]
fn the_four_tools_are_listed_over_the_protocol_with_their_schemas() {
    let all = specs();
    for name in FOUR {
        let spec = all
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("no {name}"));
        assert_eq!(spec.input_schema["type"], json!("object"), "{name}");
        assert!(spec.description.len() > 90, "{name}");
        assert!(
            spec.input_schema["properties"]["deck"]["description"]
                .as_str()
                .is_some_and(|d| d.contains("library/talk.deck")),
            "{name} names a deck the way a vault does"
        );
    }
    let required = |name: &str| -> Vec<String> {
        let spec = all.iter().find(|s| s.name == name).unwrap();
        spec.input_schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r.as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(required("move_slides"), ["ids", "to"]);
    assert_eq!(required("set_rich_text"), ["slide", "id", "text"]);
    assert_eq!(required("set_slide_steps"), ["slide", "steps"]);
    assert_eq!(required("apply_deck_template"), ["template"]);
    // The note tool that takes the name `apply_template` is not shadowed by the deck tool.
    assert_eq!(
        all.iter().filter(|s| s.name == "apply_template").count(),
        1,
        "one tool of that name: the note one"
    );

    let v = vault();
    let mut client = Client::start(&v.0, "claude-code");
    let listed = client.tools();
    for name in FOUR {
        assert_eq!(listed.iter().filter(|n| *n == name).count(), 1, "{name}");
    }
    assert_eq!(
        listed.iter().filter(|n| *n == "apply_template").count(),
        1,
        "the note tool keeps its name"
    );
}

#[test]
fn each_tool_changes_the_deck_in_the_vault_as_the_agents_commit() {
    let (v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let body = body_of(&k, &s, &path, &ids[2]);

    let moved = call(
        &k,
        &s,
        "move_slides",
        json!({ "deck": path, "ids": [ids[3]], "to": 0 }),
    )
    .unwrap();
    assert_eq!(moved["status"], json!("done"), "{moved}");
    assert_eq!(slide_ids(&k, &s, &path)[0], ids[3]);
    let last = &k.log(Some(&path), 1).unwrap()[0];
    assert_eq!(last.op.as_deref(), Some("move_slides"));
    assert_eq!(last.author, "agent:kasten-chat");

    let written = call(
        &k,
        &s,
        "set_rich_text",
        json!({ "deck": path, "slide": ids[2], "id": body, "text": { "paragraphs": [
            { "runs": [{ "t": "Strong ", "b": true }, { "t": "calm", "i": true, "color": "accent1" }] }
        ] } }),
    )
    .unwrap();
    assert_eq!(written["status"], json!("done"), "{written}");
    let on_disk = fs::read_to_string(v.0.join(&path)).unwrap();
    assert!(on_disk.contains("Strong "), "{on_disk}");
    assert_eq!(
        k.log(Some(&path), 1).unwrap()[0].op.as_deref(),
        Some("set_rich_text")
    );

    let steps = call(
        &k,
        &s,
        "set_slide_steps",
        json!({ "deck": path, "slide": ids[2], "steps": 3 }),
    )
    .unwrap();
    assert_eq!(steps["status"], json!("done"), "{steps}");
    let got = call(
        &k,
        &s,
        "get_slide",
        json!({ "deck": path, "slide": ids[2] }),
    )
    .unwrap();
    assert_eq!(got["slide"]["steps"], json!(3), "{got}");

    let template = dark_template(&k, &s);
    let template_text = fs::read_to_string(v.0.join(&template)).unwrap();
    let before = deck_json(&v, &path)["theme"]["name"].clone();
    assert_ne!(before, json!("Dark"));
    let applied = call(
        &k,
        &s,
        "apply_deck_template",
        json!({ "deck": path, "template": template }),
    )
    .unwrap();
    assert_eq!(applied["status"], json!("done"), "{applied}");
    assert_eq!(deck_json(&v, &path)["theme"]["name"], json!("Dark"));
    assert!(
        fs::read_to_string(v.0.join(&path))
            .unwrap()
            .contains("Strong "),
        "the words stay"
    );
    assert_eq!(
        k.log(Some(&path), 1).unwrap()[0].op.as_deref(),
        Some("apply_deck_template")
    );
    // The template is only read: its file is as it was.
    assert_eq!(
        fs::read_to_string(v.0.join(&template)).unwrap(),
        template_text
    );
}

#[test]
fn review_holds_every_one_balanced_and_autonomous_write_at_once() {
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        let (v, k, s) = open();
        let (path, ids) = deck_of_eight(&k, &s);
        let body = body_of(&k, &s, &path, &ids[2]);
        let template = dark_template(&k, &s);
        set_mode(&k, mode);
        let before = fs::read_to_string(v.0.join(&path)).unwrap();
        let calls = [
            (
                "move_slides",
                json!({ "deck": path, "ids": [ids[3]], "to": 0 }),
            ),
            (
                "set_rich_text",
                json!({ "deck": path, "slide": ids[2], "id": body, "text": { "paragraphs": [{ "runs": [{ "t": "Held", "b": true }] }] } }),
            ),
            (
                "set_slide_steps",
                json!({ "deck": path, "slide": ids[2], "steps": 2 }),
            ),
            (
                "apply_deck_template",
                json!({ "deck": path, "template": template }),
            ),
        ];
        for (tool, args) in calls {
            let answer = call(&k, &s, tool, args).unwrap();
            match mode {
                AgentMode::Review => {
                    assert_eq!(
                        answer["status"],
                        json!("pending_review"),
                        "{mode:?} {tool}: {answer}"
                    );
                    assert_eq!(
                        fs::read_to_string(v.0.join(&path)).unwrap(),
                        before,
                        "{tool} writes nothing before the review"
                    );
                }
                _ => assert_eq!(answer["status"], json!("done"), "{mode:?} {tool}: {answer}"),
            }
        }
        if mode == AgentMode::Review {
            assert_eq!(k.proposals().unwrap().len(), 4);
            // Accepting one writes what the agent asked, as the agent's commit with the approval.
            let first = k.proposals().unwrap()[0].id.clone();
            k.accept_proposal(&first, "me", Instant::now()).unwrap();
            let last = &k.log(Some(&path), 1).unwrap()[0];
            assert_eq!(last.author, "agent:kasten-chat");
            assert_eq!(last.approved_by.as_deref(), Some("me"));
        } else {
            assert!(k.proposals().unwrap().is_empty(), "{mode:?}");
        }
    }
}

#[test]
fn a_deck_goes_to_the_trash_only_when_the_person_accepts_whatever_the_mode() {
    for mode in [AgentMode::Review, AgentMode::Balanced] {
        let (v, k, s) = open();
        let (path, _) = deck_of_eight(&k, &s);
        set_mode(&k, mode);
        let waiting = call(&k, &s, "trash_deck", json!({ "deck": path })).unwrap();
        assert_eq!(
            waiting["status"],
            json!("pending_review"),
            "{mode:?} {waiting}"
        );
        assert!(v.0.join(&path).is_file(), "{mode:?}");
    }
}

#[test]
fn a_template_is_read_for_its_look_and_never_written_by_any_of_the_four() {
    let (v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let template = dark_template(&k, &s);
    let before = fs::read_to_string(v.0.join(&template)).unwrap();
    let first_in_template = slide_ids(&k, &s, &template)[0].clone();
    let body_in_template = {
        let got = call(&k, &s, "get_slide", json!({ "deck": template, "slide": 1 })).unwrap();
        got["slide"]["elements"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    for (tool, args) in [
        (
            "move_slides",
            json!({ "deck": template, "ids": [first_in_template], "to": 1 }),
        ),
        (
            "set_rich_text",
            json!({ "deck": template, "slide": 1, "id": body_in_template, "text": { "paragraphs": [{ "runs": [{ "t": "no" }] }] } }),
        ),
        (
            "set_slide_steps",
            json!({ "deck": template, "slide": 1, "steps": 1 }),
        ),
        (
            "apply_deck_template",
            json!({ "deck": template, "template": path }),
        ),
    ] {
        let refused = call(&k, &s, tool, args).unwrap_err();
        assert!(refused.contains("read-only"), "{tool}: {refused}");
    }
    assert_eq!(fs::read_to_string(v.0.join(&template)).unwrap(), before);
    // A template that is not a deck, a deck that is not there, and a path out of the vault.
    for bad in ["no-such-look", "../outside.deck", "library/missing.deck"] {
        let refused = call(
            &k,
            &s,
            "apply_deck_template",
            json!({ "deck": path, "template": bad }),
        )
        .unwrap_err();
        assert!(!refused.is_empty(), "{bad}");
    }
    let unchanged = fs::read_to_string(v.0.join(&path)).unwrap();
    let again = call(&k, &s, "get_deck", json!({ "deck": path })).unwrap();
    assert_eq!(again["slides"].as_array().unwrap().len(), ids.len());
    assert_eq!(unchanged, fs::read_to_string(v.0.join(&path)).unwrap());
}

#[test]
fn a_write_of_more_than_200_kb_is_refused_and_a_bad_argument_says_what_is_missing() {
    let (v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let body = body_of(&k, &s, &path, &ids[2]);
    let before = fs::read_to_string(v.0.join(&path)).unwrap();
    let huge = "x".repeat(210 * 1024);
    let err = call(
        &k,
        &s,
        "set_rich_text",
        json!({ "deck": path, "slide": ids[2], "id": body, "text": { "paragraphs": [{ "runs": [{ "t": huge }] }] } }),
    )
    .unwrap_err();
    assert!(err.contains("200 KB"), "{err}");
    for (tool, args, word) in [
        ("move_slides", json!({ "deck": path }), "ids"),
        (
            "set_slide_steps",
            json!({ "deck": path, "slide": ids[1] }),
            "steps",
        ),
        (
            "set_rich_text",
            json!({ "deck": path, "slide": ids[1] }),
            "id",
        ),
        ("apply_deck_template", json!({ "deck": path }), "template"),
    ] {
        let err = call(&k, &s, tool, args).unwrap_err();
        assert!(err.contains(word), "{tool}: {err}");
    }
    let err = call(
        &k,
        &s,
        "set_slide_steps",
        json!({ "deck": path, "slide": ids[1], "steps": 51 }),
    )
    .unwrap_err();
    assert!(!err.is_empty());
    assert_eq!(fs::read_to_string(v.0.join(&path)).unwrap(), before);
}
