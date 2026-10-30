//! One whole build with the fake engine: the tree, the command, the log and
//! the PDF read back, and what a hostile log or document cannot make it do.

use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use super::support::{Dir, FOLDER, job, link, put, vault, wrap};
use crate::plugins::latex::build::{Job, execute};
use crate::plugins::latex::engines::Engine;
use crate::plugins::latex::log::Severity;
use crate::plugins::latex::service::{Ended, Outcome};
use crate::plugins::latex::snapshot::Buffer;

fn go(job: &Job, mode: &'static str, cancel: &AtomicBool) -> Outcome {
    let wrapped = wrap(mode, job.out(), "main", None);
    execute(job, cancel, &|_| {}, &wrapped)
}

fn seen(job: &Job) -> String {
    fs::read_to_string(job.out().join("seen.txt")).unwrap()
}

#[test]
fn a_build_that_works_makes_a_pdf_in_the_cache_and_nowhere_else() {
    let dir = Dir::new("build-ok");
    let root = vault(&dir);
    let job = job(&root, Engine::Tectonic);
    let notes = std::sync::Mutex::new(Vec::new());
    let wrapped = wrap("ok", job.out(), "main", None);
    let outcome = execute(
        &job,
        &AtomicBool::new(false),
        &|text| notes.lock().unwrap().push(text.to_owned()),
        &wrapped,
    );
    assert_eq!(outcome.ended, Ended::Done, "{outcome:?}");
    assert!(outcome.pdf && outcome.error.is_none());
    assert!(outcome.diagnostics.is_empty());
    assert_eq!(*notes.lock().unwrap(), ["Downloading TeX packages…"]);

    // The output is in .kasten/cache/latex/<hash>/out, which is where core says builds go.
    let cache = root.join(kasten_core::latex::build_dir(FOLDER));
    assert!(cache.join("out/main.pdf").is_file());
    assert_eq!(job.out(), cache.join("out"));
    // The document's folder holds only what the person put there.
    let mut names: Vec<String> = fs::read_dir(job.src())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["main.tex", "sections"]);

    // The engine ran in the tree, with the flags that keep it there.
    let text = seen(&job);
    for flag in [
        "-X",
        "compile",
        "main.tex",
        "--untrusted",
        "--synctex",
        "--outdir",
    ] {
        assert!(
            text.lines().any(|l| l == flag),
            "{flag} missing from\n{text}"
        );
    }
    assert!(text.contains("TECTONIC_UNTRUSTED_MODE=1"), "{text}");
    assert!(text.contains("files=main.tex,sections"), "{text}");
    assert!(text.contains("intro=Hello."), "{text}");
    let cwd = text.lines().find_map(|l| l.strip_prefix("cwd=")).unwrap();
    assert!(cwd.replace('\\', "/").ends_with("/tree"), "{cwd}");
}

#[test]
fn a_latexmk_build_gets_the_paranoid_file_rules_in_its_environment() {
    let dir = Dir::new("build-latexmk");
    let root = vault(&dir);
    let job = job(&root, Engine::LatexmkXe);
    let outcome = go(&job, "ok", &AtomicBool::new(false));
    assert_eq!(outcome.ended, Ended::Done, "{outcome:?}");
    let text = seen(&job);
    for wanted in [
        "-xelatex",
        "-no-shell-escape",
        "-norc",
        "-interaction=nonstopmode",
        "openin_any=p",
        "openout_any=p",
    ] {
        assert!(
            text.lines().any(|l| l == wanted),
            "{wanted} missing from\n{text}"
        );
    }
    assert!(text.contains("TECTONIC_UNTRUSTED_MODE="), "{text}");
}

#[test]
fn unsaved_text_is_what_the_engine_sees() {
    let dir = Dir::new("build-buffers");
    let root = vault(&dir);
    let mut job = job(&root, Engine::Tectonic);
    job.buffers = vec![Buffer {
        path: format!("{FOLDER}/sections/intro.tex"),
        text: "Typed, not saved yet.\n".to_owned(),
    }];
    let outcome = go(&job, "ok", &AtomicBool::new(false));
    assert_eq!(outcome.ended, Ended::Done);
    assert!(seen(&job).contains("intro=Typed, not saved yet."));
    // The saved file is as it was.
    assert_eq!(
        fs::read_to_string(job.src().join("sections/intro.tex")).unwrap(),
        "Hello.\n"
    );
}

#[test]
fn a_buffer_that_leaves_the_folder_stops_the_build_before_anything_runs() {
    let dir = Dir::new("build-escape-buffer");
    let root = vault(&dir);
    let mut job = job(&root, Engine::Tectonic);
    job.buffers = vec![Buffer {
        path: format!("{FOLDER}/../../../../notes/secret.md"),
        text: "overwritten".to_owned(),
    }];
    let outcome = go(&job, "ok", &AtomicBool::new(false));
    assert_eq!(outcome.ended, Ended::Failed);
    assert_eq!(outcome.error.map(|e| e.kind), Some("snapshot"));
    assert!(!job.out().join("seen.txt").exists(), "the engine ran");
    assert_eq!(
        fs::read_to_string(root.join("notes/secret.md")).unwrap(),
        "do not read\n"
    );
}

#[test]
fn errors_come_back_with_the_file_and_line_to_jump_to() {
    let dir = Dir::new("build-fail");
    let root = vault(&dir);
    let job = job(&root, Engine::Tectonic);
    let outcome = go(&job, "fail", &AtomicBool::new(false));
    assert_eq!(outcome.ended, Ended::Failed);
    assert!(!outcome.pdf);
    let error = outcome
        .diagnostics
        .iter()
        .find(|d| d.severity == Severity::Error)
        .unwrap();
    assert_eq!(error.file.as_deref(), Some("main.tex"));
    assert_eq!(error.line, Some(3));
    assert!(
        error.message.contains("Undefined control sequence"),
        "{error:?}"
    );
}

#[test]
fn file_names_in_a_log_are_only_reported_when_they_are_files_of_the_document() {
    let dir = Dir::new("build-escape-log");
    let root = vault(&dir);
    let job = job(&root, Engine::LatexmkPdf);
    let outcome = go(&job, "escape", &AtomicBool::new(false));
    assert_eq!(outcome.ended, Ended::Failed);
    let files: Vec<(Option<&str>, Option<u32>)> = outcome
        .diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .map(|d| (d.file.as_deref(), d.line))
        .collect();
    assert_eq!(
        files,
        [
            (None, Some(1)),                       // /etc/passwd
            (None, Some(2)),                       // ../../notes/secret.md
            (None, Some(3)),                       // C:\Windows\win.ini
            (Some("sections/intro.tex"), Some(4)), // a file of the document
            (None, Some(5)),                       // a file that is not there
            (Some("sections/intro.tex"), Some(6)), // the same, named by its path in the tree
        ]
    );
}

#[test]
fn a_build_with_no_output_gets_the_last_line_the_engine_printed() {
    let dir = Dir::new("build-silent");
    let root = vault(&dir);
    let job = job(&root, Engine::Tectonic);
    let outcome = go(&job, "silent", &AtomicBool::new(false));
    assert_eq!(outcome.ended, Ended::Failed);
    let first = &outcome.diagnostics[0];
    assert_eq!(first.severity, Severity::Error);
    // (The test program that plays the engine starts its line with its own "test … ...".)
    assert!(
        first.message.ends_with("fatal: the engine is confused"),
        "{}",
        first.message
    );
    assert_eq!(first.file, None);
}

#[test]
fn a_build_that_ends_well_without_a_pdf_is_a_failure_with_a_sentence() {
    let dir = Dir::new("build-nopdf");
    let root = vault(&dir);
    let job = job(&root, Engine::Tectonic);
    let outcome = go(&job, "nopdf", &AtomicBool::new(false));
    assert_eq!(outcome.ended, Ended::Failed);
    assert!(!outcome.pdf);
    assert_eq!(
        outcome.error.map(|e| e.message),
        Some("The build finished without making a PDF".to_owned())
    );
}

#[test]
fn an_old_pdf_is_not_taken_for_the_new_one_after_a_failure() {
    let dir = Dir::new("build-old-pdf");
    let root = vault(&dir);
    let job = job(&root, Engine::Tectonic);
    assert_eq!(go(&job, "ok", &AtomicBool::new(false)).ended, Ended::Done);
    let failed = go(&job, "fail", &AtomicBool::new(false));
    assert_eq!(failed.ended, Ended::Failed);
    assert!(
        !failed.pdf,
        "the first build's PDF was reported for the second"
    );
    // The last good PDF is still there for the window to keep showing.
    assert!(job.out().join("main.pdf").is_file());
}

#[test]
fn the_last_builds_log_is_not_read_as_this_builds() {
    let dir = Dir::new("build-stale-log");
    let root = vault(&dir);
    let job = job(&root, Engine::LatexmkPdf);
    let first = go(&job, "fail", &AtomicBool::new(false));
    assert!(first.diagnostics.iter().any(|d| d.line == Some(3)));
    // The second build writes no log at all.
    let second = go(&job, "silent", &AtomicBool::new(false));
    assert_eq!(second.ended, Ended::Failed);
    assert!(
        !second
            .diagnostics
            .iter()
            .any(|d| d.message.contains("Undefined control sequence")),
        "{second:?}"
    );
}

#[test]
fn the_output_folder_must_be_a_plain_folder() {
    let dir = Dir::new("build-out-link");
    let root = vault(&dir);
    let job = job(&root, Engine::Tectonic);
    let outside = dir.join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::create_dir_all(job.build()).unwrap();
    if link(&outside, &job.out(), true) {
        let outcome = go(&job, "ok", &AtomicBool::new(false));
        assert_eq!(outcome.ended, Ended::Failed);
        assert_eq!(outcome.error.map(|e| e.kind), Some("snapshot"));
        assert_eq!(fs::read_dir(&outside).unwrap().count(), 0);
    }
}

#[test]
fn the_pdf_and_synctex_are_only_read_from_a_cache_without_links() {
    use crate::plugins::latex::build::built_places;
    let dir = Dir::new("build-places");
    let root = vault(&dir);
    let job = job(&root, Engine::Tectonic);
    // Before any build there is nothing in the way.
    assert_eq!(built_places(&root, FOLDER), Some((job.tree(), job.out())));
    let outside = dir.join("outside");
    fs::create_dir_all(&outside).unwrap();
    fs::create_dir_all(root.join(".kasten/cache")).unwrap();
    if link(&outside, &root.join(".kasten/cache/latex"), true) {
        assert_eq!(built_places(&root, FOLDER), None);
    }
}

#[test]
fn the_time_limit_stops_a_build_and_says_so() {
    let dir = Dir::new("build-timeout");
    let root = vault(&dir);
    let mut job = job(&root, Engine::Tectonic);
    job.timeout = Duration::from_millis(500);
    let outcome = go(&job, "hang", &AtomicBool::new(false));
    assert_eq!(outcome.ended, Ended::Failed);
    let error = outcome.error.unwrap();
    assert_eq!(error.kind, "timeout");
    assert!(
        error.message.starts_with("The build took longer than"),
        "{}",
        error.message
    );
}

#[test]
fn cancel_ends_a_build_and_reports_it_cancelled() {
    let dir = Dir::new("build-cancel");
    let root = vault(&dir);
    let job = job(&root, Engine::Tectonic);
    let cancel = AtomicBool::new(false);
    let outcome = std::thread::scope(|scope| {
        scope.spawn(|| {
            std::thread::sleep(Duration::from_millis(500));
            cancel.store(true, Ordering::Relaxed);
        });
        go(&job, "hang", &cancel)
    });
    assert_eq!(outcome.ended, Ended::Cancelled);
    assert!(outcome.diagnostics.is_empty() && outcome.error.is_none() && !outcome.pdf);
}

#[test]
fn an_engine_that_cannot_start_is_a_failure_with_a_sentence() {
    let dir = Dir::new("build-no-program");
    let root = vault(&dir);
    let job = job(&root, Engine::Tectonic);
    let outcome = execute(&job, &AtomicBool::new(false), &|_| {}, &|spec| spec);
    assert_eq!(outcome.ended, Ended::Failed);
    let error = outcome.error.unwrap();
    assert_eq!(error.kind, "engine-failed");
    assert!(
        error
            .message
            .starts_with("The LaTeX engine could not be started"),
        "{}",
        error.message
    );
}

#[test]
fn a_planted_program_in_the_document_is_neither_run_nor_copied() {
    let dir = Dir::new("build-planted");
    let root = vault(&dir);
    put(&root, &format!("{FOLDER}/tectonic.exe"), "not a program");
    put(&root, &format!("{FOLDER}/latexmk.exe"), "not a program");
    put(&root, &format!("{FOLDER}/latexmkrc"), "system('echo hi');");
    let job = job(&root, Engine::LatexmkPdf);
    let outcome = go(&job, "ok", &AtomicBool::new(false));
    assert_eq!(outcome.ended, Ended::Done);
    let text = seen(&job);
    assert!(text.contains("files=main.tex,sections"), "{text}");
}
