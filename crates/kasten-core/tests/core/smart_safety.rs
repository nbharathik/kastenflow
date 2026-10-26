//! A smart page's folder under attack and at its limits: sizes at the byte,
//! file kinds, paths that try to leave the folder or hide, links, names that
//! differ in case, a folder where a file should be, and search that must only
//! ever see the words `index.html` shows.

use crate::common::NOW;
use crate::smart_support::{all_files, make_page, open, snapshot, there};

use std::fs;

use kasten_core::history::Actor;
use kasten_core::smart::{MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES};

fn human() -> Actor {
    Actor::Human
}

const PAGE: &str = "library/tracker.md";
const DIR: &str = "library/tracker.smart";

#[test]
fn a_file_may_be_two_megabytes_and_not_a_byte_more() {
    let (t, k) = open();
    make_page(&k, "Tracker", None, None);
    let limit = MAX_FILE_BYTES as usize;
    k.smart_write_file(
        &human(),
        PAGE,
        "data/big.json",
        &vec![b'a'; limit],
        Some(""),
        NOW,
    )
    .unwrap();
    assert_eq!(
        fs::metadata(t.vault.root().join(DIR).join("data/big.json"))
            .unwrap()
            .len(),
        MAX_FILE_BYTES
    );
    let before = all_files(&t);
    let over = k.smart_write_file(
        &human(),
        PAGE,
        "data/big2.json",
        &vec![b'a'; limit + 1],
        Some(""),
        NOW,
    );
    assert!(over.unwrap_err().to_string().contains("at most 2.0 MB"));
    // An existing file is not touched by a write that is too large.
    assert!(
        k.smart_write_file(
            &human(),
            PAGE,
            "data/big.json",
            &vec![b'b'; limit + 1],
            None,
            NOW
        )
        .is_err()
    );
    assert_eq!(all_files(&t), before);
}

#[test]
fn the_folder_may_hold_ten_megabytes_in_all_and_replacing_counts_once() {
    let (t, k) = open();
    make_page(&k, "Tracker", None, None);
    let two_mb = vec![b'x'; MAX_FILE_BYTES as usize];
    for n in 0..5 {
        k.smart_write_file(
            &human(),
            PAGE,
            &format!("data/part{n}.json"),
            &two_mb,
            Some(""),
            NOW,
        )
        .unwrap();
    }
    assert_eq!(k.smart_read(PAGE).unwrap().total_bytes, MAX_TOTAL_BYTES);
    let before = all_files(&t);
    let refused = k.smart_write_file(&human(), PAGE, "notes.txt", b"x", Some(""), NOW);
    assert!(refused.unwrap_err().to_string().contains("at most 10.0 MB"));
    assert_eq!(all_files(&t), before);
    // A file over itself takes only what it adds: same size is fine, one byte more is not.
    k.smart_write_file(
        &human(),
        PAGE,
        "data/part0.json",
        &vec![b'y'; two_mb.len()],
        None,
        NOW,
    )
    .unwrap();
    assert!(
        k.smart_write_file(
            &human(),
            PAGE,
            "data/part0.json",
            &vec![b'y'; two_mb.len()],
            None,
            NOW
        )
        .is_ok()
    );
    // Making room makes room.
    k.smart_write_file(&human(), PAGE, "data/part1.json", b"s", None, NOW)
        .unwrap();
    k.smart_write_file(&human(), PAGE, "notes.txt", b"fits now", Some(""), NOW)
        .unwrap();
    assert_eq!(snapshot(&t, DIR).len(), 6);
}

#[test]
fn the_folder_may_hold_five_hundred_files() {
    let (t, k) = open();
    make_page(&k, "Tracker", None, None);
    for n in 0..MAX_FILES {
        k.smart_write_file(
            &human(),
            PAGE,
            &format!("data/f{n}.json"),
            b"1",
            Some(""),
            NOW,
        )
        .unwrap();
    }
    let refused = k.smart_write_file(&human(), PAGE, "data/one-more.json", b"1", Some(""), NOW);
    assert!(
        refused
            .unwrap_err()
            .to_string()
            .contains("at most 500 files")
    );
    // An existing file can still be changed, and one taken out makes room.
    k.smart_write_file(&human(), PAGE, "data/f0.json", b"22", None, NOW)
        .unwrap();
    k.smart_delete_file(&human(), PAGE, "data/f1.json", NOW)
        .unwrap();
    k.smart_write_file(&human(), PAGE, "data/one-more.json", b"1", Some(""), NOW)
        .unwrap();
    assert_eq!(snapshot(&t, DIR).len(), MAX_FILES);
}

#[test]
fn only_the_kinds_of_file_a_folder_may_hold_are_written() {
    let (t, k) = open();
    make_page(&k, "Tracker", None, None);
    let before = all_files(&t);
    for bad in [
        "x.wasm",
        "x.exe",
        "x.dll",
        "x.sh",
        "x.bat",
        "x.ps1",
        "x.md",
        "x.yaml",
        "x.php",
        "x.js.exe",
        "x.html.exe",
        "x.pdf",
        "x.gif",
        "x.mp4",
        "x.ttf",
        "x.woff2",
        "noextension",
        ".js",
        "sub/smart.yaml",
        "x.JSX",
    ] {
        assert!(
            k.smart_write_file(&human(), PAGE, bad, b"x", None, NOW)
                .is_err(),
            "{bad}"
        );
    }
    assert_eq!(all_files(&t), before);
    for ok in [
        "a.html",
        "a.JS",
        "a.css",
        "a.json",
        "a.svg",
        "a.png",
        "a.webp",
        "a.jpg",
        "a.txt",
        "deep/er/a.js",
    ] {
        k.smart_write_file(&human(), PAGE, ok, b"x", Some(""), NOW)
            .unwrap();
    }
}

#[test]
fn no_path_leaves_the_folder_or_hides_in_it() {
    let (t, k) = open();
    make_page(&k, "Tracker", None, None);
    let other = make_page(&k, "Other", None, None);
    let before = all_files(&t);
    let attacks = [
        "../x.js",
        "../tracker.md",
        "../../x.js",
        "a/../../x.js",
        "a/../b.js",
        "/abs.js",
        "/etc/passwd.txt",
        "C:/x.js",
        "C:\\x.js",
        "a\\b.js",
        "..\\x.js",
        "./a.js",
        "a/./b.js",
        "a//b.js",
        "a/",
        "",
        ".",
        "..",
        ".hidden.js",
        "a/.hidden.js",
        ".git/config.json",
        "a/.git/x.json",
        ".kasten/x.json",
        "x.js\0.png",
        "x.js.",
        "x.js ",
        "CON.js",
        "aux.txt",
        "NUL",
        "PROGRA~1.js",
        "a:b.js",
        "a<b.js",
        "a|b.js",
        "a*.js",
        "a?.js",
        "x\ny.js",
        "x\u{0}.js",
        "a/b/c/d/e/f/g.js",
        "..%2f..%2fx.js",
    ];
    for attack in attacks {
        let write = k.smart_write_file(&human(), PAGE, attack, b"x", None, NOW);
        assert!(write.is_err(), "write {attack:?}");
        assert!(k.smart_file(PAGE, attack).is_err(), "read {attack:?}");
        assert!(
            k.smart_delete_file(&human(), PAGE, attack, NOW).is_err(),
            "delete {attack:?}"
        );
    }
    // The page itself can be spelled in no way that reaches elsewhere.
    for page in [
        "../tracker.md",
        "/library/tracker.md",
        "library/../library/tracker.md",
        "library\\tracker.md",
        ".kasten/x.md",
        ".trash/x.md",
        ".git/x.md",
        "library/tracker.txt",
        "library/tracker",
        "library/.md",
        "library/tracker.smart/inner.md",
    ] {
        assert!(
            k.smart_write_file(&human(), page, "a.js", b"x", None, NOW)
                .is_err(),
            "{page}"
        );
        assert!(k.smart_read(page).is_err(), "{page}");
    }
    assert_eq!(all_files(&t), before, "nothing was written, anywhere");
    assert!(!there(&t, "x.js") && !there(&t, "library/x.js"));
    assert!(!there(
        &t,
        &format!("{}.smart", other.meta.path.trim_end_matches(".md"))
    ));
}
