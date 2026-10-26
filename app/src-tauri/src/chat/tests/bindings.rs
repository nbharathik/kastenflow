//! A thread tied to a page, deck, diagram or document: kept in the thread's
//! head file, found again after a reload, followed through renames and moves,
//! and imported once from what the window kept in the browser.

use std::collections::HashMap;
use std::fs;

use serde_json::json;

use super::history::saved;
use super::store::{open, store_of};
use super::turns::{request, turn};
use super::{Fake, Scratch, Seen, Vault, vault};
use crate::chat::binding::{Binding, Move};
use crate::chat::limit::ChatLimits;
use crate::chat::store::vault_hash;
use crate::chat::threads::Chats;

fn target(kind: &str, path: &str, id: Option<&str>) -> Binding {
    Binding {
        kind: kind.to_owned(),
        path: path.to_owned(),
        id: id.map(str::to_owned),
    }
}

fn deck() -> Binding {
    target("deck", "library/a.deck", None)
}

fn two_chats() -> (Vault, Scratch, Chats) {
    let v = vault();
    let data = Scratch::new();
    let chats = open(&data, &v);
    for id in ["c1", "c2"] {
        turn(
            &chats,
            &v,
            &Fake::new(vec![]),
            &Seen::new(),
            request(id, "Hello"),
        );
    }
    (v, data, chats)
}

fn bound_to(chats: &Chats, binding: &Binding) -> Option<String> {
    chats.thread_for(binding).unwrap().map(|t| t.id)
}

#[test]
fn a_binding_is_in_the_head_file_and_found_again_after_a_reload() {
    let (v, data, chats) = two_chats();
    assert_eq!(bound_to(&chats, &deck()), None);
    assert_eq!(chats.bind("c1", deck()).unwrap(), Vec::<String>::new());
    assert_eq!(bound_to(&chats, &deck()).as_deref(), Some("c1"));
    // In the head file, beside the title, not in the window.
    let folder = data
        .0
        .join("chats")
        .join(vault_hash(&v.kasten.root().display().to_string()));
    let head: serde_json::Value =
        serde_json::from_slice(&fs::read(folder.join("c1.head.json")).unwrap()).unwrap();
    assert_eq!(
        head["bound"],
        json!({"kind": "deck", "path": "library/a.deck"})
    );
    // The app starts again: the same thread, and the chat's conversation untouched.
    let again = open(&data, &v);
    let found = again.thread_for(&deck()).unwrap().unwrap();
    assert_eq!((found.id.as_str(), found.title.as_str()), ("c1", "Hello"));
    assert_eq!(again.loaded("c1", &v.kasten).unwrap().bound, Some(deck()));
    assert!(
        again
            .list()
            .iter()
            .find(|t| t.id == "c2")
            .unwrap()
            .bound
            .is_none()
    );
    // Binding did not change the thread's place in the list.
    assert_eq!(store_of(&data, &v).load("c1").unwrap().messages.len(), 2);
}

#[test]
fn binding_another_thread_takes_over_and_the_old_one_stays_in_the_list() {
    let (_v, _data, chats) = two_chats();
    chats.bind("c1", deck()).unwrap();
    assert_eq!(chats.bind("c2", deck()).unwrap(), ["c1"]);
    assert_eq!(bound_to(&chats, &deck()).as_deref(), Some("c2"));
    let old = chats.list().into_iter().find(|t| t.id == "c1").unwrap();
    assert!(old.bound.is_none(), "kept, but no longer the deck's");
    // A thread is tied to one thing: binding it elsewhere moves it.
    chats
        .bind("c2", target("diagram", "library/d.drawio", None))
        .unwrap();
    assert_eq!(bound_to(&chats, &deck()), None);
    assert_eq!(
        bound_to(&chats, &target("diagram", "library/d.drawio", None)).as_deref(),
        Some("c2")
    );
}

#[test]
fn unbinding_cuts_the_tie_and_says_whether_there_was_one() {
    let (_v, _data, chats) = two_chats();
    chats.bind("c1", deck()).unwrap();
    assert!(chats.unbind("c1").unwrap());
    assert!(!chats.unbind("c1").unwrap());
    assert!(!chats.unbind("nobody").unwrap());
    assert_eq!(bound_to(&chats, &deck()), None);
    assert_eq!(chats.list().len(), 2, "no thread went");
}

#[test]
fn a_note_is_found_by_its_id_whatever_it_is_called() {
    let (_v, _data, chats) = two_chats();
    chats
        .bind("c1", target("page", "projects/a/pages/x.md", Some("N1")))
        .unwrap();
    let renamed = target("page", "projects/a/pages/renamed.md", Some("N1"));
    assert_eq!(bound_to(&chats, &renamed).as_deref(), Some("c1"));
    let other = target("page", "projects/a/pages/x.md", Some("N2"));
    assert_eq!(
        bound_to(&chats, &other),
        None,
        "another note of the same path"
    );
    // The same path as a deck is a different thing.
    assert_eq!(
        bound_to(&chats, &target("deck", "projects/a/pages/x.md", None)),
        None
    );
}

#[test]
fn a_rename_or_a_move_follows_for_files_and_for_folders() {
    let (v, data, chats) = two_chats();
    chats.bind("c1", deck()).unwrap();
    chats
        .bind("c2", target("latex", "projects/p/paper/main.tex", None))
        .unwrap();
    let moved = chats
        .rebind(&[
            Move {
                from: "library/a.deck".to_owned(),
                to: "projects/p/decks/a.deck".to_owned(),
            },
            Move {
                from: "projects/p".to_owned(),
                to: "projects/q".to_owned(),
            },
        ])
        .unwrap();
    assert_eq!(moved, 2);
    assert_eq!(bound_to(&chats, &deck()), None);
    assert_eq!(
        bound_to(&chats, &target("deck", "projects/p/decks/a.deck", None)).as_deref(),
        Some("c1"),
        "a path follows the first move that names it, not each one after it"
    );
    assert_eq!(
        bound_to(&chats, &target("latex", "projects/q/paper/main.tex", None)).as_deref(),
        Some("c2")
    );
    // Nothing moved, nothing changed; and it is kept for the next run.
    assert_eq!(chats.rebind(&[]).unwrap(), 0);
    let kept = store_of(&data, &v).load("c2").unwrap().bound.unwrap();
    assert_eq!(kept.path, "projects/q/paper/main.tex");
}

#[test]
fn a_chat_with_no_saved_file_yet_gets_one_and_bad_targets_are_refused() {
    let v = vault();
    let data = Scratch::new();
    let chats = open(&data, &v);
    chats.bind("draft", deck()).unwrap();
    assert_eq!(bound_to(&chats, &deck()).as_deref(), Some("draft"));
    assert!(store_of(&data, &v).load("draft").is_some());
    for bad in [
        target("", "a", None),
        target("deck", "", None),
        target("de ck", "a", None),
    ] {
        assert!(chats.bind("draft", bad.clone()).is_err());
        assert!(chats.thread_for(&bad).is_err());
    }
    assert!(chats.bind("../x", deck()).is_err());
}

#[test]
fn a_tied_thread_lives_with_its_page_and_the_cap_leaves_it_in_the_list() {
    let v = vault();
    let data = Scratch::new();
    let store = store_of(&data, &v);
    for n in 0..12u64 {
        let mut record = saved(&format!("c{n}"), 1_000 + n);
        if n == 0 {
            record.bound = Some(deck());
        }
        store.save(&record).unwrap();
    }
    let chats = open(&data, &v);
    chats.set_limits(ChatLimits {
        list_size: 10,
        max_concurrent: 3,
    });
    let archived: Vec<String> = chats
        .list()
        .into_iter()
        .filter(|t| t.archived)
        .map(|t| t.id)
        .collect();
    assert_eq!(archived, ["c1"], "c0 is the deck's; c2 to c11 are the ten");
    // Binding an archived chat brings it back.
    chats
        .bind("c1", target("deck", "library/b.deck", None))
        .unwrap();
    assert!(!chats.list().iter().find(|t| t.id == "c1").unwrap().archived);
}

#[test]
fn a_new_thread_takes_the_tie_of_the_one_it_replaces() {
    let (_v, _data, chats) = two_chats();
    chats.bind("c1", deck()).unwrap();
    let fresh = chats.new_thread(Some("c1")).unwrap();
    assert_eq!(fresh.bound, Some(deck()));
    assert_eq!(
        bound_to(&chats, &deck()).as_deref(),
        Some(fresh.id.as_str())
    );
    let ids: Vec<String> = chats.list().into_iter().map(|t| t.id).collect();
    assert!(ids.contains(&"c1".to_owned()), "the old chat is kept");
    assert!(
        chats
            .list()
            .iter()
            .find(|t| t.id == "c1")
            .unwrap()
            .bound
            .is_none()
    );
}

#[test]
fn the_browsers_remembered_decks_are_imported_once_and_never_overwrite() {
    let (_v, _data, chats) = two_chats();
    let map: HashMap<String, String> = [
        ("library/a.deck", "c1"),
        ("library/b.deck", "c2"),
        ("library/lost.deck", "lost"),
    ]
    .iter()
    .map(|(a, b)| ((*a).to_owned(), (*b).to_owned()))
    .collect();
    let first = chats.import_bindings("deck", &map);
    assert_eq!((first.bound, first.missing, first.kept), (2, 1, 0));
    assert_eq!(bound_to(&chats, &deck()).as_deref(), Some("c1"));
    assert_eq!(
        bound_to(&chats, &target("deck", "library/b.deck", None)).as_deref(),
        Some("c2")
    );
    // The second run changes nothing.
    let second = chats.import_bindings("deck", &map);
    assert_eq!((second.bound, second.missing, second.kept), (0, 1, 2));
    // A thread that is tied elsewhere, or a deck that has a thread, is left alone.
    let crossed: HashMap<String, String> = [
        ("library/c.deck".to_owned(), "c1".to_owned()),
        ("library/a.deck".to_owned(), "c2".to_owned()),
    ]
    .into();
    let third = chats.import_bindings("deck", &crossed);
    assert_eq!((third.bound, third.kept), (0, 2));
    assert_eq!(bound_to(&chats, &deck()).as_deref(), Some("c1"));
    let wire = serde_json::to_value(third).unwrap();
    assert!(wire["bound"].is_u64() && wire["missing"].is_u64() && wire["kept"].is_u64());
}
