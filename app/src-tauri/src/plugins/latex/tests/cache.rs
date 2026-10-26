//! The one place a build removes anything reaches only below the build's own
//! folder, and never through a link.

use std::fs;

use super::support::{Dir, link, put};
use crate::plugins::latex::cache::forget;

#[test]
fn only_what_is_strictly_below_the_build_folder_goes() {
    let dir = Dir::new("cache-guard");
    let build = dir.join("vault/.kasten/cache/latex/abc");
    put(&build, "tree/a.tex", "x");
    put(&build, "tree/sub/b.tex", "x");
    put(&dir.join("vault"), "notes/mine.md", "KEEP");
    put(&dir.join("vault/.kasten/cache/latex"), "abc2/c.tex", "KEEP");

    // Not the folder itself, not outside it, not a neighbour whose name starts alike.
    assert!(!forget(&build, &build));
    assert!(!forget(&build, &dir.join("vault/notes/mine.md")));
    assert!(!forget(
        &build,
        &dir.join("vault/.kasten/cache/latex/abc2/c.tex")
    ));
    // Climbing out with `..` is refused even though it starts below the folder.
    let sneaky = build
        .join("tree")
        .join("..")
        .join("..")
        .join("abc2")
        .join("c.tex");
    assert!(!forget(&build, &sneaky));
    assert!(dir.join("vault/notes/mine.md").is_file());
    assert!(dir.join("vault/.kasten/cache/latex/abc2/c.tex").is_file());
    assert!(build.join("tree/a.tex").is_file());

    // What is below it goes: a file, then a folder with what is in it.
    assert!(forget(&build, &build.join("tree/a.tex")));
    assert!(!build.join("tree/a.tex").exists());
    assert!(forget(&build, &build.join("tree/sub")));
    assert!(!build.join("tree/sub").exists());
    // Nothing there: nothing removed.
    assert!(!forget(&build, &build.join("tree/missing")));
}

#[test]
fn a_link_on_the_way_out_of_the_cache_is_not_followed_and_the_link_alone_goes() {
    let dir = Dir::new("cache-link");
    let build = dir.join("vault/.kasten/cache/latex/abc");
    let outside = dir.join("vault/notes");
    put(&outside, "mine.md", "KEEP");
    put(&outside, "deep/more.md", "KEEP");
    fs::create_dir_all(build.join("tree")).unwrap();
    if !link(&outside, &build.join("tree/way-out"), true) {
        return;
    }
    assert!(link(
        &outside.join("mine.md"),
        &build.join("tree/file-link.tex"),
        false
    ));

    // Below a link: refused.
    assert!(!forget(&build, &build.join("tree/way-out/mine.md")));
    assert!(!forget(&build, &build.join("tree/way-out/deep")));
    assert!(outside.join("mine.md").is_file() && outside.join("deep/more.md").is_file());

    // The link itself goes; what it pointed to stays.
    assert!(forget(&build, &build.join("tree/way-out")));
    assert!(forget(&build, &build.join("tree/file-link.tex")));
    assert!(!build.join("tree/way-out").exists());
    assert!(outside.join("mine.md").is_file() && outside.join("deep/more.md").is_file());
}

#[test]
fn a_build_folder_that_is_itself_a_link_is_never_cleaned() {
    let dir = Dir::new("cache-link-root");
    let elsewhere = dir.join("elsewhere");
    put(&elsewhere, "tree/a.tex", "KEEP");
    let build = dir.join("build");
    if !link(&elsewhere, &build, true) {
        return;
    }
    assert!(!forget(&build, &build.join("tree/a.tex")));
    assert!(!forget(&build, &build.join("tree")));
    assert!(elsewhere.join("tree/a.tex").is_file());
}
