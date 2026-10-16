//! Adding one tag to many notes: what dropping pages on a tag's gallery or
//! "Add existing pages" does. One commit that Undo takes back whole; a note
//! that has the tag is left as it is; nothing moves and no other property
//! changes; a request that cannot be met writes nothing.

use std::fs;

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::history::Actor;
use kasten_core::{Error, Kasten};

const A: &str = "library/zettelkasten-method.md";
const B: &str = "library/seaside-trip.md";
const C: &str = "projects/photo-organiser/pages/photo-organiser-roadmap.md";

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn text_of(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

fn paths(list: &[&str]) -> Vec<String> {
    list.iter().map(|p| (*p).to_owned()).collect()
}

fn commits(k: &Kasten) -> usize {
    k.log(None, 1000).unwrap().len()
}

fn tagged(k: &Kasten, path: &str, tag: &str) -> bool {
    k.read(path)
        .unwrap()
        .meta
        .tags
        .iter()
        .any(|t| t.eq_ignore_ascii_case(tag))
}

#[test]
fn adds_the_tag_to_every_note_in_one_commit_that_undo_takes_back() {
    let (t, k) = open();
    let before: Vec<String> = [A, B, C].iter().map(|p| text_of(&t, p)).collect();
    let n = commits(&k);
    let revised = k.revision().notes;
    let added = k
        .add_tag_to_many(&Actor::Human, &paths(&[A, B, C]), "reading", NOW)
        .unwrap();
    assert_eq!(added.tag, "reading");
    assert_eq!(added.changed.len(), 3);
    assert!(added.already.is_empty());
    for p in [A, B, C] {
        assert!(tagged(&k, p, "reading"), "{p}");
    }
    assert_eq!(commits(&k), n + 1);
    let log = k.log(None, 1).unwrap();
    assert_eq!(log[0].summary, "tags: add #reading to 3 notes");
    assert_eq!(added.commit.as_deref(), Some(log[0].id.as_str()));
    assert_eq!(
        k.revision().notes,
        revised + 1,
        "one change, however many notes"
    );

    // Undo takes all three back, byte for byte.
    k.undo_commit(&log[0].id, NOW).unwrap();
    for (p, was) in [A, B, C].iter().zip(&before) {
        assert_eq!(&text_of(&t, p), was, "{p}");
    }
}

#[test]
fn nothing_moves_and_only_the_tags_and_the_updated_day_change() {
    let (t, k) = open();
    let before = text_of(&t, A);
    k.add_tag_to_many(&Actor::Human, &paths(&[A]), "#Reading", NOW)
        .unwrap();
    let after = text_of(&t, A);
    assert!(t.vault.root().join(A).exists());
    // Every line that is not the same in both is the tags or the updated day.
    let gone: Vec<&str> = before
        .lines()
        .filter(|l| !after.lines().any(|a| a == *l))
        .collect();
    let new: Vec<&str> = after
        .lines()
        .filter(|l| !before.lines().any(|b| b == *l))
        .collect();
    assert!(!new.is_empty());
    for line in gone.iter().chain(&new) {
        assert!(
            line.starts_with("tags:") || line.starts_with("updated:"),
            "{line}"
        );
    }
    let body = |text: &str| text.split_once("\n---\n").unwrap().1.to_owned();
    assert_eq!(body(&before), body(&after));
    // The tag is written as given, without the #.
    assert!(k.read(A).unwrap().meta.tags.contains(&"Reading".to_owned()));
}

#[test]
fn a_note_that_has_the_tag_is_left_alone_and_a_repeat_changes_nothing() {
    let (t, k) = open();
    k.add_tag_to_many(&Actor::Human, &paths(&[A]), "reading", NOW)
        .unwrap();
    let a_text = text_of(&t, A);
    let n = commits(&k);
    // A has it (in another case), B and C do not; A listed twice counts once.
    let added = k
        .add_tag_to_many(&Actor::Human, &paths(&[A, B, A, C]), "READING", NOW)
        .unwrap();
    assert_eq!(added.already, [A]);
    assert_eq!(
        added
            .changed
            .iter()
            .map(|m| m.path.as_str())
            .collect::<Vec<_>>(),
        [B, C]
    );
    assert_eq!(text_of(&t, A), a_text);
    assert_eq!(commits(&k), n + 1);

    // Everything is there already: no write, no commit.
    let n = commits(&k);
    let again = k
        .add_tag_to_many(&Actor::Human, &paths(&[A, B, C]), "reading", NOW)
        .unwrap();
    assert!(again.changed.is_empty());
    assert_eq!(again.already.len(), 3);
    assert_eq!(again.commit, None);
    assert_eq!(commits(&k), n);
}

#[test]
fn a_request_that_cannot_be_met_writes_nothing() {
    let (t, k) = open();
    let before: Vec<String> = [A, B].iter().map(|p| text_of(&t, p)).collect();
    let n = commits(&k);
    // One missing note refuses the whole.
    let err = k
        .add_tag_to_many(
            &Actor::Human,
            &paths(&[A, "library/nowhere.md", B]),
            "reading",
            NOW,
        )
        .unwrap_err();
    assert!(matches!(err, Error::NotFound(_)), "{err:?}");
    // Not a note path, a path out of the vault, and bad tags.
    for bad in [
        "tags/task.yaml",
        "../outside.md",
        "library/../../x.md",
        ".kasten/config.yaml",
        "",
    ] {
        assert!(
            k.add_tag_to_many(&Actor::Human, &paths(&[A, bad]), "reading", NOW)
                .is_err(),
            "{bad:?}"
        );
    }
    for tag in [
        "",
        "  ",
        "#",
        "two words",
        "a,b",
        "[x]",
        "x:y",
        "new\nline",
        &"t".repeat(41),
    ] {
        let err = k
            .add_tag_to_many(&Actor::Human, &paths(&[A]), tag, NOW)
            .unwrap_err();
        assert!(matches!(err, Error::Invalid(_)), "{tag:?}");
    }
    let many: Vec<String> = (0..501).map(|n| format!("library/n{n}.md")).collect();
    assert!(
        k.add_tag_to_many(&Actor::Human, &many, "reading", NOW)
            .is_err()
    );
    assert!(
        k.add_tag_to_many(&Actor::Human, &[], "reading", NOW)
            .is_err()
    );
    assert_eq!(commits(&k), n);
    for (p, was) in [A, B].iter().zip(&before) {
        assert_eq!(&text_of(&t, p), was);
    }
}

#[test]
fn an_agent_keeps_to_the_places_it_may_write() {
    let (t, k) = open();
    let agent = Actor::Agent {
        client: "test".into(),
        session: "S".into(),
    };
    let n = commits(&k);
    let template = "templates/page.md";
    let before = text_of(&t, template);
    assert!(
        k.add_tag_to_many(&agent, &paths(&[A, template]), "reading", NOW)
            .is_err()
    );
    assert_eq!(text_of(&t, template), before);
    assert!(!tagged(&k, A, "reading"));
    assert_eq!(commits(&k), n);
    // Where it may write, it may add a tag.
    k.add_tag_to_many(&agent, &paths(&[A, B]), "reading", NOW)
        .unwrap();
    assert!(tagged(&k, A, "reading") && tagged(&k, B, "reading"));
}
