//! A preview build: proposed text built in a scratch folder that is gone
//! afterwards, with the document's own build folder and files untouched.

use std::fs;
use std::sync::Mutex;

use super::support::{Dir, FOLDER, job, put, vault, wrap};
use crate::plugins::latex::build::{PREVIEW_PARENT, preview_dir};
use crate::plugins::latex::engines::Engine;
use crate::plugins::latex::log::Severity;
use crate::plugins::latex::preview::run_in;
use crate::plugins::latex::service::Ended;
use crate::plugins::latex::snapshot::Buffer;

const NAME: &str = "test-preview";

fn proposed(dir: &Dir, mode: &'static str) -> (crate::plugins::latex::preview::Previewed, String) {
    let root = vault(dir);
    let mut probe = job(&root, Engine::Tectonic);
    probe.scratch = Some(NAME.to_owned());
    let wrapped = wrap(mode, probe.out(), "main", None);
    let seen = Mutex::new(String::new());
    let spy = |spec: crate::plugins::latex::engines::CommandSpec| {
        let text = fs::read_to_string(spec.cwd.join("sections/intro.tex")).unwrap_or_default();
        *seen.lock().unwrap() = text;
        wrapped(spec)
    };
    let mut real = job(&root, Engine::Tectonic);
    real.buffers = vec![Buffer {
        path: format!("{FOLDER}/sections/intro.tex"),
        text: "Proposed words.\n".to_owned(),
    }];
    let made = run_in(real, NAME, &spy);
    let text = seen.lock().unwrap().clone();
    (made, text)
}

#[test]
fn the_engine_builds_the_proposed_text_and_the_files_stay_as_they_were() {
    let dir = Dir::new("preview-text");
    let (made, seen) = proposed(&dir, "fail");
    assert_eq!(
        seen, "Proposed words.\n",
        "the engine read the proposed text"
    );
    assert_eq!(made.outcome.ended, Ended::Failed);
    let errors = made
        .outcome
        .diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .count();
    assert_eq!(errors, 1);
    let root = dir.join("vault");
    assert_eq!(
        fs::read_to_string(root.join(format!("{FOLDER}/sections/intro.tex"))).unwrap(),
        "Hello.\n"
    );
}

#[test]
fn the_documents_own_build_and_its_last_good_pdf_are_not_touched_and_the_scratch_is_removed() {
    let dir = Dir::new("preview-clean");
    let root = vault(&dir);
    // The last good build, as the window's builds leave it.
    let own = root.join(kasten_core::latex::build_dir(FOLDER)).join("out");
    put(&own, "main.pdf", "%PDF-1.4\nlast good\n");
    put(&own, "main.log", "(./main.tex\n)\n");
    let (made, _) = proposed(&dir, "ok");
    assert_eq!(made.outcome.ended, Ended::Done);
    assert!(made.fetched_packages, "the engine said it fetched packages");
    assert_eq!(
        fs::read_to_string(own.join("main.pdf")).unwrap(),
        "%PDF-1.4\nlast good\n"
    );
    assert_eq!(
        fs::read_to_string(own.join("main.log")).unwrap(),
        "(./main.tex\n)\n"
    );
    assert!(
        !root.join(preview_dir(NAME)).exists(),
        "scratch folder removed"
    );
    assert!(
        fs::read_dir(root.join(PREVIEW_PARENT))
            .unwrap()
            .next()
            .is_none(),
        "nothing left in the preview folder"
    );
}

#[test]
fn a_scratch_folder_that_is_not_old_is_left_alone_by_the_sweep() {
    let dir = Dir::new("preview-sweep");
    let root = vault(&dir);
    put(&root, &format!("{PREVIEW_PARENT}/fresh/tree/x.tex"), "x");
    let (made, _) = proposed(&dir, "ok");
    assert_eq!(made.outcome.ended, Ended::Done);
    assert!(root.join(PREVIEW_PARENT).join("fresh").exists());
}
