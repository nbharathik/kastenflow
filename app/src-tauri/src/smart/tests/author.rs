//! Starting a smart page from a starter or a template of the person's own,
//! and the window's commands for it.

use kasten_core::Instant;
use kasten_core::history::Actor;

use crate::chat::tests::vault;
use crate::smart::author::{list, make, write_file};
use crate::smart::starters::{MINE, STARTERS};

const COMMANDS: &[&str] = &[
    "smart_starters",
    "smart_new_page",
    "smart_turn_into",
    "smart_save_template",
    "smart_files",
    "smart_file_read",
    "smart_file_write",
    "smart_file_delete",
    "smart_kit_files",
];

#[test]
fn every_command_for_authoring_is_registered_for_the_window() {
    let handlers = include_str!("../../handlers.rs");
    for command in COMMANDS {
        assert!(
            handlers.contains(&format!("smart::author::{command}")),
            "{command} is not in the handlers"
        );
    }
}

#[test]
fn each_starter_makes_a_page_that_runs_and_says_what_to_do() {
    let v = vault();
    let k = &v.kasten;
    for starter in STARTERS {
        let made = make(k, starter.id, None, None, Instant::now()).unwrap();
        let note = k.read(&made.page).unwrap();
        assert_eq!(note.meta.title, starter.name);
        assert!(note.text.contains("layout: smart"), "{}", starter.id);
        assert!(note.text.ends_with(starter.body), "{}", starter.id);
        let listing = k.smart_read(&made.page).unwrap();
        assert!(
            listing.problems.is_empty(),
            "{}: {:?}",
            starter.id,
            listing.problems
        );
        assert!(listing.files.iter().any(|f| f.path == "index.html"));
        assert_eq!(listing.manifest.unwrap().kit, "1");
        assert_eq!(made.files, starter.files.len());
    }
}

#[test]
fn a_page_can_have_its_own_title_and_a_project() {
    let v = vault();
    let k = &v.kasten;
    let made = make(
        k,
        "dashboard",
        Some("photo-organiser"),
        Some("  Photos  "),
        Instant::now(),
    )
    .unwrap();
    assert!(
        made.page.starts_with("projects/photo-organiser/"),
        "{}",
        made.page
    );
    assert_eq!(made.title, "Photos");
    assert!(make(k, "nothing", None, None, Instant::now()).is_err());
    assert!(make(k, "mine:../x", None, None, Instant::now()).is_err());
}

#[test]
fn a_stale_hash_is_a_conflict_and_nothing_is_written() {
    let v = vault();
    let k = &v.kasten;
    let made = make(k, "dashboard", None, None, Instant::now()).unwrap();
    let read = k.smart_file(&made.page, "app.js").unwrap();
    let first = write_file(
        k,
        &made.page,
        "app.js",
        "// one",
        Some(&read.hash),
        Instant::now(),
    )
    .unwrap();
    let stale = write_file(
        k,
        &made.page,
        "app.js",
        "// two",
        Some(&read.hash),
        Instant::now(),
    )
    .unwrap_err();
    assert_eq!(stale.code, "conflict");
    assert_eq!(
        k.smart_file(&made.page, "app.js").unwrap().text(),
        Some("// one")
    );
    let next = write_file(
        k,
        &made.page,
        "app.js",
        "// three",
        Some(&first.hash),
        Instant::now(),
    )
    .unwrap();
    assert_eq!(k.smart_file(&made.page, "app.js").unwrap().hash, next.hash);
    // A new file is written against "" once; the second try finds it there.
    write_file(k, &made.page, "style.css", "", Some(""), Instant::now()).unwrap();
    let again =
        write_file(k, &made.page, "style.css", "a{}", Some(""), Instant::now()).unwrap_err();
    assert_eq!(again.code, "refused");
    assert_eq!(
        k.smart_file(&made.page, "style.css").unwrap().text(),
        Some("")
    );
}

#[test]
fn a_file_taken_away_behind_the_editor_is_gone_not_a_path_error_and_keep_mine_makes_it_again() {
    let v = vault();
    let k = &v.kasten;
    let made = make(k, "dashboard", None, None, Instant::now()).unwrap();
    let read = k.smart_file(&made.page, "app.js").unwrap();
    k.smart_delete_file(&Actor::Human, &made.page, "app.js", Instant::now())
        .unwrap();
    let gone = write_file(
        k,
        &made.page,
        "app.js",
        "// mine",
        Some(&read.hash),
        Instant::now(),
    )
    .unwrap_err();
    assert_eq!(gone.code, "gone", "{}", gone.message);
    assert!(
        k.smart_file(&made.page, "app.js").is_err(),
        "nothing was written"
    );
    // "Keep mine" writes it as a new file, against "".
    write_file(k, &made.page, "app.js", "// mine", Some(""), Instant::now()).unwrap();
    assert_eq!(
        k.smart_file(&made.page, "app.js").unwrap().text(),
        Some("// mine")
    );
}

#[test]
fn the_editor_cannot_write_where_a_page_may_not_have_files() {
    let v = vault();
    let k = &v.kasten;
    let made = make(k, "tracker", None, None, Instant::now()).unwrap();
    let over = "a".repeat(2 * 1024 * 1024 + 1);
    for path in [
        "../x.js",
        "a/../../x.js",
        "x.exe",
        ".hidden.js",
        "C:/x.js",
        "a\\b.js",
        "CON.js",
        "x.js\0",
        "/abs.js",
    ] {
        let got = write_file(k, &made.page, path, "x", Some(""), Instant::now()).unwrap_err();
        assert_eq!(got.code, "refused", "{path:?}");
    }
    assert_eq!(
        write_file(k, &made.page, "big.js", &over, Some(""), Instant::now())
            .unwrap_err()
            .code,
        "refused"
    );
    // Not a smart page's folder, not a page at all.
    assert!(write_file(k, "library/none.md", "a.js", "x", Some(""), Instant::now()).is_err());
    assert!(write_file(k, "../outside.md", "a.js", "x", Some(""), Instant::now()).is_err());
    assert!(k.smart_read(&made.page).unwrap().problems.is_empty());
}

#[test]
fn the_persons_templates_are_listed_after_the_starters_and_make_pages() {
    let v = vault();
    let k = &v.kasten;
    assert_eq!(list(Some(k)).len(), STARTERS.len());
    let first = make(k, "tracker", None, Some("Reading"), Instant::now()).unwrap();
    let saved = k
        .smart_save_template(
            &kasten_core::history::Actor::Human,
            &first.page,
            "My reading",
            Instant::now(),
        )
        .unwrap();
    let all = list(Some(k));
    let mine: Vec<_> = all.iter().filter(|s| s.mine).collect();
    assert_eq!(mine.len(), 1);
    assert_eq!(mine[0].id, format!("{MINE}{}", saved.slug));
    assert!(all.iter().take(STARTERS.len()).all(|s| !s.mine));
    let again = make(k, &mine[0].id, None, Some("Second"), Instant::now()).unwrap();
    let a = k.smart_file(&first.page, "app.js").unwrap();
    let b = k.smart_file(&again.page, "app.js").unwrap();
    assert_eq!(a.bytes, b.bytes);
    // Without a vault only the starters are offered.
    assert_eq!(list(None).len(), STARTERS.len());
}
