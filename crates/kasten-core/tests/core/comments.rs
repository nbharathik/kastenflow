//! Tests for page comments kept in a sidecar file: the ops, what they refuse,
//! what verify reports. A page's comments travel with it in `comments/travel.rs`.

mod travel;

use std::fs;

use crate::common::{self, NOW, dev_vault};
use kasten_core::comments::{Anchor, Comment, NewComment};
use kasten_core::history::Actor;
use kasten_core::{Instant, Kasten, Kind, NewNote, NoteFile};

pub(crate) fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

pub(crate) fn page(k: &Kasten, title: &str) -> NoteFile {
    k.create(
        &Actor::Human,
        &NewNote {
            kind: Kind::Page,
            title: title.to_owned(),
            date: "2026-10-10".to_owned(),
            project: None,
            parent: None,
            template: None,
            icon: None,
        },
        NOW,
    )
    .unwrap()
}

pub(crate) fn at(section: &str, nth: u32) -> Anchor {
    Anchor {
        section: section.to_owned(),
        nth,
        quote: None,
        prefix: None,
        suffix: None,
    }
}

pub(crate) fn say(k: &Kasten, page: &str, text: &str) -> Comment {
    let new = NewComment {
        anchor: at("Method", 1),
        text: text.to_owned(),
    };
    k.add_comment(&Actor::Human, page, &new, NOW).unwrap()
}

pub(crate) fn agent() -> Actor {
    Actor::Agent {
        client: "claude-code".to_owned(),
        session: "s1".to_owned(),
    }
}

pub(crate) fn later(minutes: u64) -> Instant {
    Instant {
        millis: NOW.millis + minutes * 60_000,
    }
}

pub(crate) fn sidecar(page: &NoteFile) -> String {
    page.meta.path.replace(".md", ".comments.json")
}

#[test]
fn adding_a_comment_writes_the_sidecar_and_leaves_the_page_alone() {
    let (t, k) = open();
    let p = page(&k, "Trip plan");
    let file = t.vault.root().join(sidecar(&p));
    assert!(!file.exists());
    assert!(k.comments(&p.meta.path).unwrap().is_empty());

    let mut new = NewComment {
        anchor: at("Method", 1),
        text: "Enough for crops?".to_owned(),
    };
    new.anchor.quote = Some("perceptual hash".to_owned());
    let added = k
        .add_comment(&Actor::Human, &p.meta.path, &new, NOW)
        .unwrap();
    assert_eq!(added.author, "you");
    assert!(added.id.starts_with("c-"));
    assert_eq!(added.anchor.quote.as_deref(), Some("perceptual hash"));

    // Not a byte of the page changed, and the file is a comment to a line.
    assert_eq!(k.read(&p.meta.path).unwrap().text, p.text);
    let text = fs::read_to_string(&file).unwrap();
    assert!(text.contains("\"format\": \"kasten-comments\""), "{text}");
    assert_eq!(text.lines().filter(|l| l.contains("\"id\"")).count(), 1);
    assert_eq!(
        k.comments(&p.meta.path).unwrap(),
        std::slice::from_ref(&added)
    );
    assert_eq!(k.log(None, 1).unwrap()[0].summary, "comment: Trip plan");

    // Two more, in order; the sidecar is one commit each.
    let second = say(&k, &p.meta.path, "Second");
    let third = k
        .add_comment(&Actor::Human, &p.meta.path, &new, later(1))
        .unwrap();
    let ids: Vec<String> = k
        .comments(&p.meta.path)
        .unwrap()
        .into_iter()
        .map(|c| c.id)
        .collect();
    assert_eq!(ids, [added.id, second.id, third.id]);
    assert_eq!(k.revision().annotations, 3);
}

#[test]
fn undo_takes_a_comment_back() {
    let (t, k) = open();
    let p = page(&k, "Trip plan");
    say(&k, &p.meta.path, "First");
    let file = t.vault.root().join(sidecar(&p));
    assert!(file.is_file());
    let commit = k.log(None, 1).unwrap()[0].id.clone();
    let undone = k.undo_commit(&commit, NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert!(!file.exists());
    assert!(k.comments(&p.meta.path).unwrap().is_empty());
}

#[test]
fn resolving_reopening_and_moving_a_comment() {
    let (_t, k) = open();
    let p = page(&k, "Trip plan");
    let c = say(&k, &p.meta.path, "Check this");
    let log = |k: &Kasten| k.log(None, 1).unwrap()[0].clone();

    let done = k
        .resolve_comment(&Actor::Human, &p.meta.path, &c.id, true, later(1))
        .unwrap();
    let resolved = done.resolved.clone().unwrap();
    assert_eq!(resolved.by, "you");
    assert_eq!(log(&k).summary, "comment: Trip plan (resolved)");

    // Saying what is already so writes and commits nothing.
    let before = log(&k).id;
    let again = k
        .resolve_comment(&Actor::Human, &p.meta.path, &c.id, true, later(2))
        .unwrap();
    assert_eq!(again.resolved.unwrap().at, resolved.at);
    assert_eq!(log(&k).id, before);

    let open = k
        .resolve_comment(&Actor::Human, &p.meta.path, &c.id, false, later(3))
        .unwrap();
    assert!(open.resolved.is_none());
    assert_eq!(log(&k).summary, "comment: Trip plan (reopened)");

    let mut to = at("Results", 2);
    to.quote = Some("new words".to_owned());
    let moved = k
        .reanchor_comment(&Actor::Human, &p.meta.path, &c.id, &to, later(4))
        .unwrap();
    assert_eq!(moved.anchor, to);
    assert_eq!(log(&k).summary, "comment: Trip plan (moved)");
    assert_eq!(k.comments(&p.meta.path).unwrap()[0].anchor, to);

    assert!(
        k.resolve_comment(&Actor::Human, &p.meta.path, "c-nope", true, NOW)
            .is_err()
    );
}

#[test]
fn keys_the_app_does_not_know_survive_every_op() {
    let (t, k) = open();
    let p = page(&k, "Trip plan");
    let file = t.vault.root().join(sidecar(&p));
    fs::write(
        &file,
        r#"{"format": "kasten-comments", "zzz": {"keep": true}, "comments": [
  {"id": "c-x", "anchor": {"section": "A", "nth": 1, "future": 1}, "text": "hand written", "author": "someone", "extra": "kept"}
]}"#,
    )
    .unwrap();
    k.resolve_comment(&Actor::Human, &p.meta.path, "c-x", true, NOW)
        .unwrap();
    say(&k, &p.meta.path, "More");
    let text = fs::read_to_string(&file).unwrap();
    for kept in [
        "\"zzz\": {\"keep\": true}",
        "\"extra\": \"kept\"",
        "\"future\": 1",
    ] {
        assert!(text.contains(kept), "{kept} in {text}");
    }
    assert_eq!(k.comments(&p.meta.path).unwrap().len(), 2);
}

#[test]
fn a_broken_file_is_not_written_over() {
    let (t, k) = open();
    let p = page(&k, "Trip plan");
    let file = t.vault.root().join(sidecar(&p));
    fs::write(&file, "not json at all").unwrap();
    assert!(k.comments(&p.meta.path).is_err());
    let new = NewComment {
        anchor: at("", 1),
        text: "x".to_owned(),
    };
    assert!(
        k.add_comment(&Actor::Human, &p.meta.path, &new, NOW)
            .is_err()
    );
    assert_eq!(fs::read_to_string(&file).unwrap(), "not json at all");
}

#[test]
fn only_a_page_in_the_vault_can_be_commented_on() {
    let (_t, k) = open();
    let new = NewComment {
        anchor: at("", 1),
        text: "x".to_owned(),
    };
    for path in [
        "library/no-such-page.md",
        ".trash/20260101T000000Z/library/old.md",
        "library/not-a-page.canvas",
    ] {
        assert!(
            k.add_comment(&Actor::Human, path, &new, NOW).is_err(),
            "{path}"
        );
        assert!(k.comments(path).is_err(), "{path}");
    }
    let template = k
        .list()
        .unwrap()
        .into_iter()
        .find(|n| n.path.starts_with("templates/"))
        .expect("the dev vault has templates");
    assert!(
        k.add_comment(&Actor::Human, &template.path, &new, NOW)
            .is_err()
    );
    // And what is asked of a comment is checked.
    let p = page(&k, "Trip plan");
    for bad in [
        NewComment {
            anchor: at("", 1),
            text: "   ".to_owned(),
        },
        NewComment {
            anchor: at("", 0),
            text: "x".to_owned(),
        },
    ] {
        assert!(
            k.add_comment(&Actor::Human, &p.meta.path, &bad, NOW)
                .is_err()
        );
    }
}

#[test]
fn agents_comment_where_they_may_write() {
    let (t, k) = open();
    let p = page(&k, "Trip plan");
    let new = NewComment {
        anchor: at("Method", 1),
        text: "Please check".to_owned(),
    };
    let said = k.add_comment(&agent(), &p.meta.path, &new, NOW).unwrap();
    assert_eq!(said.author, "agent:claude-code");
    // An agent can resolve too, and signs it.
    let done = k
        .resolve_comment(&agent(), &p.meta.path, &said.id, true, later(1))
        .unwrap();
    assert_eq!(done.resolved.unwrap().by, "agent:claude-code");

    // A locked page is read-only for agents, comments included; a person may.
    let file = t.vault.path_of(&p.meta.path).unwrap();
    let text = fs::read_to_string(&file)
        .unwrap()
        .replacen("---\n", "---\nlocked: true\n", 1);
    fs::write(&file, text).unwrap();
    k.reindex().unwrap();
    let err = k
        .add_comment(&agent(), &p.meta.path, &new, later(2))
        .unwrap_err();
    assert!(err.to_string().contains("locked"), "{err}");
    assert_eq!(k.comments(&p.meta.path).unwrap().len(), 1);
    assert!(
        k.add_comment(&Actor::Human, &p.meta.path, &new, later(3))
            .is_ok()
    );
}

#[test]
fn verify_reports_a_sidecar_whose_page_is_gone_and_one_it_cannot_read() {
    let (t, k) = open();
    let root = t.vault.root();
    let p = page(&k, "Trip plan");
    say(&k, &p.meta.path, "Fine");
    assert!(k.comment_problems().unwrap().is_empty());

    // Left behind by a page deleted outside the app.
    fs::write(
        root.join("library/gone.comments.json"),
        "{\"comments\": []}",
    )
    .unwrap();
    fs::write(
        root.join("library/gone.highlights.json"),
        "{\"highlights\": []}",
    )
    .unwrap();
    // A page whose file is not a comments file.
    let broken = page(&k, "Broken");
    fs::write(root.join(sidecar(&broken)), "[]").unwrap();
    // A PDF's highlights file is not a page's, orphan or not.
    fs::write(root.join("sources/nothing-here.highlights.json"), "{}").unwrap();

    let mut found: Vec<(String, String)> = k
        .comment_problems()
        .unwrap()
        .into_iter()
        .map(|p| (p.kind, p.path.unwrap()))
        .collect();
    found.sort();
    assert_eq!(
        found,
        [
            ("comments".to_owned(), sidecar(&broken)),
            (
                "comments-orphan".to_owned(),
                "library/gone.comments.json".to_owned()
            ),
            (
                "highlights-orphan".to_owned(),
                "library/gone.highlights.json".to_owned()
            ),
        ]
    );
}
