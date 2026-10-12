//! Slide templates: decks whose look is the point, kept as plain `.deck` files in
//! `templates/slides/` of the vault. The deck list, the graph and the Library leave them out;
//! only a person writes them; they are moved to the trash and back by the same ops as decks.

use crate::common::NOW;
use crate::deck_support::{SIX, deck, edit, open};

use kasten_core::Error;
use kasten_core::deck::{self, DeckSaved};
use kasten_core::graph::Scope;
use kasten_core::history::Actor;

fn look(title: &str) -> String {
    deck(title, &SIX[..2])
}

#[test]
fn a_template_is_a_deck_file_in_templates_slides_that_the_deck_list_leaves_out() {
    let (t, k, _s, path, _text) = open();
    let text = look("My look");
    let made = k
        .create_deck_template(&Actor::Human, "My look", &text, NOW)
        .unwrap();
    assert_eq!(made, "templates/slides/my-look.deck");
    let on_disk = std::fs::read_to_string(t.vault.root().join(&made)).unwrap();
    assert_eq!(on_disk, text, "byte for byte what the editor wrote");

    let listed = k.deck_templates().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (
            listed[0].path.as_str(),
            listed[0].title.as_str(),
            listed[0].slides
        ),
        (made.as_str(), "My look", 2)
    );
    assert!(listed[0].problem.is_none() && listed[0].project.is_none());

    let decks = k.decks().unwrap();
    assert!(
        decks.iter().any(|d| d.path == path),
        "decks are still listed"
    );
    assert!(
        decks.iter().all(|d| !d.path.starts_with("templates/")),
        "templates are not decks of the Slides home or the Library"
    );
    let g = k.graph(&Scope::Vault).unwrap();
    assert!(
        g.nodes.iter().all(|n| !n.id.starts_with("templates/")),
        "nor graph nodes"
    );
}

#[test]
fn a_template_can_be_read_by_its_path_like_a_deck() {
    let (_t, k, _s, _path, _text) = open();
    let made = k
        .create_deck_template(&Actor::Human, "My look", &look("My look"), NOW)
        .unwrap();
    assert_eq!(k.resolve_deck(&made).unwrap(), made);
    assert_eq!(k.deck(&made).unwrap().text, look("My look"));
    assert!(deck::is_template(&made));
    assert!(!deck::is_template("library/talk.deck"));
    assert!(!deck::is_template("templates/page.md"));
}

#[test]
fn only_a_person_makes_a_template_and_a_name_in_use_gets_the_next_free_file() {
    let (_t, k, s, _path, _text) = open();
    let refused = k
        .create_deck_template(&s.actor(), "Mine", &look("Mine"), NOW)
        .unwrap_err();
    assert!(matches!(refused, Error::Invalid(_)), "{refused:?}");
    assert!(refused.to_string().contains("person"), "{refused}");
    assert!(k.deck_templates().unwrap().is_empty());

    let first = k
        .create_deck_template(&Actor::Human, "Mine", &look("Mine"), NOW)
        .unwrap();
    let second = k
        .create_deck_template(&Actor::Human, "Mine", &look("Mine"), NOW)
        .unwrap();
    assert_eq!(
        (first.as_str(), second.as_str()),
        ("templates/slides/mine.deck", "templates/slides/mine-2.deck")
    );
}

#[test]
fn a_template_needs_a_title_and_a_deck() {
    let (_t, k, _s, _path, _text) = open();
    for (title, text) in [
        ("  ", look("X")),
        ("A|B", look("X")),
        ("Fine", "{}".to_owned()),
    ] {
        assert!(
            k.create_deck_template(&Actor::Human, title, &text, NOW)
                .is_err(),
            "{title:?}"
        );
    }
    assert!(k.deck_templates().unwrap().is_empty());
}

#[test]
fn an_agent_may_read_a_template_and_cannot_change_it() {
    let (_t, k, s, _path, _text) = open();
    let text = look("Mine");
    let made = k
        .create_deck_template(&Actor::Human, "Mine", &text, NOW)
        .unwrap();
    let err = k
        .agent_run(
            &s,
            &edit(&made, &text, &text.replace("Intro", "Changed")),
            NOW,
        )
        .unwrap_err();
    assert!(err.to_string().contains("read-only"), "{err}");
    assert_eq!(k.deck(&made).unwrap().text, text);
}

#[test]
fn a_template_is_renamed_by_saving_it_and_the_list_follows() {
    let (_t, k, _s, _path, _text) = open();
    let made = k
        .create_deck_template(&Actor::Human, "Mine", &look("Mine"), NOW)
        .unwrap();
    let file = k.deck(&made).unwrap();
    let renamed = look("Mine").replace("\"title\": \"Mine\"", "\"title\": \"Renamed\"");
    let saved = k
        .save_deck(&Actor::Human, &made, &renamed, &file.hash, NOW)
        .unwrap();
    assert!(matches!(saved, DeckSaved::Written { .. }));
    let listed = k.deck_templates().unwrap();
    assert_eq!(listed[0].title, "Renamed");
    assert_eq!(listed[0].path, made, "the file keeps its name");
}

#[test]
fn a_template_goes_to_the_trash_and_comes_back_where_it_was() {
    let (t, k, _s, _path, _text) = open();
    let made = k
        .create_deck_template(&Actor::Human, "Mine", &look("Mine"), NOW)
        .unwrap();
    let trashed = k.trash(&Actor::Human, &made, NOW).unwrap();
    assert!(!t.vault.root().join(&made).exists());
    assert!(k.deck_templates().unwrap().is_empty());
    assert!(
        k.list_trash()
            .unwrap()
            .iter()
            .any(|item| item.trashed == trashed)
    );
    let back = k.restore_deck(&Actor::Human, &trashed).unwrap();
    assert_eq!(back, made);
    assert_eq!(k.deck_templates().unwrap().len(), 1);
}

#[test]
fn a_template_that_cannot_be_read_is_still_listed_to_be_looked_at_or_trashed() {
    let (t, k, _s, _path, _text) = open();
    let file = t.vault.root().join("templates/slides/odd.deck");
    std::fs::create_dir_all(file.parent().unwrap()).unwrap();
    std::fs::write(&file, "not a deck").unwrap();
    let listed = k.deck_templates().unwrap();
    assert_eq!(listed.len(), 1);
    assert!(listed[0].problem.is_some());
    assert_eq!(listed[0].title, "odd");
}
