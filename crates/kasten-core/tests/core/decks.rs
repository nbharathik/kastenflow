//! Slide decks (`.deck`) on disk and through the engine. Core keeps a deck
//! as the editor wrote it: it checks the envelope, never rewrites the
//! text, and never replaces a file it did not read: a save with a stale
//! hash goes to a copy beside it.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::deck::{self, DeckSaved};
use kasten_core::history::Actor;
use kasten_core::{DeckEdit, Error, Kasten, SaveDecksRequest, content_hash};
use serde_json::json;

const PROJECT: &str = "photo-organiser";

/// A deck as slides-core writes it: sorted keys, two-space indent.
fn deck_text(title: &str, slides: usize) -> String {
    let slides: Vec<_> = (0..slides)
        .map(|i| json!({ "id": format!("s-{i:08}"), "layout": "title-body", "elements": [] }))
        .collect();
    let mut text = serde_json::to_string_pretty(&json!({
        "format": "kasten-deck",
        "formatVersion": 1,
        "id": "d-4b1e0x9a",
        "title": title,
        "size": { "w": 960, "h": 540 },
        "slides": slides,
    }))
    .unwrap();
    text.push('\n');
    text
}

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    // The dev vault keeps a sample deck of its own; these tests count the decks they make.
    // Only this test's private copy of the vault loses it.
    fs::remove_file(
        t.vault
            .root()
            .join("library/tool-use-in-language-models.deck"),
    )
    .unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn invalid<T: std::fmt::Debug>(result: Result<T, Error>) -> String {
    match result {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected Error::Invalid, got {other:?}"),
    }
}

#[test]
fn the_envelope_is_checked_and_the_head_read() {
    let head = deck::head_of(&deck_text("Tool use", 3)).unwrap();
    assert_eq!(head.title.as_deref(), Some("Tool use"));
    assert_eq!((head.slides, head.version), (3, 1));

    // Fields it does not know are none of its business.
    let newer = json!({ "format": "kasten-deck", "formatVersion": 7, "slides": [], "later": [1] });
    let head = deck::head_of(&newer.to_string()).unwrap();
    assert_eq!((head.title, head.slides, head.version), (None, 0, 7));

    for (text, why) in [
        ("", "not JSON"),
        ("[1]", "not a deck"),
        (
            r#"{"format":"canvas","formatVersion":1,"slides":[]}"#,
            "format",
        ),
        (r#"{"formatVersion":1,"slides":[]}"#, "format"),
        (r#"{"format":"kasten-deck","slides":[]}"#, "version"),
        (
            r#"{"format":"kasten-deck","formatVersion":0,"slides":[]}"#,
            "version",
        ),
        (
            r#"{"format":"kasten-deck","formatVersion":1.5,"slides":[]}"#,
            "version",
        ),
        (r#"{"format":"kasten-deck","formatVersion":1}"#, "slides"),
        (
            r#"{"format":"kasten-deck","formatVersion":1,"slides":{}}"#,
            "slides",
        ),
        (
            r#"{"format":"kasten-deck","formatVersion":1,"slides":[],"title":4}"#,
            "title",
        ),
    ] {
        let message = invalid(deck::head_of(text));
        assert!(
            message.starts_with("Not a KastenFlow deck"),
            "{text}: {message}"
        );
        assert!(message.contains(why), "{text}: {message}");
    }
}

#[test]
fn a_new_deck_goes_where_boards_go_and_never_replaces_one() {
    let t = dev_vault();
    let text = deck_text("Tool use", 1);
    let library = deck::create_deck(&t.vault, "Tool use", None, &text).unwrap();
    assert_eq!(library, "library/tool-use.deck");
    let again = deck::create_deck(&t.vault, "Tool use", None, &text).unwrap();
    assert_eq!(again, "library/tool-use-2.deck");
    let project = deck::create_deck(&t.vault, "Q3 review", Some(PROJECT), &text).unwrap();
    assert_eq!(project, "projects/photo-organiser/decks/q3-review.deck");
    // Byte for byte what the editor gave.
    let on_disk = fs::read_to_string(t.vault.root().join(&library)).unwrap();
    assert_eq!(on_disk, text);

    assert!(invalid(deck::create_deck(&t.vault, "X", Some("nope"), &text)).contains("nope"));
    assert!(invalid(deck::create_deck(&t.vault, "  ", None, &text)).contains("title"));
    assert!(invalid(deck::create_deck(&t.vault, "A|B", None, &text)).contains("title"));
    assert!(
        invalid(deck::create_deck(&t.vault, "X", None, "{}")).starts_with("Not a KastenFlow deck")
    );
    assert!(!t.vault.root().join("library/x.deck").exists());
}

#[test]
fn a_deck_is_read_with_the_hash_a_save_must_bring_back() {
    let t = dev_vault();
    let text = deck_text("Tool use", 2);
    let path = deck::create_deck(&t.vault, "Tool use", None, &text).unwrap();
    let read = deck::read_deck(&t.vault, &path).unwrap();
    assert_eq!(read.path, path);
    assert_eq!(read.text, text);
    assert_eq!(read.hash, content_hash(&text));
    assert!(read.modified > 0);

    assert!(matches!(
        deck::read_deck(&t.vault, "library/none.deck"),
        Err(Error::NotFound(_))
    ));
    for bad in [
        "../x.deck",
        "library/x.md",
        "/etc/x.deck",
        ".kasten/x.deck",
        "a\\b.deck",
    ] {
        assert!(
            matches!(deck::read_deck(&t.vault, bad), Err(Error::InvalidPath(_))),
            "{bad}"
        );
    }
    // Bytes that are not text are an error, not a lossy reading.
    fs::write(
        t.vault.root().join("library/binary.deck"),
        [0xff, 0xfe, 0x00],
    )
    .unwrap();
    assert!(deck::read_deck(&t.vault, "library/binary.deck").is_err());
}

#[cfg(unix)]
#[test]
fn a_deck_reached_through_a_link_is_refused() {
    let t = dev_vault();
    let outside = std::env::temp_dir().join(format!("kasten-deck-link-{}", std::process::id()));
    fs::write(&outside, deck_text("Outside", 0)).unwrap();
    std::os::unix::fs::symlink(&outside, t.vault.root().join("library/linked.deck")).unwrap();
    let read = deck::read_deck(&t.vault, "library/linked.deck");
    assert!(matches!(read, Err(Error::InvalidPath(_))), "{read:?}");
    let saved = deck::write_deck(
        &t.vault,
        "library/linked.deck",
        &deck_text("X", 0),
        "-",
        NOW,
    );
    assert!(matches!(saved, Err(Error::InvalidPath(_))), "{saved:?}");
    assert_eq!(
        fs::read_to_string(&outside).unwrap(),
        deck_text("Outside", 0)
    );
    fs::remove_file(&outside).unwrap();
}

#[test]
fn a_save_with_the_current_hash_is_written_and_a_stale_one_goes_to_a_copy() {
    let t = dev_vault();
    let first = deck_text("Tool use", 1);
    let path = deck::create_deck(&t.vault, "Tool use", None, &first).unwrap();
    let file = t.vault.root().join(&path);
    let h1 = content_hash(&first);

    // Same text: nothing to write.
    let same = deck::write_deck(&t.vault, &path, &first, &h1, NOW).unwrap();
    assert!(matches!(same, DeckSaved::Unchanged { .. }), "{same:?}");

    let second = deck_text("Tool use", 2);
    let DeckSaved::Written { deck } = deck::write_deck(&t.vault, &path, &second, &h1, NOW).unwrap()
    else {
        panic!("expected a write");
    };
    assert_eq!(deck.hash, content_hash(&second));
    assert_eq!(fs::read_to_string(&file).unwrap(), second);

    // Someone else changed the file (an agent, a sync): the editor's older
    // hash no longer matches, and its text goes beside the file.
    let mine = deck_text("Tool use", 5);
    let DeckSaved::Conflict { copy, deck } =
        deck::write_deck(&t.vault, &path, &mine, &h1, NOW).unwrap()
    else {
        panic!("expected a conflict");
    };
    assert_eq!(deck.text, second, "what is on disk stands");
    assert_eq!(fs::read_to_string(&file).unwrap(), second);
    let stamp = NOW.file_stamp();
    assert_eq!(copy, format!("library/tool-use (conflict {stamp}).deck"));
    assert_eq!(
        fs::read_to_string(t.vault.root().join(&copy)).unwrap(),
        mine
    );
    // A second conflict the same second gets a free name.
    let DeckSaved::Conflict { copy: other, .. } =
        deck::write_deck(&t.vault, &path, &mine, &h1, NOW).unwrap()
    else {
        panic!("expected a conflict");
    };
    assert_eq!(other, format!("library/tool-use (conflict {stamp} 2).deck"));
}

#[test]
fn a_save_that_is_not_a_deck_leaves_the_file_alone() {
    let t = dev_vault();
    let text = deck_text("Tool use", 1);
    let path = deck::create_deck(&t.vault, "Tool use", None, &text).unwrap();
    let hash = content_hash(&text);
    for bad in ["", "{}", "not json", &text.replace("kasten-deck", "other")] {
        let err = deck::write_deck(&t.vault, &path, bad, &hash, NOW);
        assert!(invalid(err).starts_with("Not a KastenFlow deck"));
    }
    assert_eq!(
        fs::read_to_string(t.vault.root().join(&path)).unwrap(),
        text
    );
    assert!(matches!(
        deck::write_deck(&t.vault, "library/none.deck", &text, &hash, NOW),
        Err(Error::NotFound(_))
    ));
}

#[test]
fn images_a_deck_uses_are_its_own_paths() {
    let text = json!({
        "format": "kasten-deck", "formatVersion": 1,
        "theme": { "master": [ { "type": "image", "src": "assets/logo.png" } ] },
        "slides": [
            { "elements": [
                { "type": "image", "src": "assets/a.png" },
                { "type": "text" },
                { "type": "group", "children": [ { "type": "image", "src": "assets/b.png" } ] },
                { "type": "image", "src": "" },
                { "type": "image", "src": "assets/a.png" }
            ] }
        ]
    })
    .to_string();
    assert_eq!(
        deck::images_of(&text),
        ["assets/a.png", "assets/b.png", "assets/logo.png"]
    );
    assert!(deck::images_of("nonsense").is_empty());
}

#[test]
fn decks_are_listed_by_title_with_their_project_and_size() {
    let (t, k) = open();
    assert!(k.decks().unwrap().is_empty());
    let a = k
        .create_deck(
            &Actor::Human,
            "Tool use",
            None,
            &deck_text("Tool use", 4),
            NOW,
        )
        .unwrap();
    let b = k
        .create_deck(
            &Actor::Human,
            "annual review",
            Some(PROJECT),
            &deck_text("annual review", 2),
            NOW,
        )
        .unwrap();
    fs::write(t.vault.root().join("library/broken.deck"), "{ nope").unwrap();

    let decks = k.decks().unwrap();
    let names: Vec<_> = decks
        .iter()
        .map(|d| (d.path.as_str(), d.title.as_str()))
        .collect();
    assert_eq!(
        names,
        [
            (b.as_str(), "annual review"),
            ("library/broken.deck", "broken"),
            (a.as_str(), "Tool use"),
        ],
        "by title, ignoring case; a deck that cannot be read is named by its file"
    );
    assert_eq!(
        (decks[0].slides, decks[0].project.as_deref()),
        (2, Some(PROJECT))
    );
    assert_eq!((decks[2].slides, decks[2].project.as_deref()), (4, None));
    assert!(decks[0].problem.is_none() && decks[0].size > 0 && decks[0].modified > 0);
    assert!(
        decks[1]
            .problem
            .as_deref()
            .unwrap()
            .starts_with("Not a KastenFlow deck")
    );
    assert_eq!(k.resolve_deck("tool use").unwrap(), a);
    assert_eq!(k.resolve_deck(&b).unwrap(), b);
    assert!(k.resolve_deck("nothing").is_err());
}

#[test]
fn a_person_saves_in_batches_and_an_agent_commits_at_once() {
    let (_t, k) = open();
    let v1 = deck_text("Tool use", 1);
    let path = k
        .create_deck(&Actor::Human, "Tool use", None, &v1, NOW)
        .unwrap();
    assert_eq!(k.log(None, 1).unwrap()[0].summary, "deck: create Tool use");

    let commits = k.log(None, 500).unwrap().len();
    let v2 = deck_text("Tool use", 2);
    let saved = k
        .save_deck(&Actor::Human, &path, &v2, &content_hash(&v1), NOW)
        .unwrap();
    let DeckSaved::Written { deck } = saved else {
        panic!("expected a write");
    };
    // Written at once, committed after a pause, like typing.
    assert_eq!(k.deck(&path).unwrap(), deck);
    assert_eq!(k.pending_edits(), [path.as_str()]);
    assert_eq!(k.log(None, 500).unwrap().len(), commits);
    k.commit_edits().unwrap();
    assert!(!k.log(None, 1).unwrap()[0].agent);

    let agent = Actor::Agent {
        client: "claude-code".into(),
        session: "01SESSION".into(),
    };
    let v3 = deck_text("Tool use", 3);
    k.save_deck(&agent, &path, &v3, &deck.hash, NOW).unwrap();
    let last = &k.log(None, 1).unwrap()[0];
    assert_eq!(last.summary, "deck: edit Tool use");
    assert!(last.agent);
    assert!(k.pending_edits().is_empty());
}

/// Three decks in the vault, and a request to retitle each, as the dialog of "every deck" would make it after looking.
fn three_decks(k: &Kasten) -> (Vec<String>, Vec<String>, SaveDecksRequest) {
    let mut paths = Vec::new();
    let mut before = Vec::new();
    let mut edits = Vec::new();
    for (n, title) in ["Alpha", "Beta", "Gamma"].into_iter().enumerate() {
        let text = deck_text(title, n + 1);
        let path = k
            .create_deck(&Actor::Human, title, None, &text, NOW)
            .unwrap();
        edits.push(DeckEdit {
            path: path.clone(),
            base_hash: content_hash(&text),
            text: deck_text(&format!("{title} without numbers"), n + 1),
        });
        paths.push(path);
        before.push(text);
    }
    let request = SaveDecksRequest {
        message: "slides: turn off slide numbers in 3 decks".to_owned(),
        edits,
    };
    (paths, before, request)
}

fn on_disk(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

#[test]
fn save_decks_is_all_or_none_and_one_commit() {
    let (t, k) = open();
    let (paths, before, request) = three_decks(&k);
    let log = k.log(None, 500).unwrap().len();

    // One of them is not a deck any more: nothing is written, nothing is committed.
    let mut broken = request.clone();
    broken.edits[2].text = "{ nope".to_owned();
    assert!(
        invalid(k.save_decks(&Actor::Human, &broken, NOW)).starts_with("Not a KastenFlow deck")
    );
    // One of them is not there: the same.
    let mut gone = request.clone();
    gone.edits[1].path = "library/gone.deck".to_owned();
    assert!(k.save_decks(&Actor::Human, &gone, NOW).is_err());
    for (path, was) in paths.iter().zip(&before) {
        assert_eq!(&on_disk(&t, path), was, "{path}");
    }
    assert_eq!(k.log(None, 500).unwrap().len(), log);

    let saved = k.save_decks(&Actor::Human, &request, NOW).unwrap();
    assert_eq!(saved.paths, paths);
    let commit = saved.commit.clone().expect("a commit");
    assert_eq!(
        k.log(None, 500).unwrap().len(),
        log + 1,
        "one commit for all of them"
    );
    let newest = &k.log(None, 1).unwrap()[0];
    assert_eq!(
        (newest.id.as_str(), newest.summary.as_str()),
        (commit.as_str(), "slides: turn off slide numbers in 3 decks")
    );
    assert!(!newest.agent);
    for (path, edit) in paths.iter().zip(&request.edits) {
        assert_eq!(on_disk(&t, path), edit.text, "{path}");
        assert_eq!(k.deck(path).unwrap().hash, content_hash(&edit.text));
    }
}

#[test]
fn a_deck_that_stays_the_same_is_not_written_and_a_request_that_changes_nothing_commits_nothing() {
    let (t, k) = open();
    let (paths, before, mut request) = three_decks(&k);
    request.edits[1].text = before[1].clone();
    let saved = k.save_decks(&Actor::Human, &request, NOW).unwrap();
    assert_eq!(saved.paths, [paths[0].clone(), paths[2].clone()]);
    assert_eq!(on_disk(&t, &paths[1]), before[1]);

    // Nothing to change at all.
    let log = k.log(None, 500).unwrap().len();
    let same = SaveDecksRequest {
        message: "slides: nothing".to_owned(),
        edits: (0..3)
            .map(|n| DeckEdit {
                path: paths[n].clone(),
                base_hash: k.deck(&paths[n]).unwrap().hash,
                text: k.deck(&paths[n]).unwrap().text,
            })
            .collect(),
    };
    let saved = k.save_decks(&Actor::Human, &same, NOW).unwrap();
    assert!(saved.paths.is_empty() && saved.commit.is_none());
    assert_eq!(k.log(None, 500).unwrap().len(), log);
}

#[test]
fn a_stale_hash_refuses_everything() {
    let (t, k) = open();
    let (paths, before, request) = three_decks(&k);
    // Another window (an agent, a sync) saved the second deck after the preview.
    let theirs = deck_text("Beta, changed elsewhere", 2);
    fs::write(t.vault.root().join(&paths[1]), &theirs).unwrap();
    let log = k.log(None, 500).unwrap().len();
    let why = invalid(k.save_decks(&Actor::Human, &request, NOW));
    assert!(why.contains("changed since"), "{why}");
    assert_eq!(
        on_disk(&t, &paths[0]),
        before[0],
        "the others are left as they were"
    );
    assert_eq!(on_disk(&t, &paths[1]), theirs);
    assert_eq!(on_disk(&t, &paths[2]), before[2]);
    assert_eq!(k.log(None, 500).unwrap().len(), log);
}

#[test]
fn an_agent_is_refused() {
    let (t, k) = open();
    let (paths, before, request) = three_decks(&k);
    let agent = Actor::Agent {
        client: "claude-code".into(),
        session: "01SESSION".into(),
    };
    let why = invalid(k.save_decks(&agent, &request, NOW));
    assert!(why.contains("person"), "{why}");
    for (path, was) in paths.iter().zip(&before) {
        assert_eq!(&on_disk(&t, path), was);
    }
}

#[test]
fn a_request_that_cannot_be_met_is_refused_before_anything_is_read() {
    let (_t, k) = open();
    let (_paths, _before, request) = three_decks(&k);
    let mut twice = request.clone();
    twice.edits[1].path = twice.edits[0].path.clone();
    assert!(invalid(k.save_decks(&Actor::Human, &twice, NOW)).contains("twice"));
    let mut empty = request.clone();
    empty.edits.clear();
    assert!(invalid(k.save_decks(&Actor::Human, &empty, NOW)).contains("Nothing"));
    let mut unnamed = request.clone();
    unnamed.message = "  ".to_owned();
    assert!(invalid(k.save_decks(&Actor::Human, &unnamed, NOW)).contains("message"));
    let mut elsewhere = request;
    elsewhere.edits[0].path = "library/note.md".to_owned();
    assert!(k.save_decks(&Actor::Human, &elsewhere, NOW).is_err());
}

#[test]
fn undo_commit_restores_every_deck() {
    let (t, k) = open();
    let (paths, before, request) = three_decks(&k);
    let saved = k.save_decks(&Actor::Human, &request, NOW).unwrap();
    let commit = saved.commit.unwrap();
    let undone = k.undo_commit(&commit, NOW).unwrap();
    assert_eq!(undone.reverted, [commit]);
    assert!(undone.conflict.is_none());
    for (path, was) in paths.iter().zip(&before) {
        assert_eq!(&on_disk(&t, path), was, "{path}");
    }
}

#[test]
fn a_trashed_deck_comes_back_as_a_commit() {
    let (t, k) = open();
    let text = deck_text("Tool use", 2);
    let path = k
        .create_deck(&Actor::Human, "Tool use", Some(PROJECT), &text, NOW)
        .unwrap();
    let trashed = k.trash(&Actor::Human, &path, NOW).unwrap();
    assert!(!t.vault.root().join(&path).exists());
    assert!(k.decks().unwrap().is_empty());
    assert_eq!(k.log(None, 1).unwrap()[0].summary, "trash: Tool use");

    let listed = k.list_trash().unwrap();
    let item = listed.iter().find(|x| x.trashed == trashed).unwrap();
    assert_eq!(
        (item.title.as_str(), item.original.as_str()),
        ("Tool use", path.as_str())
    );
    assert_eq!(k.read_trashed(&trashed).unwrap(), text);

    // Something else took its place meanwhile: it comes back beside it.
    fs::write(t.vault.root().join(&path), deck_text("Other", 0)).unwrap();
    let back = k.restore_deck(&Actor::Human, &trashed).unwrap();
    assert_eq!(back, "projects/photo-organiser/decks/tool-use-2.deck");
    assert_eq!(
        fs::read_to_string(t.vault.root().join(&back)).unwrap(),
        text
    );
    assert_eq!(k.log(None, 1).unwrap()[0].summary, "restore: Tool use");
    assert!(
        k.restore_deck(&Actor::Human, &trashed).is_err(),
        "only once"
    );
}

#[test]
fn verify_finds_unreadable_decks_and_missing_images() {
    let (t, k) = open();
    let good = json!({
        "format": "kasten-deck", "formatVersion": 1, "title": "Tool use",
        "slides": [ { "elements": [
            { "type": "image", "src": "assets/there.png" },
            { "type": "image", "src": "assets/gone.png" }
        ] } ]
    });
    k.create_deck(&Actor::Human, "Tool use", None, &good.to_string(), NOW)
        .unwrap();
    fs::create_dir_all(t.vault.root().join("assets")).unwrap();
    fs::write(t.vault.root().join("assets/there.png"), b"png").unwrap();
    fs::write(t.vault.root().join("library/broken.deck"), "{ nope").unwrap();

    let report = k.verify().unwrap();
    assert_eq!(report.decks, 2);
    let decks: Vec<_> = report
        .problems
        .iter()
        .filter(|p| p.kind.starts_with("deck"))
        .map(|p| {
            (
                p.kind.as_str(),
                p.path.as_deref().unwrap(),
                p.detail.as_str(),
            )
        })
        .collect();
    assert_eq!(decks.len(), 2, "{decks:?}");
    assert!(decks.iter().any(|(kind, path, detail)| *kind == "deck"
        && *path == "library/broken.deck"
        && detail.starts_with("Not a KastenFlow deck")));
    assert!(
        decks
            .iter()
            .any(|(kind, path, detail)| *kind == "deck-image"
                && *path == "library/tool-use.deck"
                && detail.contains("assets/gone.png"))
    );
}
