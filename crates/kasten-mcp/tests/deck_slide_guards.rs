//! The guardrails around the four deck tools that used to be the editor's alone
//! (`move_slides`, `set_rich_text`, `set_slide_steps`, `apply_deck_template`): what
//! autonomous mode does with a trashed deck, a project that is stricter than the vault,
//! what the template argument may name, and that only a look is taken from it.

mod common;

use std::fs;
use std::sync::Mutex;

use common::{TempDir, deck_of_eight, slide_ids, vault};
use kasten_core::agent::Session;
use kasten_core::config_keys::{AgentMode, AgentsConfig, ProjectAgents};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten};
use kasten_mcp::tools::{Writes, call, call_in};
use serde_json::{Value, json};

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
fn in_autonomous_mode_a_trashed_deck_is_auto_accepted_and_the_commit_says_so() {
    let (v, k, s) = open();
    let (path, _) = deck_of_eight(&k, &s);
    set_mode(&k, AgentMode::Autonomous);
    let done = call(&k, &s, "trash_deck", json!({ "deck": path })).unwrap();
    assert_eq!(done["status"], json!("done"), "{done}");
    assert!(!v.0.join(&path).exists(), "the deck left its place");
    assert!(k.proposals().unwrap().is_empty());
    // It is in the trash, not deleted: a person can restore it.
    let trashed = done["result"]["trashedTo"].as_str().unwrap_or_default();
    assert!(
        !trashed.is_empty() && v.0.join(trashed).is_file(),
        "kept in the trash: {done}"
    );
    let last = &k.log(None, 1).unwrap()[0];
    assert_eq!(last.author, "agent:kasten-chat");
    assert_eq!(last.mode.as_deref(), Some("autonomous"));
    assert_eq!(last.approved_by.as_deref(), Some("autonomous-mode"));
}

#[test]
fn a_project_in_review_holds_the_four_even_when_the_vault_is_autonomous() {
    let (v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    assert!(
        path.to_lowercase().starts_with("projects/photo-organiser/"),
        "{path}"
    );
    let body = body_of(&k, &s, &path, &ids[2]);
    let template = dark_template(&k, &s);
    let mut config = k.config();
    let mut agents = AgentsConfig {
        mode: Some(AgentMode::Autonomous),
        ..AgentsConfig::default()
    };
    agents.projects.insert(
        "photo-organiser".to_owned(),
        ProjectAgents {
            mode: Some(AgentMode::Review),
            ..Default::default()
        },
    );
    config.agents = Some(agents);
    k.set_config(config).unwrap();
    let before = fs::read_to_string(v.0.join(&path)).unwrap();
    for (tool, args) in [
        (
            "move_slides",
            json!({ "deck": path, "ids": [ids[3]], "to": 0 }),
        ),
        (
            "set_rich_text",
            json!({ "deck": path, "slide": ids[2], "id": body, "text": { "paragraphs": [{ "runs": [{ "t": "Held" }] }] } }),
        ),
        (
            "set_slide_steps",
            json!({ "deck": path, "slide": ids[2], "steps": 2 }),
        ),
        (
            "apply_deck_template",
            json!({ "deck": path, "template": template }),
        ),
        // A batch holding the same operations waits as a whole too.
        (
            "update_elements",
            json!({ "deck": path, "operations": [{ "op": "move_slides", "input": { "ids": [ids[3]], "to": 0 } }] }),
        ),
    ] {
        let answer = call(&k, &s, tool, args).unwrap();
        assert_eq!(
            answer["status"],
            json!("pending_review"),
            "{tool}: {answer}"
        );
    }
    assert_eq!(fs::read_to_string(v.0.join(&path)).unwrap(), before);
}

#[test]
fn a_template_argument_cannot_reach_anything_but_a_deck_of_the_vault() {
    let (v, k, s) = open();
    let (path, _) = deck_of_eight(&k, &s);
    let before = fs::read_to_string(v.0.join(&path)).unwrap();
    let outside = v.0.parent().unwrap().join("outside.deck");
    fs::write(&outside, &before).unwrap();
    let absolute = outside.to_string_lossy().replace('\\', "/");
    for bad in [
        "../outside.deck".to_owned(),
        "..\\outside.deck".to_owned(),
        "library/../../outside.deck".to_owned(),
        "templates/slides/../../../outside.deck".to_owned(),
        absolute,
        "/etc/passwd.deck".to_owned(),
        "C:/Windows/win.ini.deck".to_owned(),
        "//server/share/x.deck".to_owned(),
        ".kasten/config.deck".to_owned(),
        ".git/config.deck".to_owned(),
        ".trash/x.deck".to_owned(),
        "welcome.md".to_owned(),
        "welcome.md.deck".to_owned(),
        ".kasten/config.yaml".to_owned(),
        "x\0.deck".to_owned(),
        String::new(),
        "   ".to_owned(),
    ] {
        let refused = call(
            &k,
            &s,
            "apply_deck_template",
            json!({ "deck": path, "template": bad }),
        );
        assert!(refused.is_err(), "{bad:?} was read: {refused:?}");
    }
    // The error never carries the text of what it was pointed at.
    let welcome = call(
        &k,
        &s,
        "apply_deck_template",
        json!({ "deck": path, "template": "welcome.md" }),
    )
    .unwrap_err();
    assert!(!welcome.contains("---"), "{welcome}");
    assert_eq!(fs::read_to_string(v.0.join(&path)).unwrap(), before);
    assert!(k.proposals().unwrap().is_empty());
}

#[test]
fn a_chat_that_previews_its_changes_stages_the_four_and_still_refuses_a_template() {
    let (v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let body = body_of(&k, &s, &path, &ids[2]);
    let template = dark_template(&k, &s);
    let before = fs::read_to_string(v.0.join(&path)).unwrap();
    let template_before = fs::read_to_string(v.0.join(&template)).unwrap();
    let set = Mutex::new(k.begin_changes(&s, Instant::now()));
    let staged = |tool: &str, args: Value| call_in(&k, &s, Writes::Staged(&set), tool, args);
    let refused = staged(
        "apply_deck_template",
        json!({ "deck": template, "template": path }),
    )
    .unwrap_err();
    assert!(refused.contains("read-only"), "{refused}");
    for (tool, args) in [
        (
            "move_slides",
            json!({ "deck": path, "ids": [ids[3]], "to": 0 }),
        ),
        (
            "set_rich_text",
            json!({ "deck": path, "slide": ids[2], "id": body, "text": { "paragraphs": [{ "runs": [{ "t": "Staged", "b": true }] }] } }),
        ),
        (
            "set_slide_steps",
            json!({ "deck": path, "slide": ids[2], "steps": 2 }),
        ),
        (
            "apply_deck_template",
            json!({ "deck": path, "template": template }),
        ),
    ] {
        let answer = staged(tool, args).unwrap();
        assert_eq!(answer["status"], json!("staged"), "{tool}: {answer}");
    }
    assert_eq!(
        fs::read_to_string(v.0.join(&path)).unwrap(),
        before,
        "nothing is written before the person applies"
    );
    // Staged, a template is as read-only as ever, and as a look it is only read.
    let refused = staged(
        "set_slide_steps",
        json!({ "deck": template, "slide": 1, "steps": 1 }),
    )
    .unwrap_err();
    assert!(refused.contains("read-only"), "{refused}");
    // (Before the look of the deck was staged onto the other, so the two looks still differ.)
    assert_eq!(
        fs::read_to_string(v.0.join(&template)).unwrap(),
        template_before
    );
}

#[test]
fn only_the_look_of_a_template_is_taken_and_never_its_words_or_pictures() {
    let (v, k, s) = open();
    let (path, ids) = deck_of_eight(&k, &s);
    let made = call(
        &k,
        &s,
        "create_deck",
        json!({ "outline": "# Source\n\n## Secret words of the template\n\nA body nobody may copy.\n\n## Second\n\nMore.", "theme": "Dark" }),
    )
    .unwrap();
    let source = made["result"]["deck"].as_str().unwrap().to_owned();
    // Any deck of the vault can lend its look (as it can be read), not only a template.
    let applied = call(
        &k,
        &s,
        "apply_deck_template",
        json!({ "deck": path, "template": source, "resize": true }),
    )
    .unwrap();
    assert_eq!(applied["status"], json!("done"), "{applied}");
    let text = fs::read_to_string(v.0.join(&path)).unwrap();
    assert!(
        !text.contains("Secret words of the template"),
        "no words copied"
    );
    assert!(!text.contains("A body nobody may copy"), "no words copied");
    assert_eq!(
        slide_ids(&k, &s, &path),
        ids,
        "the slides are the same slides"
    );
}
