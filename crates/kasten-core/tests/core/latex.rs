//! LaTeX documents in the vault: finding them, their settings file, saving a
//! source file (plain, merged, kept in a copy, limits), starting a document,
//! search, Export PDF, and the build cache staying out of history.

use crate::common;

use std::fs;
use std::path::Path;

use common::{NOW, dev_vault};
use kasten_core::history::Actor;
use kasten_core::latex::{LatexConfig, MAX_SOURCE_BYTES, SourceSaved, build_dir};
use kasten_core::{Error, Kasten};

const BASE: &str = "projects/photo-organiser/latex";
const ARTICLE: &str = "projects/photo-organiser/latex/article";
const ARTICLE_MAIN: &str = "projects/photo-organiser/latex/article/main.tex";
const TWO: &str = "projects/photo-organiser/latex/twocolumn";

fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/latex")
        .join(name)
}

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

/// The dev vault with the three LaTeX fixtures in a project.
fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    for name in ["article", "twocolumn", "paper30"] {
        copy_dir(&fixture(name), &t.vault.root().join(BASE).join(name));
    }
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn put(t: &common::TempVault, path: &str, text: &str) {
    let file = t.vault.root().join(path);
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, text).unwrap();
}

fn text_of(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

fn invalid<T: std::fmt::Debug>(result: Result<T, Error>) -> String {
    match result {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected Error::Invalid, got {other:?}"),
    }
}

fn human() -> Actor {
    Actor::Human
}

fn agent() -> Actor {
    Actor::Agent {
        client: "claude-code".into(),
        session: "s1".into(),
    }
}

#[test]
fn the_listing_finds_documents_by_class_and_by_root_comment() {
    let (t, k) = open();
    // A root that only other files name: no \documentclass of its own.
    put(
        &t,
        &format!("{BASE}/book/book.tex"),
        "\\input{chapters/one}\n",
    );
    put(
        &t,
        &format!("{BASE}/book/chapters/one.tex"),
        "% !TEX root = ../book.tex\nWords.\n",
    );
    // A tex file that is neither.
    put(&t, "inbox/loose.tex", "just words\n");
    let docs = k.latex_docs().unwrap();
    let found: Vec<(&str, &str)> = docs
        .iter()
        .map(|d| (d.folder.as_str(), d.main.as_str()))
        .collect();
    assert_eq!(
        found,
        [
            (&*format!("{BASE}/article"), "main.tex"),
            (&*format!("{BASE}/book"), "book.tex"),
            (&*format!("{BASE}/paper30"), "main.tex"),
            (&*format!("{BASE}/twocolumn"), "main.tex"),
        ]
    );
    let by = |folder: &str| docs.iter().find(|d| d.folder.ends_with(folder)).unwrap();
    assert_eq!(
        (by("article").engine.as_str(), by("article").locked),
        ("tectonic", false)
    );
    assert_eq!(by("paper30").bibliography, "vault");
    assert_eq!(
        (by("twocolumn").engine.as_str(), by("twocolumn").locked),
        ("latexmk-pdf", true)
    );
    assert!(!by("book").has_config);
    // A section file belongs to its document.
    let section = format!("{BASE}/paper30/sections/method.tex");
    assert_eq!(k.latex_doc_of(&section).unwrap().unwrap().title, "paper30");
    assert!(k.latex_doc_of("inbox/loose.tex").unwrap().is_none());
}

#[test]
fn a_file_stops_being_a_root_when_its_class_goes() {
    let (t, k) = open();
    put(
        &t,
        &format!("{BASE}/solo/solo.tex"),
        "\\documentclass{article}\n",
    );
    assert!(
        k.latex_docs()
            .unwrap()
            .iter()
            .any(|d| d.folder.ends_with("/solo"))
    );
    // Same size and kept time would fool a cache that trusted both: the op forgets the file.
    let path = format!("{BASE}/solo/solo.tex");
    let file = k.source(&path).unwrap();
    k.save_source(
        &human(),
        &path,
        &file.hash,
        "\\documentclasZ{article}\n",
        NOW,
    )
    .unwrap();
    assert!(
        !k.latex_docs()
            .unwrap()
            .iter()
            .any(|d| d.folder.ends_with("/solo"))
    );
}

#[test]
fn the_settings_file_keeps_keys_it_does_not_know() {
    let (t, k) = open();
    let mut config = k.latex_config(TWO).unwrap();
    assert!(config.locked);
    assert_eq!(config.extra["review_stamp"], "2026-10-20");
    config.engine = Some("latexmk-lua".into());
    config.locked = false;
    k.set_latex_config(&human(), TWO, &config, NOW).unwrap();
    let again = k.latex_config(TWO).unwrap();
    assert_eq!(again, config);
    let text = text_of(&t, &format!("{TWO}/kasten-latex.yaml"));
    assert!(
        text.contains("review_stamp") && text.contains("latexmk-lua"),
        "{text}"
    );
    assert!(
        !k.latex_docs()
            .unwrap()
            .iter()
            .find(|d| d.folder == TWO)
            .unwrap()
            .locked
    );
    assert_eq!(
        k.log(None, 1).unwrap()[0].summary,
        "latex: settings for twocolumn"
    );
    // Saying the same again writes nothing.
    let commits = k.log(None, 50).unwrap().len();
    k.set_latex_config(&human(), TWO, &config, NOW).unwrap();
    assert_eq!(k.log(None, 50).unwrap().len(), commits);
}

#[test]
fn the_settings_are_a_persons_and_must_work() {
    let (t, k) = open();
    let config = LatexConfig::default();
    assert!(invalid(k.set_latex_config(&agent(), TWO, &config, NOW)).contains("person"));
    let bad = LatexConfig {
        engine: Some("word".into()),
        ..LatexConfig::default()
    };
    assert!(invalid(k.set_latex_config(&human(), TWO, &bad, NOW)).contains("engine"));
    let missing = LatexConfig {
        main: Some("nothing.tex".into()),
        ..LatexConfig::default()
    };
    assert!(invalid(k.set_latex_config(&human(), TWO, &missing, NOW)).contains("no file"));
    assert!(invalid(k.set_latex_config(&human(), "inbox", &config, NOW)).contains("not a LaTeX"));
    // A file nobody can read is not written over.
    put(
        &t,
        &format!("{TWO}/kasten-latex.yaml"),
        "engine: [unclosed\n",
    );
    assert!(invalid(k.set_latex_config(&human(), TWO, &config, NOW)).contains("could not be read"));
    assert_eq!(
        text_of(&t, &format!("{TWO}/kasten-latex.yaml")),
        "engine: [unclosed\n"
    );
}

#[test]
fn a_plain_save_is_written_byte_for_byte_and_committed_after_a_pause() {
    let (t, k) = open();
    let file = k.source(ARTICLE_MAIN).unwrap();
    assert!(file.text.contains("Gaussian"));
    // Windows line endings and no final newline survive.
    let text = "\\documentclass{article}\r\n\\begin{document}\r\nHello\r\n\\end{document}";
    let saved = k
        .save_source(&human(), ARTICLE_MAIN, &file.hash, text, NOW)
        .unwrap();
    assert!(matches!(saved, SourceSaved::Written { .. }));
    assert_eq!(
        fs::read(t.vault.root().join(ARTICLE_MAIN)).unwrap(),
        text.as_bytes()
    );
    assert_eq!(saved.file().hash, kasten_core::content_hash(text));
    // Typing waits for its commit like a page does.
    assert!(
        k.log(Some(ARTICLE_MAIN), 5)
            .unwrap()
            .iter()
            .all(|c| c.summary != "edit: main.tex")
    );
    assert!(k.commit_edits().unwrap().is_some());
    let log = k.log(Some(ARTICLE_MAIN), 1).unwrap();
    assert_eq!(
        (log[0].summary.as_str(), log[0].agent),
        ("edit: main.tex", false)
    );
    // The same text again is nothing to save.
    let again = k
        .save_source(&human(), ARTICLE_MAIN, &saved.file().hash, text, NOW)
        .unwrap();
    assert!(matches!(again, SourceSaved::Unchanged { .. }));
    assert!(k.commit_edits().unwrap().is_none());
}

#[test]
fn edits_on_other_lines_are_merged() {
    let (t, k) = open();
    let loaded = k.source(ARTICLE_MAIN).unwrap();
    // Another program changed the title line meanwhile.
    let theirs = loaded.text.replace("A Small Article", "A Larger Article");
    put(&t, ARTICLE_MAIN, &theirs);
    let ours = loaded.text.replace("fixed rate", "steady rate");
    let saved = k
        .save_source(&human(), ARTICLE_MAIN, &loaded.hash, &ours, NOW)
        .unwrap();
    assert!(matches!(saved, SourceSaved::Merged { .. }), "{saved:?}");
    let now = text_of(&t, ARTICLE_MAIN);
    assert!(now.contains("A Larger Article") && now.contains("steady rate"));
    assert_eq!(saved.file().text, now);
}

#[test]
fn edits_on_the_same_line_keep_the_editors_text_in_a_copy() {
    let (t, k) = open();
    let loaded = k.source(ARTICLE_MAIN).unwrap();
    let theirs = loaded.text.replace("A Small Article", "Their Title");
    put(&t, ARTICLE_MAIN, &theirs);
    let ours = loaded.text.replace("A Small Article", "Our Title");
    let SourceSaved::Conflict { copy, file } = k
        .save_source(&human(), ARTICLE_MAIN, &loaded.hash, &ours, NOW)
        .unwrap()
    else {
        panic!("expected a conflict");
    };
    assert!(
        copy.starts_with(&format!("{ARTICLE}/main (conflict ")),
        "{copy}"
    );
    assert!(copy.ends_with(").tex"), "{copy}");
    assert_eq!(text_of(&t, &copy), ours);
    assert_eq!(text_of(&t, ARTICLE_MAIN), theirs);
    assert_eq!(file.text, theirs);
    // A base nobody remembers cannot be merged either.
    let again = k
        .save_source(&human(), ARTICLE_MAIN, "0000000000000000", &ours, NOW)
        .unwrap();
    assert!(matches!(again, SourceSaved::Conflict { .. }));
    assert_eq!(text_of(&t, ARTICLE_MAIN), theirs);
}

#[test]
fn only_source_files_in_latex_folders_within_the_size_limit() {
    let (t, k) = open();
    let loaded = k.source(ARTICLE_MAIN).unwrap();
    let save = |path: &str, text: &str| k.save_source(&human(), path, "", text, NOW);
    // Kinds of file.
    for path in [
        format!("{ARTICLE}/notes.md"),
        format!("{ARTICLE}/figure.pdf"),
        format!("{ARTICLE}/notes.txt"),
        format!("{ARTICLE}/kasten-latex.yaml"),
    ] {
        assert!(save(&path, "x").is_err(), "{path}");
    }
    // Places: outside a document, out of the vault, the private folders, the managed bibliography.
    assert!(invalid(save("inbox/x.tex", "words")).contains("not in a LaTeX"));
    assert!(invalid(save("sources/references.bib", "@book{a}")).contains("not in a LaTeX"));
    for path in [
        "../x.tex".to_owned(),
        ".kasten/x.tex".to_owned(),
        ".trash/x.tex".to_owned(),
        format!("{ARTICLE}/../../x.tex"),
    ] {
        assert!(save(&path, "words").is_err(), "{path}");
    }
    // A .bib inside the folder is text like the rest; so is a new file.
    assert!(save(&format!("{ARTICLE}/refs.bib"), "@book{a}\n").is_ok());
    assert!(save(&format!("{ARTICLE}/sections/intro.tex"), "Intro\n").is_ok());
    assert_eq!(
        text_of(&t, &format!("{ARTICLE}/sections/intro.tex")),
        "Intro\n"
    );
    // A new file is only created when the editor says it is new.
    let hash_for_missing = k.save_source(
        &human(),
        &format!("{ARTICLE}/ghost.tex"),
        &loaded.hash,
        "x",
        NOW,
    );
    assert!(matches!(hash_for_missing, Err(Error::NotFound(_))));
    // Size: the limit itself is fine, one byte more is not.
    let fits = "a".repeat(MAX_SOURCE_BYTES);
    assert!(
        k.save_source(&human(), ARTICLE_MAIN, &loaded.hash, &fits, NOW)
            .is_ok()
    );
    let too_big = "a".repeat(MAX_SOURCE_BYTES + 1);
    let why = invalid(k.save_source(
        &human(),
        ARTICLE_MAIN,
        &kasten_core::content_hash(&fits),
        &too_big,
        NOW,
    ));
    assert!(why.contains("200 KB"), "{why}");
    assert_eq!(text_of(&t, ARTICLE_MAIN).len(), MAX_SOURCE_BYTES);
}

#[test]
fn reading_a_source_is_limited_to_latex_folders_too() {
    let (_t, k) = open();
    assert!(invalid(k.source("inbox/plan.tex")).contains("not in a LaTeX"));
    assert!(k.source("library/welcome-to-kasten.md").is_err());
    assert!(matches!(
        k.source(&format!("{ARTICLE}/missing.tex")),
        Err(Error::NotFound(_))
    ));
}

#[test]
fn a_new_document_gets_a_folder_a_root_file_and_a_free_name() {
    let (t, k) = open();
    let doc = k
        .create_latex_doc(&human(), "Fish & Chips", Some("photo-organiser"), NOW)
        .unwrap();
    assert_eq!(
        doc.main_path,
        "projects/photo-organiser/latex/fish-chips/main.tex"
    );
    let text = text_of(&t, &doc.main_path);
    assert!(text.starts_with("\\documentclass"), "{text}");
    assert!(text.contains("\\title{Fish \\& Chips}"), "{text}");
    let second = k
        .create_latex_doc(&human(), "Fish & Chips", Some("photo-organiser"), NOW)
        .unwrap();
    assert_eq!(second.folder, "projects/photo-organiser/latex/fish-chips-2");
    let library = k.create_latex_doc(&human(), "Notes", None, NOW).unwrap();
    assert_eq!(library.main_path, "library/latex/notes/main.tex");
    assert!(invalid(k.create_latex_doc(&human(), "X", Some("nope"), NOW)).contains("No project"));
    assert!(invalid(k.create_latex_doc(&agent(), "X", None, NOW)).contains("guarded"));
    // A person's new document is waiting to be committed like typing.
    assert!(k.commit_edits().unwrap().is_some());
}

#[test]
fn search_finds_the_words_of_a_tex_file_and_not_its_commands_or_comments() {
    let (_t, k) = open();
    assert!(
        k.search("Gaussian", 10)
            .unwrap()
            .iter()
            .all(|h| !h.path.ends_with(".tex"))
    );
    k.set_plugin_enabled(&human(), "latex", true, NOW).unwrap();
    let hits = k.search("gaussian noise", 10).unwrap();
    let hit = hits
        .iter()
        .find(|h| h.path == ARTICLE_MAIN)
        .expect("the article is found");
    assert_eq!(hit.title, "main.tex");
    assert!(
        hit.snippet.to_lowercase().contains("gaussian"),
        "{}",
        hit.snippet
    );
    // Commands and comments are not words.
    assert!(
        k.search("frac", 10)
            .unwrap()
            .iter()
            .all(|h| !h.path.ends_with(".tex"))
    );
    assert!(
        k.search("pelican", 10)
            .unwrap()
            .iter()
            .all(|h| !h.path.ends_with(".tex"))
    );
    // Text in a section file counts.
    let intro = k.search("reproducible builds", 10).unwrap();
    assert!(
        intro
            .iter()
            .any(|h| h.path.ends_with("paper30/sections/introduction.tex"))
    );
}

#[test]
fn export_pdf_is_one_commit_beside_the_root_file() {
    let (t, k) = open();
    let pdf = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n".to_vec();
    k.commit_edits().unwrap();
    let before = k.log(None, 100).unwrap().len();
    let path = k.export_pdf(&human(), ARTICLE, &pdf, NOW).unwrap();
    assert_eq!(path, format!("{ARTICLE}/main.pdf"));
    assert_eq!(fs::read(t.vault.root().join(&path)).unwrap(), pdf);
    let log = k.log(None, 100).unwrap();
    assert_eq!(log.len(), before + 1);
    assert_eq!(log[0].summary, "export: article PDF");
    assert_eq!(k.log(Some(&path), 5).unwrap().len(), 1);
    // A later export replaces it, again as one commit.
    let newer = b"%PDF-1.7\nnewer\n".to_vec();
    k.export_pdf(&human(), ARTICLE, &newer, NOW).unwrap();
    assert_eq!(fs::read(t.vault.root().join(&path)).unwrap(), newer);
    assert_eq!(k.log(None, 100).unwrap().len(), before + 2);
}

#[test]
fn export_pdf_is_refused_outside_latex_folders_for_agents_and_for_other_bytes() {
    let (t, k) = open();
    let pdf = b"%PDF-1.7\n".to_vec();
    assert!(invalid(k.export_pdf(&human(), "inbox", &pdf, NOW)).contains("not a LaTeX"));
    assert!(invalid(k.export_pdf(&human(), "library", &pdf, NOW)).contains("not a LaTeX"));
    assert!(invalid(k.export_pdf(&human(), "../elsewhere", &pdf, NOW)).contains("not a LaTeX"));
    assert!(invalid(k.export_pdf(&agent(), ARTICLE, &pdf, NOW)).contains("person"));
    assert!(invalid(k.export_pdf(&human(), ARTICLE, b"<html>", NOW)).contains("not a PDF"));
    assert!(!t.vault.root().join(ARTICLE).join("main.pdf").exists());
    assert!(!t.vault.root().join("inbox/main.pdf").exists());
}

#[test]
fn builds_live_in_the_cache_and_are_never_committed() {
    let (t, k) = open();
    let dir = build_dir(ARTICLE);
    assert!(dir.starts_with(".kasten/cache/latex/"));
    // What a build leaves: a PDF, aux files, even a tex file with a class.
    put(&t, &format!("{dir}/main.pdf"), "%PDF-1.7\n");
    put(&t, &format!("{dir}/main.aux"), "aux\n");
    put(
        &t,
        &format!("{dir}/stray.tex"),
        "\\documentclass{article}\n",
    );
    // Not listed as a document, not searchable, not readable as a source.
    assert!(
        !k.latex_docs()
            .unwrap()
            .iter()
            .any(|d| d.folder.contains(".kasten"))
    );
    assert!(k.source(&format!("{dir}/stray.tex")).is_err());
    // Not committed by an edit, by the pause, nor as an outside change.
    let loaded = k.source(ARTICLE_MAIN).unwrap();
    k.save_source(
        &human(),
        ARTICLE_MAIN,
        &loaded.hash,
        &format!("{}%\n", loaded.text),
        NOW,
    )
    .unwrap();
    k.commit_edits().unwrap();
    let _ = k.commit_external();
    for file in ["main.pdf", "main.aux", "stray.tex"] {
        let path = format!("{dir}/{file}");
        assert!(k.log(Some(&path), 5).unwrap().is_empty(), "{path}");
    }
    assert!(
        !k.log(None, 3)
            .unwrap()
            .iter()
            .any(|c| c.summary.contains(".kasten/cache"))
    );
}
