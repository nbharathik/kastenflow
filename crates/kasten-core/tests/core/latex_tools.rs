//! What the LaTeX tools of an agent stand on: finding a document by the name
//! an agent gives, listing its source files, and reading the diagnostics of
//! the last build from the build cache (the app builds; the cache holds what
//! the engine said).

use crate::common;

use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use common::{TempVault, dev_vault};
use kasten_core::latex::{Severity, build_dir};
use kasten_core::{Error, Kasten};

const BASE: &str = "projects/photo-organiser/latex";
const ARTICLE: &str = "projects/photo-organiser/latex/article";
const PAPER: &str = "projects/photo-organiser/latex/paper30";

fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn fixtures() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/latex")
}

fn open() -> (TempVault, Kasten) {
    let t = dev_vault();
    for name in ["article", "paper30", "twocolumn"] {
        copy_dir(
            &fixtures().join(name),
            &t.vault.root().join(BASE).join(name),
        );
    }
    let k = Kasten::open(t.vault.root()).unwrap();
    (t, k)
}

/// Leaves `log` as the log of the last build of the document in `folder`.
fn leave_log(t: &TempVault, folder: &str, stem: &str, log: &str) -> std::path::PathBuf {
    let out = t.vault.root().join(build_dir(folder)).join("out");
    fs::create_dir_all(&out).unwrap();
    let file = out.join(format!("{stem}.log"));
    fs::write(&file, log).unwrap();
    file
}

fn fixture_log(name: &str) -> String {
    fs::read_to_string(fixtures().join("logs").join(name)).unwrap()
}

fn invalid(result: Result<impl std::fmt::Debug, Error>) -> String {
    match result {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn a_document_is_found_by_its_folder_its_title_or_a_file_in_it() {
    let (_t, k) = open();
    for name in [
        ARTICLE,
        &format!("{ARTICLE}/"),
        "article",
        "ARTICLE",
        &format!("{ARTICLE}/main.tex"),
    ] {
        assert_eq!(k.latex_find_doc(name).unwrap().folder, ARTICLE, "{name}");
    }
    let nested = k
        .latex_find_doc(&format!("{PAPER}/sections/method.tex"))
        .unwrap();
    assert_eq!(nested.folder, PAPER);
}

#[test]
fn a_name_that_is_no_document_or_is_two_says_what_to_do() {
    let (t, k) = open();
    let none = invalid(k.latex_find_doc("no such paper"));
    assert!(none.contains("No LaTeX document called"), "{none}");
    assert!(none.contains("latex_list"), "{none}");
    assert!(invalid(k.latex_find_doc("")).contains("latex_list"));
    // Two documents with one folder name: the title cannot say which.
    copy_dir(
        &fixtures().join("article"),
        &t.vault.root().join("library/latex/article"),
    );
    let two = invalid(k.latex_find_doc("article"));
    assert!(
        two.contains(ARTICLE) && two.contains("library/latex/article"),
        "{two}"
    );
    // A folder is exact.
    assert_eq!(
        k.latex_find_doc("library/latex/article").unwrap().folder,
        "library/latex/article"
    );
}

#[test]
fn the_source_files_of_a_document_are_listed_relative_to_its_folder() {
    let (t, k) = open();
    let doc = k.latex_find_doc("paper30").unwrap();
    let files = k.latex_files(&doc).unwrap();
    assert_eq!(files[0], "main.tex", "the root file first: {files:?}");
    for expected in [
        "refs.bib",
        "sections/introduction.tex",
        "sections/method.tex",
    ] {
        assert!(
            files.iter().any(|f| f == expected),
            "{expected} in {files:?}"
        );
    }
    // The settings file, pictures and hidden files are not sources.
    fs::write(t.vault.root().join(PAPER).join("figure.png"), b"x").unwrap();
    fs::write(t.vault.root().join(PAPER).join(".hidden.tex"), "x").unwrap();
    let files = k.latex_files(&doc).unwrap();
    assert!(
        !files
            .iter()
            .any(|f| f.ends_with(".yaml") || f.ends_with(".png") || f.contains(".hidden")),
        "{files:?}"
    );
}

#[test]
fn without_a_build_the_last_build_says_nothing_was_built() {
    let (_t, k) = open();
    let doc = k.latex_find_doc("article").unwrap();
    let last = k.latex_last_build(&doc).unwrap();
    assert!(!last.built);
    assert!(last.diagnostics.is_empty() && last.errors == 0 && last.warnings == 0);
}

#[test]
fn the_last_build_reads_the_log_the_app_left_with_files_inside_the_document() {
    let (t, k) = open();
    leave_log(
        &t,
        ARTICLE,
        "main",
        &fixture_log("undefined-control-sequence.log"),
    );
    let doc = k.latex_find_doc("article").unwrap();
    let last = k.latex_last_build(&doc).unwrap();
    assert!(last.built && !last.stale);
    assert_eq!(last.errors, 2, "{last:?}");
    let first = &last.diagnostics[0];
    assert_eq!(first.severity, Severity::Error);
    assert_eq!(first.file.as_deref(), Some("main.tex"));
    assert_eq!(first.line, Some(12));
    assert!(
        first.message.contains("Undefined control sequence"),
        "{first:?}"
    );
}

#[test]
fn the_last_build_keeps_the_tex_context_of_each_error() {
    let (t, k) = open();
    leave_log(
        &t,
        ARTICLE,
        "main",
        &fixture_log("undefined-control-sequence.log"),
    );
    let doc = k.latex_find_doc("article").unwrap();
    let last = k.latex_last_build(&doc).unwrap();
    let context = last.diagnostics[0].context.as_deref().unwrap();
    assert!(context.starts_with("l.12 \\sectoin"), "{context}");
    assert!(context.contains("{Introduction}"), "{context}");
}

#[test]
fn a_source_changed_after_the_build_makes_it_stale() {
    let (t, k) = open();
    leave_log(
        &t,
        ARTICLE,
        "main",
        &fixture_log("undefined-control-sequence.log"),
    );
    let doc = k.latex_find_doc("article").unwrap();
    assert!(!k.latex_last_build(&doc).unwrap().stale);
    // The file was changed after the build.
    let later = SystemTime::now() + Duration::from_secs(120);
    fs::File::options()
        .write(true)
        .open(t.vault.root().join(ARTICLE).join("main.tex"))
        .unwrap()
        .set_modified(later)
        .unwrap();
    assert!(k.latex_last_build(&doc).unwrap().stale);
}

#[test]
fn a_file_name_in_the_log_that_leaves_the_document_is_dropped() {
    let (t, k) = open();
    let hostile = "This is pdfTeX, Version 3.141592653-2.6-1.40.25 (TeX Live 2023)\n\
(/etc/passwd\n! Undefined control sequence.\nl.3 \\oops\n\n) \
(../../../notes/secret.md\n! Missing $ inserted.\nl.9 x\n\n) \
(./missing/not-there.tex\n! Emergency stop.\nl.1 y\n\n)\n";
    leave_log(&t, ARTICLE, "main", hostile);
    let doc = k.latex_find_doc("article").unwrap();
    let last = k.latex_last_build(&doc).unwrap();
    assert!(last.errors >= 2, "{last:?}");
    for d in &last.diagnostics {
        assert!(d.file.is_none(), "{d:?}");
    }
}

#[test]
fn a_log_that_is_a_link_is_not_followed() {
    let (t, k) = open();
    let secret = t.vault.root().join("secret.log");
    fs::write(&secret, fixture_log("missing-dollar.log")).unwrap();
    let out = t.vault.root().join(build_dir(ARTICLE)).join("out");
    fs::create_dir_all(&out).unwrap();
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(&secret, out.join("main.log")).is_ok();
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_file(&secret, out.join("main.log")).is_ok();
    if !linked {
        return; // no right to make links on this machine
    }
    let doc = k.latex_find_doc("article").unwrap();
    assert!(!k.latex_last_build(&doc).unwrap().built);
}

#[test]
fn a_cache_folder_that_is_a_link_is_not_followed() {
    let (t, k) = open();
    let outside =
        std::env::temp_dir().join(format!("kasten-last-build-out-{}", std::process::id()));
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("main.log"), fixture_log("missing-dollar.log")).unwrap();
    let cache = t.vault.root().join(build_dir(ARTICLE));
    fs::create_dir_all(&cache).unwrap();
    let out = cache.join("out");
    #[cfg(unix)]
    let linked = std::os::unix::fs::symlink(&outside, &out).is_ok();
    #[cfg(windows)]
    let linked = std::os::windows::fs::symlink_dir(&outside, &out).is_ok();
    if linked {
        let doc = k.latex_find_doc("article").unwrap();
        assert!(!k.latex_last_build(&doc).unwrap().built);
        let _ = fs::remove_dir(&out);
    }
    let _ = fs::remove_dir_all(&outside);
}

#[test]
fn a_log_that_is_a_folder_or_not_text_breaks_nothing() {
    let (t, k) = open();
    let doc = k.latex_find_doc("article").unwrap();
    let out = t.vault.root().join(build_dir(ARTICLE)).join("out");
    fs::create_dir_all(out.join("main.log")).unwrap();
    assert!(!k.latex_last_build(&doc).unwrap().built);
    fs::remove_dir(out.join("main.log")).unwrap();
    let noise: Vec<u8> = (0..20_000u32).map(|n| (n * 7 % 256) as u8).collect();
    fs::write(out.join("main.log"), noise).unwrap();
    let last = k.latex_last_build(&doc).unwrap();
    assert!(last.built);
    assert!(last.diagnostics.len() <= last.errors + last.warnings + last.notes);
}

#[test]
fn a_huge_log_is_read_only_up_to_a_limit() {
    let (t, k) = open();
    let mut log = fixture_log("undefined-control-sequence.log");
    log.push_str(&"filler line that says nothing at all\n".repeat(400_000));
    leave_log(&t, ARTICLE, "main", &log);
    let doc = k.latex_find_doc("article").unwrap();
    let last = k.latex_last_build(&doc).unwrap();
    assert!(last.built);
    assert_eq!(last.errors, 2);
}
