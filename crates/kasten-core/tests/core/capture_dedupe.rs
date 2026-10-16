//! Finding a page that is already saved: by an address written some other
//! way, among captures (`props.url`) and clips (a top-level `url:`), after the
//! index is rebuilt; and saving it again on purpose as a snapshot that points
//! back at the first card, which is never touched.

use std::fs;

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::Kasten;
use kasten_core::clip::{Target, WebCapture};
use kasten_core::history::Actor;

const URL: &str = "https://example.com/guide/slip-box";
const ARTICLE: &str = "<html><head><title>Slip-box basics</title></head><body><article><h1>Slip-box basics</h1><p>One idea per note.</p></article></body></html>";

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn capture(url: &str, title: &str) -> WebCapture {
    WebCapture {
        url: url.to_owned(),
        title: title.to_owned(),
        html: Some("<p>One idea per note.</p>".to_owned()),
        text: None,
        via: "browser".to_owned(),
        tags: Vec::new(),
        snapshot_of: None,
    }
}

fn text_of(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

fn paths(notes: &[kasten_core::NoteMeta]) -> Vec<&str> {
    notes.iter().map(|n| n.path.as_str()).collect()
}

#[test]
fn a_capture_is_found_by_the_same_page_written_another_way() {
    let (_t, k) = open();
    assert!(k.captured(URL).unwrap().is_empty());
    let note = k
        .capture_web(
            &Actor::Human,
            &capture(URL, "Slip-box basics"),
            &Target::Inbox,
            NOW,
        )
        .unwrap();
    for same in [
        URL,
        "http://example.com/guide/slip-box",
        "https://www.EXAMPLE.com/guide/slip-box/",
        "https://example.com:443/guide/slip-box#part-2",
        "https://example.com/guide/slip-box?utm_source=feed&fbclid=1",
    ] {
        assert_eq!(
            paths(&k.captured(same).unwrap()),
            [note.meta.path.as_str()],
            "{same}"
        );
    }
    for other in [
        "https://example.com/guide/slip-box-2",
        "https://example.com/Guide/slip-box",
        "https://example.org/guide/slip-box",
        "https://example.com/guide/slip-box?page=2",
        "mailto:a@example.com",
        "",
    ] {
        assert!(k.captured(other).unwrap().is_empty(), "{other}");
    }
}

#[test]
fn the_preview_says_what_is_already_saved_and_when() {
    let (_t, k) = open();
    let first = capture(URL, "Slip-box basics");
    let before = k.capture_preview(&first).unwrap();
    assert!(before.existing.is_empty());
    assert_eq!(before.preview.site, "example.com");
    let note = k
        .capture_web(&Actor::Human, &first, &Target::Inbox, NOW)
        .unwrap();
    let again = capture("http://www.example.com/guide/slip-box/#top", "Same page");
    let after = k.capture_preview(&again).unwrap();
    assert_eq!(after.existing.len(), 1);
    assert_eq!(after.existing[0].path, note.meta.path);
    assert_eq!(after.existing[0].title, "Slip-box basics");
    assert_eq!(after.existing[0].captured.as_deref(), Some("2026-09-24"));
    // A capture that cannot be kept says why, as it always did.
    let bad = capture("ftp://example.com/x", "x");
    assert!(k.capture_preview(&bad).is_err());
}

#[test]
fn clips_with_a_top_level_url_and_hand_written_notes_match_too() {
    let t = dev_vault();
    fs::write(
        t.vault.root().join("library/by-hand.md"),
        "---\nid: 01J8Z3K6Q2M4X7V9B1C5D8E0A1\ntitle: By hand\nurl: \"https://www.example.com/guide/slip-box/\"\n---\nNotes.\n",
    )
    .unwrap();
    fs::write(
        t.vault.root().join("library/in-props.md"),
        "---\nid: 01J8Z3K6Q2M4X7V9B1C5D8E0A2\ntitle: In props\nprops:\n  url: http://example.com/guide/slip-box\n---\nNotes.\n",
    )
    .unwrap();
    fs::write(
        t.vault.root().join("library/nested-only.md"),
        "---\ntitle: Nested only\nmeta:\n  url: https://example.com/guide/slip-box\n---\nNotes.\n",
    )
    .unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    let clipped = k.clip(&Actor::Human, URL, ARTICLE, NOW).unwrap().meta.path;
    let found = k.captured("https://example.com/guide/slip-box").unwrap();
    let mut got = paths(&found);
    got.sort_unstable();
    let mut want = vec![
        "library/by-hand.md",
        "library/in-props.md",
        clipped.as_str(),
    ];
    want.sort_unstable();
    assert_eq!(got, want);
}

#[test]
fn matches_survive_a_rebuild_and_an_index_from_before_keys_is_rebuilt_on_open() {
    let (t, k) = open();
    let note = k
        .capture_web(
            &Actor::Human,
            &capture(URL, "Slip-box basics"),
            &Target::Inbox,
            NOW,
        )
        .unwrap();
    let want = [note.meta.path.as_str()];
    k.reindex().unwrap();
    assert_eq!(paths(&k.captured(URL).unwrap()), want);
    drop(k);

    // An index made before the key existed: it names an older schema.
    let index = t.vault.root().join(".kasten/cache/index.sqlite");
    {
        let conn = rusqlite::Connection::open(&index).unwrap();
        conn.execute_batch(
            "DROP INDEX notes_url; ALTER TABLE notes DROP COLUMN url_key; UPDATE meta SET value = '5' WHERE key = 'schema';",
        )
        .unwrap();
    }
    let k = Kasten::open(t.vault.root()).unwrap();
    assert_eq!(
        paths(&k.captured("http://example.com/guide/slip-box/").unwrap()),
        want
    );
    drop(k);
    let conn = rusqlite::Connection::open(&index).unwrap();
    let version: String = conn
        .query_row("SELECT value FROM meta WHERE key = 'schema'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(version, "6");
}

#[test]
fn a_snapshot_is_a_new_card_that_points_at_the_first_and_leaves_it_alone() {
    let (t, k) = open();
    let first = k
        .capture_web(
            &Actor::Human,
            &capture(URL, "Slip-box basics"),
            &Target::Inbox,
            NOW,
        )
        .unwrap();
    let id = first.meta.id.clone().expect("a capture has an id");
    let before = text_of(&t, &first.meta.path);
    let commits = k.log(None, 500).unwrap().len();

    let snapshot = WebCapture {
        snapshot_of: Some(first.meta.path.clone()),
        html: Some("<p>The page has changed.</p>".to_owned()),
        ..capture("https://www.example.com/guide/slip-box/", "Slip-box basics")
    };
    let second = k
        .capture_web(&Actor::Human, &snapshot, &Target::Inbox, NOW)
        .unwrap();
    assert_ne!(second.meta.path, first.meta.path);
    assert_eq!(second.meta.props["snapshot_of"], id.as_str());
    assert_eq!(second.meta.tags, ["capture"]);
    assert!(second.text.contains("The page has changed."));
    // The first card is exactly as it was, and one commit was made.
    assert_eq!(text_of(&t, &first.meta.path), before);
    let log = k.log(None, 500).unwrap();
    assert_eq!(log.len(), commits + 1);
    assert!(
        log[0].summary.starts_with("capture: Slip-box basics"),
        "{}",
        log[0].summary
    );
    let changed: Vec<String> = k
        .commit_changes(&log[0].id)
        .unwrap()
        .into_iter()
        .map(|c| c.path)
        .collect();
    assert_eq!(changed, [second.meta.path.as_str()]);

    // Both are found, the first saved first, and the first has no pointer.
    let found = k.captured(URL).unwrap();
    assert_eq!(
        paths(&found),
        [first.meta.path.as_str(), second.meta.path.as_str()]
    );
    assert!(found[0].props.get("snapshot_of").is_none());

    // A snapshot named by id, or of a snapshot, still points at the first.
    let by_id = WebCapture {
        snapshot_of: Some(id.clone()),
        ..capture(URL, "Third look")
    };
    let third = k
        .capture_web(&Actor::Human, &by_id, &Target::Inbox, NOW)
        .unwrap();
    assert_eq!(third.meta.props["snapshot_of"], id.as_str());
    let of_snapshot = WebCapture {
        snapshot_of: Some(second.meta.path.clone()),
        ..capture(URL, "Fourth look")
    };
    let fourth = k
        .capture_web(&Actor::Human, &of_snapshot, &Target::Inbox, NOW)
        .unwrap();
    assert_eq!(fourth.meta.props["snapshot_of"], id.as_str());
    assert_eq!(k.captured(URL).unwrap().len(), 4);
    assert_eq!(text_of(&t, &first.meta.path), before);
}

#[test]
fn a_snapshot_of_a_page_that_is_not_there_writes_nothing() {
    let (t, k) = open();
    let commits = k.log(None, 500).unwrap().len();
    let files = t.vault.notes().unwrap().len();
    for gone in ["inbox/nowhere.md", "01JZZZZZZZZZZZZZZZZZZZZZZZ", ""] {
        let snapshot = WebCapture {
            snapshot_of: Some(gone.to_owned()),
            ..capture(URL, "Slip-box basics")
        };
        let err = k
            .capture_web(&Actor::Human, &snapshot, &Target::Inbox, NOW)
            .unwrap_err();
        assert!(err.to_string().contains("not there"), "{gone}: {err}");
    }
    assert_eq!(k.log(None, 500).unwrap().len(), commits);
    assert_eq!(t.vault.notes().unwrap().len(), files);
}

#[test]
fn a_clipped_page_clipped_again_on_purpose_is_a_snapshot_too() {
    let (t, k) = open();
    let first = k.clip(&Actor::Human, URL, ARTICLE, NOW).unwrap();
    let id = first.meta.id.clone().expect("a clip has an id");
    let before = text_of(&t, &first.meta.path);
    let second = k
        .clip_snapshot(&Actor::Human, URL, ARTICLE, Some(&first.meta.path), NOW)
        .unwrap();
    assert_eq!(second.meta.props["snapshot_of"], id.as_str());
    assert!(
        second.text.contains(&format!("\nurl: {URL}\n")),
        "{}",
        second.text
    );
    assert_eq!(text_of(&t, &first.meta.path), before);
    assert_eq!(k.captured(URL).unwrap().len(), 2);
    // Without a first card to point at, nothing is written.
    let commits = k.log(None, 500).unwrap().len();
    assert!(
        k.clip_snapshot(&Actor::Human, URL, ARTICLE, Some("inbox/nowhere.md"), NOW)
            .is_err()
    );
    assert_eq!(k.log(None, 500).unwrap().len(), commits);
}

#[test]
fn a_quote_added_to_a_page_is_not_marked_as_a_snapshot() {
    let (_t, k) = open();
    let first = k
        .capture_web(
            &Actor::Human,
            &capture(URL, "Slip-box basics"),
            &Target::Inbox,
            NOW,
        )
        .unwrap();
    let quote = WebCapture {
        snapshot_of: Some(first.meta.path.clone()),
        ..capture(URL, "Slip-box basics")
    };
    let page = "projects/photo-organiser/pages/photo-organiser-roadmap.md";
    let note = k
        .capture_web(
            &Actor::Human,
            &quote,
            &Target::Page {
                path: page.to_owned(),
                heading: None,
            },
            NOW,
        )
        .unwrap();
    assert!(note.meta.props.get("snapshot_of").is_none());
    assert_eq!(k.captured(URL).unwrap().len(), 1);
}
