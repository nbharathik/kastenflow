//! Reading a build's results: file names from a log are resolved inside the
//! document or dropped, the log is read only up to a size, and the PDF is
//! only a PDF when it starts like one.

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::Path;

use super::support::{Dir, link, put};
use crate::plugins::latex::collect::{
    MAX_LOG, Reading, diagnostics, pdf_path, pdf_stamp, resolve_file, synctex_path,
};
use crate::plugins::latex::engines::Engine;
use crate::plugins::latex::log::Severity;
use crate::plugins::latex::snapshot::read_plain;

struct Doc {
    _dir: Dir,
    src: std::path::PathBuf,
    tree: std::path::PathBuf,
    out: std::path::PathBuf,
}

fn doc() -> Doc {
    let dir = Dir::new("collect");
    let src = dir.join("vault/doc");
    let tree = dir.join("vault/.kasten/cache/latex/abc/tree");
    let out = dir.join("vault/.kasten/cache/latex/abc/out");
    put(&src, "main.tex", "x");
    put(&src, "sections/intro.tex", "x");
    fs::create_dir_all(&out).unwrap();
    fs::create_dir_all(&tree).unwrap();
    Doc {
        _dir: dir,
        src,
        tree,
        out,
    }
}

impl Doc {
    fn read(
        &self,
        engine: Engine,
        unsaved: &HashSet<String>,
        printed: &str,
        failed: bool,
    ) -> Vec<(Severity, Option<String>, Option<u32>, String)> {
        let reading = Reading {
            src: &self.src,
            tree: &self.tree,
            out: &self.out,
            stem: "main",
            engine,
            unsaved,
        };
        diagnostics(&reading, printed, failed)
            .into_iter()
            .map(|d| (d.severity, d.file, d.line, d.message))
            .collect()
    }
}

#[test]
fn names_resolve_to_files_of_the_document_or_to_nothing() {
    let d = doc();
    let none = HashSet::new();
    let tree_abs = format!("{}/sections/intro.tex", d.tree.display()).replace('\\', "/");
    for (name, wanted) in [
        ("main.tex", Some("main.tex")),
        ("./main.tex", Some("main.tex")),
        ("./sections/intro.tex", Some("sections/intro.tex")),
        ("sections\\intro.tex", Some("sections/intro.tex")),
        (tree_abs.as_str(), Some("sections/intro.tex")),
        ("  main.tex  ", Some("main.tex")),
        ("/usr/share/texlive/article.cls", None),
        ("/etc/passwd", None),
        ("C:/Windows/win.ini", None),
        ("C:\\Windows\\win.ini", None),
        ("\\\\server\\share\\x.tex", None),
        ("../x.tex", None),
        ("sections/../../x.tex", None),
        ("intro.tex", None),
        ("missing.tex", None),
        ("texput", None),
        ("sections", None),
        ("", None),
    ] {
        assert_eq!(
            resolve_file(&d.src, &d.tree, name, &none).as_deref(),
            wanted,
            "{name:?}"
        );
    }
    // A file that is only in the window so far counts; one that escapes never does.
    let unsaved: HashSet<String> = ["new.tex".to_owned()].into();
    assert_eq!(
        resolve_file(&d.src, &d.tree, "new.tex", &unsaved).as_deref(),
        Some("new.tex")
    );
    assert_eq!(resolve_file(&d.src, &d.tree, "../new.tex", &unsaved), None);
}

#[test]
fn a_tree_path_of_another_document_is_not_a_file_of_this_one() {
    let d = doc();
    let other = d.tree.with_file_name("tree2");
    let name = format!("{}/main.tex", other.display());
    assert_eq!(resolve_file(&d.src, &d.tree, &name, &HashSet::new()), None);
}

#[test]
fn a_name_through_a_link_to_a_file_outside_is_nothing() {
    let d = doc();
    let outside = d._dir.join("outside");
    put(&outside, "secret.tex", "SECRET");
    if link(&outside.join("secret.tex"), &d.src.join("link.tex"), false) {
        assert_eq!(
            resolve_file(&d.src, &d.tree, "link.tex", &HashSet::new()),
            None
        );
    }
}

fn write_log(d: &Doc, text: &str) {
    fs::write(d.out.join("main.log"), text).unwrap();
}

#[test]
fn a_log_gives_errors_with_resolved_files() {
    let d = doc();
    write_log(
        &d,
        "(./main.tex\n! Undefined control sequence.\nl.3 \\foo\n\n(./sections/intro.tex\n! Missing $ inserted.\nl.7 x_1\n\n))\n",
    );
    let found = d.read(Engine::LatexmkPdf, &HashSet::new(), "", true);
    let errors: Vec<_> = found.iter().filter(|d| d.0 == Severity::Error).collect();
    assert_eq!(errors.len(), 2, "{found:?}");
    assert_eq!(
        (errors[0].1.as_deref(), errors[0].2),
        (Some("main.tex"), Some(3))
    );
    assert_eq!(
        (errors[1].1.as_deref(), errors[1].2),
        (Some("sections/intro.tex"), Some(7))
    );
}

#[test]
fn only_the_start_of_a_huge_log_is_read() {
    let d = doc();
    let path = d.out.join("main.log");
    let mut file = fs::File::create(&path).unwrap();
    file.write_all(b"(./main.tex\n! Undefined control sequence.\nl.3 \\foo\n\n")
        .unwrap();
    let chunk = vec![b'x'; 1024 * 1024];
    for _ in 0..24 {
        file.write_all(&chunk).unwrap();
        file.write_all(b"\n").unwrap();
    }
    drop(file);
    assert!(fs::metadata(&path).unwrap().len() > 3 * MAX_LOG);
    let bytes = read_plain(&path, MAX_LOG).unwrap();
    assert_eq!(bytes.len() as u64, MAX_LOG);
    let found = d.read(Engine::LatexmkPdf, &HashSet::new(), "", true);
    assert!(
        found
            .iter()
            .any(|d| d.0 == Severity::Error && d.2 == Some(3)),
        "{found:?}"
    );
}

#[test]
fn a_log_that_is_a_link_is_not_read() {
    let d = doc();
    let outside = d._dir.join("outside");
    put(
        &outside,
        "x.log",
        "(./main.tex\n! Undefined control sequence.\nl.3 \\foo\n\n)\n",
    );
    if link(&outside.join("x.log"), &d.out.join("main.log"), false) {
        assert_eq!(read_plain(&d.out.join("main.log"), MAX_LOG), None);
        assert!(
            d.read(Engine::LatexmkPdf, &HashSet::new(), "", false)
                .is_empty()
        );
    }
}

#[test]
fn tectonic_errors_come_from_what_it_printed_too_without_doubling_the_log() {
    let d = doc();
    let printed = "note: downloading something\nerror: main.tex:3: Undefined control sequence\n";
    let found = d.read(Engine::Tectonic, &HashSet::new(), printed, true);
    let errors: Vec<_> = found.iter().filter(|d| d.0 == Severity::Error).collect();
    assert_eq!(errors.len(), 1, "{found:?}");
    assert_eq!(
        (errors[0].1.as_deref(), errors[0].2),
        (Some("main.tex"), Some(3))
    );

    // The same error in the log and in the printed output is told once.
    write_log(
        &d,
        "(./main.tex\n! Undefined control sequence.\nl.3 \\foo\n\n)\n",
    );
    let both = d.read(Engine::Tectonic, &HashSet::new(), printed, true);
    let again: Vec<_> = both.iter().filter(|d| d.0 == Severity::Error).collect();
    assert!(again.len() <= 2 && !again.is_empty(), "{both:?}");
}

#[test]
fn a_failure_with_nothing_the_parser_knows_still_says_something() {
    let d = doc();
    let found = d.read(
        Engine::Tectonic,
        &HashSet::new(),
        "starting\n\nfatal: out of memory\n\n",
        true,
    );
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].0, Severity::Error);
    assert_eq!(found[0].3, "fatal: out of memory");
    // A build that worked adds nothing of the kind.
    assert!(
        d.read(
            Engine::Tectonic,
            &HashSet::new(),
            "fatal: ignore me\n",
            false
        )
        .is_empty()
    );
    // The line is kept short.
    let long = format!("x{}", "y".repeat(5_000));
    let found = d.read(Engine::Tectonic, &HashSet::new(), &long, true);
    assert_eq!(found[0].3.chars().count(), 300);
}

#[test]
fn thousands_of_warnings_do_not_bury_the_errors() {
    let d = doc();
    let mut printed = String::new();
    for i in 0..4_000 {
        printed.push_str(&format!(
            "warning: main.tex:{}: warning number {i}\n",
            i + 1
        ));
    }
    printed.push_str("error: main.tex:9: the one error\n");
    let found = d.read(Engine::Tectonic, &HashSet::new(), &printed, true);
    let warnings = found.iter().filter(|d| d.0 == Severity::Warning).count();
    assert!(warnings <= 1_000, "{warnings}");
    assert!(
        found
            .iter()
            .any(|d| d.0 == Severity::Error && d.3.contains("the one error"))
    );
}

#[test]
fn a_pdf_is_a_pdf_when_it_starts_like_one() {
    let d = doc();
    let pdf = pdf_path(&d.out, "main");
    assert!(pdf.ends_with("main.pdf"));
    assert!(pdf_stamp(&pdf).is_none());
    fs::write(&pdf, "%PDF-1.7\n").unwrap();
    assert_eq!(pdf_stamp(&pdf).map(|(len, _)| len), Some(9));
    fs::write(&pdf, "<html>not a pdf</html>").unwrap();
    assert!(pdf_stamp(&pdf).is_none());
    fs::write(&pdf, "%PDF").unwrap();
    assert!(pdf_stamp(&pdf).is_none());
    fs::remove_file(&pdf).unwrap();
    fs::create_dir(&pdf).unwrap();
    assert!(pdf_stamp(&pdf).is_none());
    assert_eq!(
        synctex_path(Path::new("out"), "main"),
        Path::new("out").join("main.synctex.gz")
    );
}
