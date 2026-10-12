//! What a replace across pages refuses, and that a refusal writes nothing:
//! an agent, text over the limits, pages outside the root, the trash and
//! other files, too many pages or replacements, pages that changed since the
//! preview, and locked pages.

use std::fs;

use crate::common::{NOW, TempVault};
use crate::replace::{FILES, LOW, MID, TOP, bytes, commits, open, open_with, request, spec, text};
use kasten_core::history::Actor;
use kasten_core::{Expected, Kasten, NoteMatches, ReplaceRequest};

/// Runs a refused request and checks nothing in the vault changed.
fn refused(t: &TempVault, k: &Kasten, actor: &Actor, req: &ReplaceRequest) -> String {
    let files: Vec<Vec<u8>> = FILES.iter().map(|(p, _)| bytes(t, p)).collect();
    let log = commits(k);
    let err = k.replace_under(actor, req, NOW).unwrap_err();
    for ((path, _), was) in FILES.iter().zip(&files) {
        assert_eq!(&bytes(t, path), was, "{path} was written");
    }
    assert_eq!(commits(k), log, "a commit was made");
    err.to_string()
}

#[test]
fn an_agent_cannot_replace_across_pages() {
    let (t, k) = open();
    let found = k.find_under("TOP", &spec("paris"), 50).unwrap();
    let req = request("TOP", &spec("paris"), "Rome", &found);
    let agent = Actor::Agent {
        client: "test".into(),
        session: "S".into(),
    };
    let why = refused(&t, &k, &agent, &req);
    assert!(why.contains("person"), "{why}");
    let approved = Actor::Approved {
        client: "test".into(),
        session: "S".into(),
        by: "me".into(),
    };
    refused(&t, &k, &approved, &req);
}

#[test]
fn the_search_and_replacement_text_are_limited() {
    let (t, k) = open();
    let found = k.find_under("TOP", &spec("paris"), 50).unwrap();
    let long_query = "x".repeat(201);
    for (query, with) in [
        ("", "Rome"),
        (long_query.as_str(), "Rome"),
        ("pa\nris", "Rome"),
        ("pa\tris", "Rome"),
        ("paris", "Ro\nme"),
        ("paris", "Ro\u{0}me"),
    ] {
        let req = request("TOP", &spec(query), with, &found);
        refused(&t, &k, &Actor::Human, &req);
    }
    let long_with = "y".repeat(1001);
    refused(
        &t,
        &k,
        &Actor::Human,
        &request("TOP", &spec("paris"), &long_with, &found),
    );
    // The limits themselves are fine.
    let longest = "y".repeat(1000);
    assert!(
        k.replace_under(
            &Actor::Human,
            &request("TOP", &spec("paris"), &longest, &found),
            NOW
        )
        .is_ok()
    );
}

#[test]
fn only_pages_under_the_root_are_replaced() {
    let (t, k) = open();
    let all = k.find_under("TOP", &spec("paris"), 50).unwrap();
    let beside = k.find_under("OTHER", &spec("paris"), 50).unwrap();
    // A page beside the root, or in the request twice, or nothing at all.
    let mut outside = request("TOP", &spec("paris"), "Rome", &all);
    outside
        .expect
        .extend(request("OTHER", &spec("paris"), "Rome", &beside).expect);
    let why = refused(&t, &k, &Actor::Human, &outside);
    assert!(why.contains("library/other.md"), "{why}");
    let mut twice = request("TOP", &spec("paris"), "Rome", &all);
    twice.expect.push(twice.expect[0].clone());
    refused(&t, &k, &Actor::Human, &twice);
    let mut none = request("TOP", &spec("paris"), "Rome", &all);
    none.expect.clear();
    refused(&t, &k, &Actor::Human, &none);
    refused(
        &t,
        &k,
        &Actor::Human,
        &request("NOPE", &spec("paris"), "Rome", &all),
    );
}

#[test]
fn trash_private_folders_and_other_files_are_refused() {
    let (t, k) = open();
    let all = k.find_under("TOP", &spec("paris"), 50).unwrap();
    for path in [
        ".trash/2026-10-06/library/top.md",
        ".kasten/config.yaml",
        ".kasten/cache/index.sqlite",
        "library/top.txt",
        "projects/photo-organiser/boards/brainstorm.canvas",
        "../outside.md",
        "library/../library/top.md",
        "/etc/hosts.md",
        "library\\top.md",
    ] {
        let mut req = request("TOP", &spec("paris"), "Rome", &all);
        req.expect.push(Expected {
            path: path.to_owned(),
            hash: "0".repeat(16),
            count: 1,
        });
        refused(&t, &k, &Actor::Human, &req);
    }
}

#[test]
fn at_most_200_pages_and_5000_replacements() {
    let (t, k) = open();
    let all = k.find_under("TOP", &spec("paris"), 50).unwrap();
    let mut many = request("TOP", &spec("paris"), "Rome", &all);
    many.expect = (0..201)
        .map(|i| Expected {
            path: format!("library/n{i}.md"),
            hash: "0".repeat(16),
            count: 1,
        })
        .collect();
    let why = refused(&t, &k, &Actor::Human, &many);
    assert!(why.contains("200"), "{why}");
    let mut big = request("TOP", &spec("paris"), "Rome", &all);
    big.expect[0].count = 5_001;
    let why = refused(&t, &k, &Actor::Human, &big);
    assert!(why.contains("5,000"), "{why}");
}

#[test]
fn a_page_changed_since_the_preview_stops_everything() {
    let (t, k) = open();
    let found = k.find_under("TOP", &spec("paris"), 50).unwrap();
    let req = request("TOP", &spec("paris"), "Rome", &found);
    // One page is edited meanwhile (here: outside, then picked up).
    let changed = LOW.replace("again", "once more");
    fs::write(t.vault.root().join("library/low.md"), &changed).unwrap();
    let before: Vec<Vec<u8>> = FILES.iter().map(|(p, _)| bytes(&t, p)).collect();
    let log = commits(&k);
    let err = k.replace_under(&Actor::Human, &req, NOW).unwrap_err();
    assert!(
        err.to_string().contains("changed since the preview"),
        "{err}"
    );
    for ((path, _), was) in FILES.iter().zip(&before) {
        assert_eq!(&bytes(&t, path), was, "{path} was written");
    }
    assert_eq!(commits(&k), log);
    // A count that does not agree with the page is the same.
    let again = k.find_under("TOP", &spec("paris"), 50).unwrap();
    let mut wrong = request("TOP", &spec("paris"), "Rome", &again);
    wrong.expect[0].count += 1;
    let err = k.replace_under(&Actor::Human, &wrong, NOW).unwrap_err();
    assert!(
        err.to_string().contains("changed since the preview"),
        "{err}"
    );
    // Looking again gives a request that works.
    let ok = request("TOP", &spec("paris"), "Rome", &again);
    assert_eq!(k.replace_under(&Actor::Human, &ok, NOW).unwrap().total, 10);
}

#[test]
fn a_locked_page_is_refused_and_nothing_is_written() {
    let locked = LOW.replace("title: Low\n", "title: Low\nlocked: true\n");
    let (t, k) = open_with(&[
        ("library/top.md", TOP),
        ("library/mid.md", MID),
        ("library/low.md", &locked),
    ]);
    let found = k.find_under("TOP", &spec("paris"), 50).unwrap();
    assert!(found.iter().any(|n| n.path == "library/low.md" && n.locked));
    let before = bytes(&t, "library/top.md");
    let err = k
        .replace_under(
            &Actor::Human,
            &request("TOP", &spec("paris"), "Rome", &found),
            NOW,
        )
        .unwrap_err();
    assert!(err.to_string().contains("locked"), "{err}");
    assert_eq!(bytes(&t, "library/top.md"), before);
    assert_eq!(text(&t, "library/low.md"), locked);
    // Leaving the locked page out works.
    let rest: Vec<NoteMatches> = found
        .into_iter()
        .filter(|n| n.path != "library/low.md")
        .collect();
    let done = k
        .replace_under(
            &Actor::Human,
            &request("TOP", &spec("paris"), "Rome", &rest),
            NOW,
        )
        .unwrap();
    assert_eq!(done.notes.len(), 2);
    assert_eq!(text(&t, "library/low.md"), locked);
}
