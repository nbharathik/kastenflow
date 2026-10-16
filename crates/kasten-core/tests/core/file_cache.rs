//! Boards and decks are parsed once and remembered while the file is as it
//! was. Whatever the cache answers must be what a freshly opened engine
//! answers from the same files: after an edit in the app, an outside rewrite
//! the watcher reported (even one that kept the size and the modified time), a
//! deleted board and a board that cannot be read.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::graph::Scope;
use kasten_core::history::Actor;
use kasten_core::{Kasten, Revision};
use serde_json::json;

const SCORE: &str = "projects/photo-organiser/cards/duplicate-score-for-photos.md";
const BRAINSTORM: &str = "projects/photo-organiser/boards/brainstorm.canvas";
const PICTURE: &str = "assets/pic.png";

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

/// A deck that shows `src` on its one slide, titled `title`.
fn deck_with(title: &str, src: &str) -> String {
    let mut text = serde_json::to_string_pretty(&json!({
        "format": "kasten-deck",
        "formatVersion": 1,
        "id": "d-cache001",
        "title": title,
        "size": { "w": 960, "h": 540 },
        "slides": [{
            "id": "s-one",
            "layout": "blank",
            "elements": [{ "type": "image", "id": "e-1", "src": src, "x": 0, "y": 0, "w": 10, "h": 10 }],
        }],
    }))
    .unwrap();
    text.push('\n');
    text
}

/// Everything that reads boards and decks, from `k` and from an engine that has never looked.
fn matches_a_fresh_engine(t: &common::TempVault, k: &Kasten) {
    let fresh = Kasten::open(t.vault.root()).unwrap();
    assert_eq!(k.boards().unwrap(), fresh.boards().unwrap(), "boards");
    assert_eq!(
        k.boards_with(SCORE).unwrap(),
        fresh.boards_with(SCORE).unwrap(),
        "boards_with"
    );
    assert_eq!(k.decks().unwrap(), fresh.decks().unwrap(), "decks");
    assert_eq!(
        k.deck_templates().unwrap(),
        fresh.deck_templates().unwrap(),
        "deck templates"
    );
    assert_eq!(
        k.note_stats().unwrap(),
        fresh.note_stats().unwrap(),
        "note stats"
    );
    assert_eq!(
        k.assets_usage().unwrap(),
        fresh.assets_usage().unwrap(),
        "assets usage"
    );
    for scope in [
        Scope::Vault,
        Scope::Project {
            path: "projects/photo-organiser/_project.md".into(),
        },
        Scope::Around {
            path: SCORE.into(),
            depth: 2,
        },
    ] {
        assert_eq!(
            k.graph(&scope).unwrap(),
            fresh.graph(&scope).unwrap(),
            "graph {scope:?}"
        );
    }
}

fn ask_everything(k: &Kasten) {
    k.boards().unwrap();
    k.boards_with(SCORE).unwrap();
    k.decks().unwrap();
    k.deck_templates().unwrap();
    k.note_stats().unwrap();
    k.assets_usage().unwrap();
    k.graph(&Scope::Vault).unwrap();
}

fn write(t: &common::TempVault, rel: &str, text: &str) {
    let file = t.vault.root().join(rel);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, text).unwrap();
}

#[test]
fn the_second_look_parses_nothing_and_every_reader_shares_the_first() {
    let (t, k) = open();
    write(&t, "library/shown.deck", &deck_with("Shown", PICTURE));
    assert_eq!(k.file_cache_parses(), 0);
    let boards = k.boards().unwrap().len();
    let decks = k.decks().unwrap().len();
    assert!(boards > 0 && decks > 0);
    let once = k.file_cache_parses();
    assert_eq!(once, boards + decks);
    ask_everything(&k);
    ask_everything(&k);
    assert_eq!(
        k.file_cache_parses(),
        once,
        "boards and decks were read again"
    );
    matches_a_fresh_engine(&t, &k);
}

#[test]
fn an_edit_in_the_app_parses_that_board_alone_and_everything_matches() {
    let (t, k) = open();
    ask_everything(&k);
    let parsed = k.file_cache_parses();
    let before = k.boards().unwrap();
    k.add_sticky(&Actor::Human, BRAINSTORM, "A new thought", None, NOW)
        .unwrap();
    k.add_to_board(
        &Actor::Human,
        BRAINSTORM,
        &["library/zettelkasten-method.md".into()],
        kasten_core::board::Layout::Grid,
        NOW,
    )
    .unwrap();
    ask_everything(&k);
    assert_eq!(
        k.file_cache_parses(),
        parsed + 1,
        "only the edited board is parsed again"
    );
    let after = k.boards().unwrap();
    let was = before.iter().find(|b| b.path == BRAINSTORM).unwrap();
    let is = after.iter().find(|b| b.path == BRAINSTORM).unwrap();
    assert_eq!(is.nodes, was.nodes + 2);
    // The new card is counted for its note, and the graph draws it.
    let stats = k.note_stats().unwrap();
    assert!(
        stats
            .iter()
            .find(|s| s.path == "library/zettelkasten-method.md")
            .unwrap()
            .boards
            >= 1
    );
    matches_a_fresh_engine(&t, &k);
}

#[test]
fn a_new_board_shows_at_once() {
    let (t, k) = open();
    ask_everything(&k);
    let path = k.create_board(&Actor::Human, "Fresh", None, NOW).unwrap();
    assert!(k.boards().unwrap().iter().any(|b| b.path == path));
    matches_a_fresh_engine(&t, &k);
}

#[test]
fn an_outside_rewrite_that_keeps_size_and_time_is_seen_once_the_watcher_reports_it() {
    let (t, k) = open();
    let path = k.create_board(&Actor::Human, "Alpha", None, NOW).unwrap();
    assert!(k.boards().unwrap().iter().any(|b| b.title == "Alpha"));
    let file = t.vault.root().join(&path);
    let stamp = fs::metadata(&file).unwrap().modified().unwrap();
    let text = fs::read_to_string(&file).unwrap();
    // Same length, same modified time, other words.
    fs::write(&file, text.replace("Alpha", "Omega")).unwrap();
    fs::File::options()
        .write(true)
        .open(&file)
        .unwrap()
        .set_modified(stamp)
        .unwrap();
    assert_eq!(fs::metadata(&file).unwrap().modified().unwrap(), stamp);
    assert_eq!(fs::metadata(&file).unwrap().len() as usize, text.len());

    k.outside_changes(std::slice::from_ref(&path), 1);
    let titles: Vec<String> = k.boards().unwrap().into_iter().map(|b| b.title).collect();
    assert!(
        titles.contains(&"Omega".to_owned()) && !titles.contains(&"Alpha".to_owned()),
        "{titles:?}"
    );
    matches_a_fresh_engine(&t, &k);
}

#[test]
fn an_outside_change_that_alters_the_file_is_seen_without_a_report() {
    let (t, k) = open();
    ask_everything(&k);
    let file = t.vault.root().join(BRAINSTORM);
    let text = fs::read_to_string(&file).unwrap();
    // Longer, so its size differs: the cache notices on its own.
    let more = text.replacen("\"nodes\"", "\"x-test\": \"kept\",\n  \"nodes\"", 1);
    assert_ne!(more.len(), text.len());
    fs::write(&file, more).unwrap();
    matches_a_fresh_engine(&t, &k);
}

#[test]
fn a_deleted_board_is_gone_and_a_board_that_cannot_be_read_is_skipped_once() {
    let (t, k) = open();
    ask_everything(&k);
    let gone = t.vault.root().join(BRAINSTORM);
    fs::remove_file(&gone).unwrap();
    k.outside_changes(&[BRAINSTORM.to_owned()], 1);
    assert!(k.boards().unwrap().iter().all(|b| b.path != BRAINSTORM));
    assert!(
        k.graph(&Scope::Vault)
            .unwrap()
            .nodes
            .iter()
            .all(|n| n.id != BRAINSTORM)
    );
    matches_a_fresh_engine(&t, &k);

    write(&t, "library/broken.canvas", "{ not json");
    let listed = k.boards().unwrap();
    assert!(listed.iter().all(|b| b.path != "library/broken.canvas"));
    let parsed = k.file_cache_parses();
    ask_everything(&k);
    assert_eq!(
        k.file_cache_parses(),
        parsed,
        "a board that cannot be read is not tried on every look"
    );
    matches_a_fresh_engine(&t, &k);

    // Mended, it shows.
    write(
        &t,
        "library/broken.canvas",
        "{\"nodes\": [], \"edges\": [], \"x-kasten\": {\"title\": \"Mended\"}}\n",
    );
    assert!(k.boards().unwrap().iter().any(|b| b.title == "Mended"));
    matches_a_fresh_engine(&t, &k);
}

#[test]
fn decks_keep_their_title_slides_problem_and_pictures() {
    let (t, k) = open();
    write(&t, "library/pictured.deck", &deck_with("Pictured", PICTURE));
    write(&t, "library/not-a-deck.deck", "{\"format\": \"other\"}");
    write(
        &t,
        "templates/slides/style.deck",
        &deck_with("Style", PICTURE),
    );
    let decks = k.decks().unwrap();
    let pictured = decks
        .iter()
        .find(|d| d.path == "library/pictured.deck")
        .unwrap();
    assert_eq!(
        (
            pictured.title.as_str(),
            pictured.slides,
            pictured.problem.as_deref()
        ),
        ("Pictured", 1, None)
    );
    let broken = decks
        .iter()
        .find(|d| d.path == "library/not-a-deck.deck")
        .unwrap();
    assert!(broken.problem.is_some() && broken.slides == 0 && broken.title == "not-a-deck");
    assert!(
        decks
            .iter()
            .all(|d| d.path != "templates/slides/style.deck")
    );
    assert_eq!(k.deck_templates().unwrap().len(), 1);
    let used = &k.assets_usage().unwrap()[PICTURE];
    let titles: Vec<&str> = used.decks.iter().map(|d| d.title.as_str()).collect();
    assert_eq!(titles, ["Pictured", "Style"]);
    matches_a_fresh_engine(&t, &k);

    // Saved in the app with a new title and another picture.
    let read = k.deck("library/pictured.deck").unwrap();
    k.save_deck(
        &Actor::Human,
        "library/pictured.deck",
        &deck_with("Renamed", "assets/other.png"),
        &read.hash,
        NOW,
    )
    .unwrap();
    assert_eq!(
        k.decks()
            .unwrap()
            .iter()
            .find(|d| d.path == "library/pictured.deck")
            .unwrap()
            .title,
        "Renamed"
    );
    let usage = k.assets_usage().unwrap();
    assert!(
        usage["assets/other.png"]
            .decks
            .iter()
            .any(|d| d.title == "Renamed")
    );
    assert!(usage[PICTURE].decks.iter().all(|d| d.title != "Renamed"));
    matches_a_fresh_engine(&t, &k);
}

#[test]
fn the_graph_follows_boards_decks_and_diagrams_as_they_change() {
    let (t, k) = open();
    let nodes = |k: &Kasten| -> Vec<String> {
        k.graph(&Scope::Vault)
            .unwrap()
            .nodes
            .into_iter()
            .map(|n| n.id)
            .collect()
    };
    assert!(!nodes(&k).contains(&"library/new.deck".to_owned()));
    k.create_deck(&Actor::Human, "New", None, &deck_with("New", PICTURE), NOW)
        .unwrap();
    assert!(nodes(&k).contains(&"library/new.deck".to_owned()));
    write(&t, "library/sketch.drawio", "<mxfile/>");
    k.outside_changes(&["library/sketch.drawio".to_owned()], 1);
    assert!(nodes(&k).contains(&"library/sketch.drawio".to_owned()));
    let revision: Revision = k.revision();
    assert!(revision.decks >= 2 && revision.all >= 2);
    matches_a_fresh_engine(&t, &k);
}

#[test]
fn the_graph_keeps_the_notes_it_read_until_the_index_changes_whoever_changes_it() {
    let (t, k) = open();
    let ids = |k: &Kasten| -> Vec<String> {
        k.graph(&Scope::Vault)
            .unwrap()
            .nodes
            .into_iter()
            .map(|n| n.id)
            .collect()
    };
    let first = ids(&k);
    assert_eq!(ids(&k), first, "the second look is the first again");
    // This engine makes a page.
    let note = k
        .create(
            &Actor::Human,
            &kasten_core::NewNote {
                kind: kasten_core::Kind::Page,
                title: "Graph made".into(),
                date: "2026-10-06".into(),
                project: None,
                parent: None,
                template: None,
                icon: None,
            },
            NOW,
        )
        .unwrap();
    assert!(ids(&k).contains(&note.meta.path));
    // Another engine with the same index open (the app and the MCP server share one) makes another.
    let other = Kasten::open(t.vault.root()).unwrap();
    let theirs = other
        .create(
            &Actor::Human,
            &kasten_core::NewNote {
                kind: kasten_core::Kind::Page,
                title: "Made elsewhere".into(),
                date: "2026-10-06".into(),
                project: None,
                parent: None,
                template: None,
                icon: None,
            },
            NOW,
        )
        .unwrap();
    assert!(
        ids(&k).contains(&theirs.meta.path),
        "a change made through another connection to the index is seen"
    );
    matches_a_fresh_engine(&t, &k);
}

#[test]
fn forgetting_the_cache_makes_the_next_look_parse_everything_again() {
    let (_t, k) = open();
    ask_everything(&k);
    let parsed = k.file_cache_parses();
    k.forget_file_cache();
    ask_everything(&k);
    assert_eq!(k.file_cache_parses(), parsed * 2);
}
