//! Names from outside are plain paths inside the folder, or nothing.

use std::fs;
use std::path::Path;

use super::support::{Dir, link, put};
use crate::plugins::latex::paths::{
    below, clean_rel, clean_rel_tex, plain_file_below, plain_folders_below, really_inside,
    segment_ok,
};

#[test]
fn plain_relative_paths_are_kept_and_tidied() {
    for (name, clean) in [
        ("main.tex", "main.tex"),
        ("./main.tex", "main.tex"),
        ("sections/intro.tex", "sections/intro.tex"),
        ("./sections/./intro.tex", "sections/intro.tex"),
        ("my file.tex", "my file.tex"),
        ("ünï/çödé.tex", "ünï/çödé.tex"),
        ("a-b_c+d(1).tex", "a-b_c+d(1).tex"),
    ] {
        assert_eq!(clean_rel(name).as_deref(), Some(clean), "{name}");
    }
}

#[test]
fn anything_that_could_point_elsewhere_is_nothing() {
    for name in [
        "",
        ".",
        "./",
        "/",
        "/etc/passwd",
        "//server/share/x.tex",
        "..",
        "../x.tex",
        "a/../x.tex",
        "a/../../x.tex",
        "a//b.tex",
        "a/",
        "C:/x.tex",
        "C:x.tex",
        "a/C:/x.tex",
        "x.tex:stream",
        "a\\b.tex",
        "\\\\server\\share\\x.tex",
        ".hidden.tex",
        "a/.git/config",
        "a/..",
        "con.tex",
        "a/NUL",
        "a/com1.txt",
        "a/lpt9",
        "a/CONIN$",
        "conout$.tex",
        "com\u{b9}.tex",
        "a/LPT\u{b2}.x",
        "COM\u{b3}",
        "x.tex ",
        "x.tex.",
        "a/b<c.tex",
        "a/b|c.tex",
        "a/b?.tex",
        "a/b*.tex",
        "a/b\"c.tex",
        "tab\there.tex",
        "nul\0.tex",
        "new\nline.tex",
    ] {
        assert_eq!(clean_rel(name), None, "{name:?}");
    }
    assert_eq!(clean_rel(&"a/".repeat(600)), None);
    assert_eq!(clean_rel(&"x".repeat(256)), None);
    assert_eq!(clean_rel(&"x".repeat(255)).map(|s| s.len()), Some(255));
}

#[test]
fn a_name_from_a_windows_log_may_use_backslashes() {
    assert_eq!(
        clean_rel_tex("sections\\intro.tex").as_deref(),
        Some("sections/intro.tex")
    );
    assert_eq!(clean_rel_tex(".\\main.tex").as_deref(), Some("main.tex"));
    assert_eq!(clean_rel_tex("..\\x.tex"), None);
    assert_eq!(clean_rel_tex("C:\\x.tex"), None);
    assert_eq!(clean_rel_tex("\\x.tex"), None);
}

#[test]
fn segments_are_judged_one_at_a_time() {
    assert!(segment_ok("intro.tex") && segment_ok("a b"));
    for bad in [
        "", ".", "..", ".x", "a/b", "a\\b", "a:b", "x.", "x ", "aux", "COM3",
    ] {
        assert!(!segment_ok(bad), "{bad:?}");
    }
}

#[test]
fn a_path_below_a_base_is_cut_from_it_and_only_then() {
    let base = Path::new("/vault/.kasten/cache/latex/abc/tree");
    assert_eq!(
        below(base, "/vault/.kasten/cache/latex/abc/tree/sections/a.tex").as_deref(),
        Some("sections/a.tex")
    );
    assert_eq!(below(base, "/vault/.kasten/cache/latex/abc/tree"), None);
    assert_eq!(below(base, "/vault/.kasten/cache/latex/abc/tree/"), None);
    // A sibling whose name starts the same is not below it.
    assert_eq!(
        below(base, "/vault/.kasten/cache/latex/abc/tree2/a.tex"),
        None
    );
    assert_eq!(below(base, "/etc/passwd"), None);
    assert_eq!(below(base, "sections/a.tex"), None);
    // Windows spellings: backslashes and the long-path prefix.
    let win = Path::new("C:/Users/x/vault/.kasten/cache/latex/abc/tree");
    assert_eq!(
        below(
            win,
            "C:\\Users\\x\\vault\\.kasten\\cache\\latex\\abc\\tree\\a.tex"
        )
        .as_deref(),
        Some("a.tex")
    );
    assert_eq!(
        below(
            win,
            "\\\\?\\C:\\Users\\x\\vault\\.kasten\\cache\\latex\\abc\\tree\\a.tex"
        )
        .as_deref(),
        Some("a.tex")
    );
    if cfg!(windows) {
        assert_eq!(
            below(
                win,
                "c:/users/X/VAULT/.kasten/cache/latex/abc/tree/Sub/A.tex"
            )
            .as_deref(),
            Some("Sub/A.tex")
        );
    }
    // Climbing out afterwards is still caught by clean_rel.
    let up = below(base, "/vault/.kasten/cache/latex/abc/tree/../../../x.tex").unwrap();
    assert_eq!(clean_rel(&up), None);
}

#[test]
fn only_a_plain_file_inside_the_folder_is_found() {
    let dir = Dir::new("paths-plain");
    let folder = dir.join("doc");
    put(&folder, "main.tex", "x");
    put(&folder, "sections/intro.tex", "x");
    assert_eq!(
        plain_file_below(&folder, "main.tex"),
        Some(folder.join("main.tex"))
    );
    assert_eq!(
        plain_file_below(&folder, "./sections/intro.tex"),
        Some(folder.join("sections").join("intro.tex"))
    );
    // A folder is not a file, a missing file is nothing, and so is a way out.
    assert_eq!(plain_file_below(&folder, "sections"), None);
    assert_eq!(plain_file_below(&folder, "missing.tex"), None);
    assert_eq!(plain_file_below(&folder, "../outside.tex"), None);
    assert_eq!(plain_file_below(&folder, "main.tex/x"), None);
}

#[test]
fn a_link_on_the_way_makes_a_path_nothing_even_when_it_stays_inside() {
    let dir = Dir::new("paths-links");
    let folder = dir.join("doc");
    let outside = dir.join("outside");
    put(&folder, "main.tex", "x");
    put(&outside, "secret.tex", "SECRET");
    put(&outside, "folder/inner.tex", "SECRET");
    if !link(
        &outside.join("secret.tex"),
        &folder.join("stolen.tex"),
        false,
    ) {
        return;
    }
    assert!(link(&outside.join("folder"), &folder.join("stolen"), true));
    assert!(link(
        &folder.join("main.tex"),
        &folder.join("alias.tex"),
        false
    ));
    assert_eq!(plain_file_below(&folder, "stolen.tex"), None);
    assert_eq!(plain_file_below(&folder, "stolen/inner.tex"), None);
    assert_eq!(plain_file_below(&folder, "alias.tex"), None);
    assert!(plain_file_below(&folder, "main.tex").is_some());
    assert!(!plain_folders_below(&folder, "stolen"));
    assert!(!plain_folders_below(&folder, "stolen/deeper"));
    assert!(!really_inside(&folder, &folder.join("stolen")));
}

#[test]
fn folders_are_plain_when_they_exist_and_may_not_exist_yet() {
    let dir = Dir::new("paths-folders");
    let base = dir.join("vault");
    fs::create_dir_all(base.join("a/b")).unwrap();
    assert!(plain_folders_below(&base, "a/b"));
    assert!(plain_folders_below(&base, "a/b/not/made/yet"));
    assert!(plain_folders_below(&base, ""));
    // A file where a folder is wanted is not a plain folder.
    put(&base, "file", "x");
    assert!(!plain_folders_below(&base, "file"));
    assert!(!plain_folders_below(&base, "file/inside"));
    assert!(really_inside(&base, &base.join("a/b")));
    assert!(!really_inside(&base, &dir.join("vault-other")));
    assert!(!really_inside(&base, &base.join("missing")));
}
