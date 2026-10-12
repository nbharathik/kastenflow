//! An agent builds a deck through `kasten-mcp` over stdio, as Claude Code
//! does: from an outline, with a diagram, and then it removes four slides,
//! which waits for the person; accepting writes it, and undoing the session
//! takes everything back to the exact tree, with the git log to show for it.

mod common;

use std::fs;

use common::{Client, vault};
use kasten_core::history::History;
use kasten_core::{Instant, Kasten};
use serde_json::{Value, json};
use slides_core::canonical;

const OUTLINE: &str = "# Tool use in agents

## What a tool is
A function the model may ask the host to run.

## The loop
- The model asks
- The host runs it
- The result goes back

## Why it matters
Tools turn a talker into a doer.

## Where it fails
Wrong arguments. Silent errors.

## Guardrails
Limits and review.

## Summary
Ask, run, return.
";

/// The slide ids in `get_deck`'s answer over MCP, which is a table of text: a line for each slide.
fn ids(c: &mut Client, deck: &str) -> Vec<String> {
    let got = c.call("get_deck", json!({"deck": deck})).unwrap();
    got.as_str()
        .expect("get_deck answers in text over MCP")
        .lines()
        .skip(1)
        .filter_map(|line| line.split_whitespace().find(|word| word.starts_with("s-")))
        .map(str::to_owned)
        .collect()
}

#[test]
fn an_agent_builds_a_deck_waits_for_review_and_the_session_can_be_undone() {
    let v = vault();
    let history = History::open(&v.0).unwrap().unwrap();
    let before = history.tree_id("HEAD").unwrap();
    let mut c = Client::start(&v.0, "claude-code");

    // The server says how to work in a vault and in its decks.
    assert!(
        c.instructions
            .contains("KastenFlow is the user's notes vault"),
        "{}",
        c.instructions
    );
    assert!(c.instructions.contains("SLIDE DECKS") && c.instructions.contains("lint_deck"));
    assert!(c.instructions.contains("deck_from_note"));
    let tools = c.tools();
    for name in [
        "create_deck",
        "get_deck",
        "add_diagram",
        "delete_slides",
        "trash_deck",
        "lint_deck",
        "place_image",
    ] {
        assert!(tools.contains(&name.to_owned()), "missing {name}");
    }

    // A deck from an outline, in a project.
    let made = c
        .call(
            "create_deck",
            json!({"outline": OUTLINE, "project": "photo-organiser"}),
        )
        .unwrap();
    assert_eq!(made["status"], json!("done"), "{made}");
    let session = made["session"].as_str().unwrap().to_owned();
    let path = made["result"]["deck"].as_str().unwrap().to_owned();
    assert_eq!(
        path,
        "projects/photo-organiser/decks/tool-use-in-agents.deck"
    );
    let slides = ids(&mut c, &path);
    assert_eq!(slides.len(), 7);

    // A diagram on the second slide; the answer says what lint thinks of the slide.
    let diagram = c
        .call(
            "add_diagram",
            json!({"deck": path, "slide": slides[2], "nodes": [
                {"id": "m", "label": "Model"}, {"id": "h", "label": "Host", "emphasis": true}, {"id": "t", "label": "Tool"}],
                "edges": [{"from": "m", "to": "h", "label": "call"}, {"from": "h", "to": "t"}, {"from": "t", "to": "m", "label": "result"}]}),
        )
        .unwrap();
    assert_eq!(diagram["status"], json!("done"), "{diagram}");
    assert_eq!(diagram["session"], json!(session));
    assert_eq!(diagram["result"]["lint"]["errors"], json!(0), "{diagram}");
    let linted = c.call("lint_deck", json!({"deck": path})).unwrap();
    assert!(linted.as_str().is_some_and(|t| !t.is_empty()), "{linted}");

    // What is on disk is the deck in its canonical form, with the diagram in it.
    let on_disk = fs::read_to_string(v.0.join(&path)).unwrap();
    let parsed = canonical::parse(&on_disk).unwrap();
    assert_eq!(
        canonical::write(&parsed).unwrap(),
        on_disk,
        "the file is canonical"
    );
    assert!(
        on_disk.contains("Model") && on_disk.contains("connector"),
        "the diagram is in the file"
    );
    let saved_before_removal = on_disk;

    // Four slides at once wait for the person; the file does not change.
    let waiting = c
        .call("delete_slides", json!({"deck": path, "ids": &slides[1..5]}))
        .unwrap();
    assert_eq!(waiting["status"], json!("pending_review"), "{waiting}");
    assert_eq!(waiting["session"], json!(session));
    let proposal = waiting["proposal"].as_str().unwrap().to_owned();
    assert!(
        v.0.join(format!(".kasten/proposals/{proposal}.json"))
            .is_file()
    );
    assert_eq!(
        fs::read_to_string(v.0.join(&path)).unwrap(),
        saved_before_removal
    );

    // The person accepts in the app; the deck loses the four slides.
    let k = Kasten::open(&v.0).unwrap();
    assert_eq!(k.proposals().unwrap().len(), 1);
    k.accept_proposal(&proposal, "me", Instant::now()).unwrap();
    let after = canonical::parse(&fs::read_to_string(v.0.join(&path)).unwrap()).unwrap();
    assert_eq!(after.slides.len(), 3);

    // The log: the agent's commits carry its session and each tool's name; the approval is named.
    let log = k.log(Some(&path), 10).unwrap();
    let summaries: Vec<(&str, &str)> = log
        .iter()
        .map(|c| (c.summary.as_str(), c.op.as_deref().unwrap_or("")))
        .collect();
    assert_eq!(summaries[0].1, "delete_slides", "{summaries:?}");
    assert!(
        summaries[0]
            .0
            .starts_with("deck: edit Tool use in agents § delete slides"),
        "{summaries:?}"
    );
    assert_eq!(log[0].approved_by.as_deref(), Some("me"));
    assert!(
        summaries
            .iter()
            .any(|(s, op)| *op == "add_diagram" && s.ends_with("§ add diagram")),
        "{summaries:?}"
    );
    assert!(
        summaries
            .iter()
            .any(|(s, op)| *op == "create_deck" && *s == "deck: create Tool use in agents"),
        "{summaries:?}"
    );
    assert!(
        log.iter()
            .all(|c| c.author == "agent:claude-code"
                && c.session.as_deref() == Some(session.as_str()))
    );
    let message = &log[0].message;
    assert!(
        message.contains(&format!("Kasten-Session: {session}"))
            && message.contains("Kasten-Op: delete_slides"),
        "{message}"
    );
    assert!(message.contains("Approved-by: me"), "{message}");

    // Undo the session: the exact tree from before, the deck gone with it.
    let undone = k.undo_session(&session, Instant::now()).unwrap();
    assert_eq!(undone.conflict, None);
    assert!(undone.reverted.len() >= 4, "{undone:?}");
    assert_eq!(
        history.tree_id("HEAD").unwrap(),
        before,
        "undo must restore the exact tree"
    );
    assert!(!v.0.join(&path).exists());
    assert!(k.sessions(5).unwrap()[0].undone);
    let last = &k.log(None, 1).unwrap()[0];
    assert!(
        last.undoes.is_some() && last.message.contains("Kasten-Undo: "),
        "{}",
        last.message
    );
}

#[test]
fn a_tool_that_needs_a_deck_says_which_are_there_and_a_bad_call_is_a_tool_error() {
    let v = vault();
    let mut c = Client::start(&v.0, "claude-code");
    let listed = c.call("list_decks", json!({})).unwrap();
    let names: Vec<&str> = listed["decks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        ["library/tool-use-in-language-models.deck"],
        "the dev vault's sample deck"
    );
    // With one deck the name may be left out.
    let only = c.call("get_deck", json!({})).unwrap();
    assert!(
        only.as_str()
            .unwrap()
            .contains("library/tool-use-in-language-models.deck"),
        "{only}"
    );
    let err = c
        .call("get_deck", json!({"deck": "Nothing like it"}))
        .unwrap_err();
    assert!(
        err.contains("There is no deck called") && err.contains("list_decks"),
        "{err}"
    );
    let err = c.call("get_slide", json!({"slide": "s-none"})).unwrap_err();
    assert!(err.contains("There is no slide"), "{err}");
    // A call the tool cannot read is an error the agent can act on, not a broken connection.
    let err = c.call("create_deck", json!({"outline": 7})).unwrap_err();
    assert!(err.contains("outline"), "{err}");
    let value: Value = c.call("list_decks", json!({})).unwrap();
    assert!(value["decks"].is_array(), "the connection still works");
}
