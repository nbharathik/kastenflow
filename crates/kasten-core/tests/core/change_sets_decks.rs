//! Change sets with decks and pictures: an edit chain on one deck, a person's
//! edit made meanwhile, a deck made and then changed before anything is
//! applied, and pictures held in the cache until they are applied.

use std::fs;

use kasten_core::agent::{AgentOp, ApplyOutcome, ChangeSet};
use kasten_core::history::Actor;
use kasten_core::{Kasten, Outcome};
use serde_json::{Value, json};

use crate::change_sets::{WELCOME, append, create, snapshot, stage};
use crate::common::NOW;
use crate::deck_support::{self, SIX, deck, edit, with_slide};

fn applied(outcome: ApplyOutcome) -> (String, Vec<String>) {
    match outcome {
        ApplyOutcome::Applied { commit, paths } => (commit.expect("a commit"), paths),
        stale => panic!("expected it to apply, got {stale:?}"),
    }
}

/// `text` with a picture on its first slide.
fn with_picture(text: &str, src: &str) -> String {
    let mut value: Value = serde_json::from_str(text).unwrap();
    value["slides"][0]["elements"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "id": "e-pic", "type": "image", "src": src }));
    let mut out = serde_json::to_string_pretty(&value).unwrap();
    out.push('\n');
    out
}

fn make_deck(title: &str, text: &str) -> AgentOp {
    AgentOp::CreateDeck {
        title: title.into(),
        project: None,
        tool: "create_deck".into(),
        text: text.into(),
        sent: 100,
        marked: None,
    }
}

fn picture(seed: u8, len: usize) -> Vec<u8> {
    vec![seed; len]
}

#[test]
fn an_edit_chain_starts_from_the_deck_and_ends_at_the_last_edit() {
    let (_t, k, s, path, text) = deck_support::open();
    let mut set = k.begin_changes(&s, NOW);
    let one = with_slide(&text, "g", "Appendix");
    let told = stage(&k, &mut set, &s, &edit(&path, &text, &one));
    assert_eq!(told["changed"], true);
    // The next edit was made to the staged deck, which is what the tool read.
    let two = with_slide(&one, "h", "Extra");
    stage(&k, &mut set, &s, &edit(&path, &one, &two));
    let file = &set.files[&path];
    assert_eq!(file.base, text, "the base is the deck as the vault had it");
    assert_eq!(file.text, two, "and the text is the last edit");
    assert_eq!(set.steps.len(), 2);
    assert_eq!(k.deck_in(&set, &path).unwrap().text, two);
    assert_eq!(
        k.deck(&path).unwrap().text,
        text,
        "the vault still has the first"
    );
    // Saying what is already so stages nothing more.
    let told = stage(&k, &mut set, &s, &edit(&path, &two, &two));
    assert_eq!(told["changed"], false);
    assert_eq!(set.steps.len(), 2);
}

#[test]
fn what_is_staged_for_a_deck_is_what_the_op_writes() {
    let (_a, direct, ds, path, text) = deck_support::open();
    let (_b, staging, ss, _, _) = deck_support::open();
    let changed = with_slide(&text, "g", "Appendix");
    let op = edit(&path, &text, &changed);
    let mut set = staging.begin_changes(&ss, NOW);
    stage(&staging, &mut set, &ss, &op);
    assert!(matches!(
        direct.agent_run(&ds, &op, NOW).unwrap(),
        Outcome::Done { .. }
    ));
    assert_eq!(
        set.text_of(&path).unwrap(),
        direct.deck(&path).unwrap().text
    );
    // A new deck is made at the path the real op would give it.
    let made = make_deck("Fresh deck", &deck("Fresh deck", &SIX[..2]));
    let told = stage(&staging, &mut set, &ss, &made);
    let Outcome::Done { result } = direct.agent_run(&ds, &made, NOW).unwrap() else {
        panic!()
    };
    assert_eq!(told["path"], result["path"]);
    let new = result["path"].as_str().unwrap();
    assert_eq!(set.text_of(new).unwrap(), direct.deck(new).unwrap().text);
}

#[test]
fn a_persons_edit_to_another_slide_is_kept_when_the_set_is_applied() {
    let (_t, k, s, path, text) = deck_support::open();
    let mut set = k.begin_changes(&s, NOW);
    let staged = text.replace("\"Thanks\"", "\"Thanks (staged)\"");
    stage(&k, &mut set, &s, &edit(&path, &text, &staged));
    // A person changes the first slide meanwhile.
    let current = k.deck(&path).unwrap();
    let theirs = text.replace("\"Intro\"", "\"Introduction\"");
    k.save_deck(&Actor::Human, &path, &theirs, &current.hash, NOW)
        .unwrap();
    applied(k.apply_changes(&set, "Ada", NOW).unwrap());
    let result = k.deck(&path).unwrap().text;
    assert!(result.contains("Introduction") && result.contains("Thanks (staged)"));
}

#[test]
fn a_person_changing_the_same_slide_makes_the_set_stale() {
    let (_t, k, s, path, text) = deck_support::open();
    let mut set = k.begin_changes(&s, NOW);
    stage(&k, &mut set, &s, &append(WELCOME, "also in the set"));
    let staged = text.replace("\"Thanks\"", "\"Thanks (staged)\"");
    stage(&k, &mut set, &s, &edit(&path, &text, &staged));
    let current = k.deck(&path).unwrap();
    let theirs = text.replace("\"Thanks\"", "\"Merci\"");
    k.save_deck(&Actor::Human, &path, &theirs, &current.hash, NOW)
        .unwrap();
    let before = k.read(WELCOME).unwrap().text;
    let ApplyOutcome::Stale { files } = k.apply_changes(&set, "Ada", NOW).unwrap() else {
        panic!("expected it to be stale")
    };
    assert_eq!(files, std::slice::from_ref(&path));
    assert_eq!(k.read(WELCOME).unwrap().text, before);
    assert!(k.deck(&path).unwrap().text.contains("Merci"));
}

#[test]
fn a_new_deck_can_be_changed_again_before_anything_is_applied() {
    let (t, k, s, _, _) = deck_support::open();
    let mut set = k.begin_changes(&s, NOW);
    let first = deck("Brand new", &SIX[..2]);
    let told = stage(&k, &mut set, &s, &make_deck("Brand new", &first));
    let path = told["path"].as_str().unwrap().to_owned();
    assert!(!t.vault.exists(&path));
    let second = with_slide(&first, "z", "Last");
    stage(&k, &mut set, &s, &edit(&path, &first, &second));
    assert_eq!(set.created_files.len(), 1, "one new deck, not two");
    assert_eq!(k.staged_decks(&set).len(), 1);
    assert_eq!(k.staged_decks(&set)[0].slides, 3);
    let (_, paths) = applied(k.apply_changes(&set, "Ada", NOW).unwrap());
    assert_eq!(paths, std::slice::from_ref(&path));
    assert_eq!(k.deck(&path).unwrap().text, second);
}

#[test]
fn a_text_that_is_not_a_deck_is_refused() {
    let (_t, k, s, path, text) = deck_support::open();
    let mut set = k.begin_changes(&s, NOW);
    assert!(
        k.stage(&mut set, &s, &edit(&path, &text, "not a deck"), NOW)
            .is_err()
    );
    assert!(k.stage(&mut set, &s, &make_deck("Bad", "{}"), NOW).is_err());
    assert!(set.is_empty());
}

#[test]
fn pictures_stay_in_the_cache_until_the_set_is_applied() {
    let (t, k, s, path, text) = deck_support::open();
    let before = snapshot(t.vault.root());
    let mut set = k.begin_changes(&s, NOW);
    let bytes = picture(7, 4096);
    let at = k
        .stage_asset(&mut set, &s, "Figure One.png", &bytes, NOW)
        .unwrap();
    assert_eq!(at, "assets/figure-one.png");
    assert_eq!(k.staged_asset_bytes(&set, &at).unwrap().unwrap(), bytes);
    // The same picture again is the same asset, and a staged deck can name it.
    assert_eq!(
        k.stage_asset(&mut set, &s, "again.png", &bytes, NOW)
            .unwrap(),
        at
    );
    assert_eq!(set.assets.len(), 1);
    stage(
        &k,
        &mut set,
        &s,
        &edit(&path, &text, &with_picture(&text, &at)),
    );
    assert_eq!(
        snapshot(t.vault.root()),
        before,
        "nothing in assets/ or the vault"
    );
    assert!(!t.vault.root().join(&at).exists());

    let (_, paths) = applied(k.apply_changes(&set, "Ada", NOW).unwrap());
    assert!(paths.contains(&at) && paths.contains(&path), "{paths:?}");
    assert_eq!(fs::read(t.vault.root().join(&at)).unwrap(), bytes);
    assert!(
        t.vault
            .root()
            .join("assets/.meta/figure-one.png.json")
            .exists()
            || paths.iter().any(|p| p.ends_with("figure-one.png.json")),
        "{paths:?}"
    );
    assert!(
        k.deck(&path)
            .unwrap()
            .text
            .contains("assets/figure-one.png")
    );
}

#[test]
fn a_picture_name_taken_meanwhile_is_followed_in_the_texts() {
    let (t, k, s, path, text) = deck_support::open();
    let mut set = k.begin_changes(&s, NOW);
    let at = k
        .stage_asset(&mut set, &s, "figure.png", &picture(1, 100), NOW)
        .unwrap();
    assert_eq!(at, "assets/figure.png");
    stage(
        &k,
        &mut set,
        &s,
        &edit(&path, &text, &with_picture(&text, &at)),
    );
    stage(
        &k,
        &mut set,
        &s,
        &create("Notes on it", &format!("See ![the figure]({at}).\n")),
    );
    // A person adds another picture under that name first.
    k.add_asset(
        &Actor::Human,
        "figure.png",
        &picture(2, 100),
        &kasten_core::assets::NewAsset::default(),
        NOW,
    )
    .unwrap();
    applied(k.apply_changes(&set, "Ada", NOW).unwrap());
    assert_eq!(
        fs::read(t.vault.root().join("assets/figure.png")).unwrap(),
        picture(2, 100)
    );
    assert_eq!(
        fs::read(t.vault.root().join("assets/figure-2.png")).unwrap(),
        picture(1, 100)
    );
    assert!(k.deck(&path).unwrap().text.contains("assets/figure-2.png"));
    let note = t.vault.read("library/notes-on-it.md").unwrap().text;
    assert!(note.contains("(assets/figure-2.png)"), "{note}");
}

#[test]
fn pictures_are_held_to_the_limits_when_staged_and_not_again_when_applied() {
    let (_t, k, s, _, _) = deck_support::open();
    let mut config = k.config();
    config.guardrails.max_asset_bytes = 1024;
    config.guardrails.max_assets_per_session_10min = 2;
    k.set_config(config).unwrap();
    let mut set: ChangeSet = k.begin_changes(&s, NOW);
    let err = k
        .stage_asset(&mut set, &s, "big.png", &picture(1, 2048), NOW)
        .unwrap_err();
    assert!(err.to_string().contains("at most 1.0 KB"), "{err}");
    k.stage_asset(&mut set, &s, "a.png", &picture(2, 100), NOW)
        .unwrap();
    k.stage_asset(&mut set, &s, "b.png", &picture(3, 100), NOW)
        .unwrap();
    let err = k
        .stage_asset(&mut set, &s, "c.png", &picture(4, 100), NOW)
        .unwrap_err();
    assert!(err.to_string().contains("last 10 minutes"), "{err}");
    assert_eq!(set.assets.len(), 2);
    // Applying is the person's approval: the two pictures are kept.
    let (_, paths) = applied(k.apply_changes(&set, "Ada", NOW).unwrap());
    assert!(
        paths.contains(&"assets/a.png".to_owned()) && paths.contains(&"assets/b.png".to_owned())
    );
}

#[test]
fn a_set_with_only_a_picture_applies_and_discarding_it_leaves_no_trace() {
    let (t, k, s, _, _) = deck_support::open();
    let before = snapshot(t.vault.root());
    let mut gone = k.begin_changes(&s, NOW);
    k.stage_asset(&mut gone, &s, "gone.png", &picture(9, 50), NOW)
        .unwrap();
    k.discard_changes(&gone).unwrap();
    assert_eq!(snapshot(t.vault.root()), before);
    assert!(
        !t.vault
            .root()
            .join(".kasten/cache/changes")
            .join(&gone.id)
            .exists()
    );
    let _unused: &Kasten = &k;
}
