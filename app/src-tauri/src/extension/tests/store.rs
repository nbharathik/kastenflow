//! The paired list: only a token's hash is kept, a token is found by its hash,
//! and what was paired comes back after a restart.

use std::fs;
use std::path::PathBuf;

use super::super::store::{FILE, MOST, Paired, Store, hash, new_id, new_token, same};

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join(format!("kasten-ext-store-{}", std::process::id()))
        .join(name);
    let _ = fs::remove_dir_all(&dir);
    dir
}

fn paired(origin: &str, token: &str) -> Paired {
    Paired {
        id: new_id().unwrap(),
        label: "Edge".to_owned(),
        origin: origin.to_owned(),
        token_hash: hash(token),
        paired_at: 1_790_000_000_000,
    }
}

const ONE: &str = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

#[test]
fn a_token_is_43_characters_and_never_the_same_twice() {
    let a = new_token().unwrap();
    let b = new_token().unwrap();
    assert_eq!(a.len(), 43);
    assert!(
        a.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    );
    assert_ne!(a, b);
    assert_eq!(new_id().unwrap().len(), 8);
}

#[test]
fn a_hash_is_sha256_in_hex() {
    // The well-known SHA-256 of "abc".
    assert_eq!(
        hash("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert!(same(b"abc", b"abc") && !same(b"abc", b"abd") && !same(b"abc", b"ab"));
}

#[test]
fn what_is_paired_is_kept_as_a_hash_and_comes_back() {
    let dir = scratch("keep");
    let mut store = Store::load(Some(dir.clone()));
    assert!(store.is_empty());
    let token = new_token().unwrap();
    store.add(paired(ONE, &token)).unwrap();
    let text = fs::read_to_string(dir.join(FILE)).unwrap();
    assert!(!text.contains(&token), "the token is never written: {text}");
    assert!(text.contains(&hash(&token)));

    let again = Store::load(Some(dir));
    assert_eq!(again.find(&token).unwrap().origin, ONE);
    assert!(again.find("not the token").is_none());
    assert!(again.find("").is_none());
    let infos = again.infos();
    assert_eq!(infos.len(), 1);
    let shown = serde_json::to_string(&infos).unwrap();
    assert!(
        !shown.contains(&hash(&token)),
        "what Settings shows has no hash"
    );
}

#[test]
fn pairing_again_from_the_same_origin_replaces_the_token() {
    let dir = scratch("replace");
    let mut store = Store::load(Some(dir));
    store.add(paired(ONE, "first")).unwrap();
    store.add(paired(ONE, "second")).unwrap();
    assert_eq!(store.infos().len(), 1);
    assert!(store.find("first").is_none());
    assert!(store.find("second").is_some());
}

#[test]
fn only_so_many_extensions_pair_at_once() {
    let dir = scratch("most");
    let mut store = Store::load(Some(dir));
    for n in 0..MOST {
        store
            .add(paired(
                &format!("chrome-extension://{n:a>32}"),
                &n.to_string(),
            ))
            .unwrap();
    }
    assert!(!store.has_room_for("chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"));
    let refused = store.add(paired(
        "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        "x",
    ));
    assert!(refused.unwrap_err().contains("Revoke one"));
    assert_eq!(store.infos().len(), MOST);
    // One already paired may pair again.
    assert!(store.has_room_for(&format!("chrome-extension://{:a>32}", 0)));
}

#[test]
fn revoking_takes_the_token_away_for_good() {
    let dir = scratch("revoke");
    let mut store = Store::load(Some(dir.clone()));
    store.add(paired(ONE, "kept-token")).unwrap();
    store
        .add(paired(
            "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "gone",
        ))
        .unwrap();
    let id = store
        .infos()
        .into_iter()
        .find(|p| p.origin.contains("bbbb"))
        .unwrap()
        .id;
    assert!(store.revoke(&id).unwrap());
    assert!(!store.revoke(&id).unwrap(), "already gone");
    assert!(store.find("gone").is_none());
    assert!(store.find("kept-token").is_some());
    // Also after a restart.
    let again = Store::load(Some(dir));
    assert!(again.find("gone").is_none() && again.find("kept-token").is_some());
}

#[test]
fn a_file_that_cannot_be_read_pairs_nobody_and_nothing_is_kept_without_a_folder() {
    let dir = scratch("broken");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(FILE), "{ not json").unwrap();
    assert!(Store::load(Some(dir)).is_empty());

    let mut nowhere = Store::load(None);
    assert!(nowhere.add(paired(ONE, "t")).is_err());
    assert!(
        nowhere.is_empty(),
        "a pairing that could not be kept is not kept"
    );
}
