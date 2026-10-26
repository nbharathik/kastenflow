//! Starting a LaTeX document from a template, and sending a page to LaTeX:
//! each is one save of one file (one commit), made through the core.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::history::Actor;
use kasten_core::latex::{Material, Template};
use kasten_core::{Error, Kasten};

const ARTICLE_MAIN: &str = "projects/photo-organiser/latex/article/main.tex";

fn human() -> Actor {
    Actor::Human
}

fn agent() -> Actor {
    Actor::Agent {
        client: "claude-code".into(),
        session: "s1".into(),
    }
}

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let article = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/latex/article/main.tex");
    let target = t.vault.root().join(ARTICLE_MAIN);
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    fs::copy(article, target).unwrap();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    k.commit_edits().unwrap();
    (t, k)
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

#[test]
fn each_template_makes_one_file_in_one_commit() {
    for template in Template::ALL {
        let (t, k) = open();
        let before = k.log(None, 100).unwrap().len();
        let doc = k
            .create_latex_doc_from(
                &human(),
                "Fish & Chips",
                template,
                Some("photo-organiser"),
                None,
                NOW,
            )
            .unwrap();
        assert_eq!(
            doc.main_path,
            "projects/photo-organiser/latex/fish-chips/main.tex"
        );
        assert_eq!(
            text_of(&t, &doc.main_path),
            template.render("Fish & Chips", None),
            "{}",
            template.name()
        );
        // Nothing else was written: the folder holds the root file only.
        let names: Vec<_> = fs::read_dir(t.vault.root().join(&doc.folder))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["main.tex"]);
        assert!(k.commit_edits().unwrap().is_some());
        let log = k.log(None, 100).unwrap();
        assert_eq!(log.len(), before + 1, "{}", template.name());
        assert_eq!(log[0].summary, "edit: main.tex");
        assert!(k.commit_edits().unwrap().is_none());
    }
}

#[test]
fn the_templates_differ_in_their_class() {
    let (t, k) = open();
    let mut classes = Vec::new();
    for template in Template::ALL {
        let doc = k
            .create_latex_doc_from(&human(), "Same title", template, None, None, NOW)
            .unwrap();
        let text = text_of(&t, &doc.main_path);
        classes.push(text.lines().next().unwrap().to_owned());
        assert!(doc.main_path.starts_with("library/latex/same-title"));
    }
    assert_eq!(
        classes,
        [
            "\\documentclass[11pt]{article}",
            "\\documentclass[11pt]{report}",
            "\\documentclass[11pt]{beamer}"
        ]
    );
}

#[test]
fn the_older_call_still_makes_an_article() {
    let (t, k) = open();
    let doc = k.create_latex_doc(&human(), "Notes", None, NOW).unwrap();
    assert_eq!(
        text_of(&t, &doc.main_path),
        Template::Article.render("Notes", None)
    );
}

#[test]
fn agents_cannot_start_a_document_this_way() {
    let (_t, k) = open();
    assert!(
        invalid(k.create_latex_doc_from(&agent(), "X", Template::Report, None, None, NOW))
            .contains("guarded")
    );
    assert!(
        invalid(k.create_latex_doc_from(&human(), "X", Template::Report, Some("nope"), None, NOW))
            .contains("No project")
    );
    assert!(
        k.send_to_new_latex_doc(
            &agent(),
            Material::Selection("hi"),
            "X",
            Template::Article,
            None,
            NOW
        )
        .is_err()
    );
}

const PAGE: &str = "---\ntitle: Trip\n---\n\n# Trip\n\nSee [@knuth84] and [site](https://x.org).\n\n## Plan\n\n- one\n- two\n";

#[test]
fn a_page_becomes_a_new_document_in_one_commit() {
    let (t, k) = open();
    let before = k.log(None, 100).unwrap().len();
    let sent = k
        .send_to_new_latex_doc(
            &human(),
            Material::Page(PAGE),
            "Trip",
            Template::Article,
            None,
            NOW,
        )
        .unwrap();
    assert!(!sent.appended);
    assert_eq!(sent.path, "library/latex/trip/main.tex");
    assert_eq!(sent.cites, ["knuth84"]);
    assert_eq!(sent.todos, 0);
    let text = text_of(&t, &sent.path);
    assert!(text.starts_with("\\documentclass[11pt]{article}"));
    assert!(text.contains("\\maketitle\n\n\\section{Trip}\n\nSee \\cite{knuth84} and \\href{https://x.org}{site}.\n\n\\subsection{Plan}\n"), "{text}");
    assert!(
        text.ends_with("  \\item two\n\\end{itemize}\n\\end{document}\n"),
        "{text}"
    );
    assert!(!text.contains("title: Trip"));
    assert!(k.commit_edits().unwrap().is_some());
    assert_eq!(k.log(None, 100).unwrap().len(), before + 1);
}

#[test]
fn a_report_gets_chapters_and_slides_get_frames() {
    let (t, k) = open();
    let report = k
        .send_to_new_latex_doc(
            &human(),
            Material::Page(PAGE),
            "R",
            Template::Report,
            None,
            NOW,
        )
        .unwrap();
    let text = text_of(&t, &report.path);
    assert!(
        text.contains("\\chapter{Trip}") && text.contains("\\section{Plan}"),
        "{text}"
    );
    let slides = k
        .send_to_new_latex_doc(
            &human(),
            Material::Page(PAGE),
            "S",
            Template::Beamer,
            None,
            NOW,
        )
        .unwrap();
    let text = text_of(&t, &slides.path);
    assert!(
        text.contains("\\begin{frame}[fragile]{Trip}")
            && text.contains("\\begin{frame}[fragile]{Plan}"),
        "{text}"
    );
    assert_eq!(
        text.matches("\\begin{frame}").count(),
        text.matches("\\end{frame}").count()
    );
    assert!(!text.contains("Introduction"));
}

#[test]
fn a_selection_is_converted_without_reading_frontmatter() {
    let (t, k) = open();
    let sent = k
        .send_to_new_latex_doc(
            &human(),
            Material::Selection("---\nsome words\n---\n"),
            "Part",
            Template::Article,
            None,
            NOW,
        )
        .unwrap();
    let text = text_of(&t, &sent.path);
    // A rule, then a heading underlined with dashes: not a block of frontmatter.
    assert!(
        text.contains("\\medskip\\hrule\\medskip\n\n\\subsection{some words}\n"),
        "{text}"
    );
}

#[test]
fn text_is_added_at_the_end_of_an_existing_document() {
    let (t, k) = open();
    let before = text_of(&t, ARTICLE_MAIN);
    let log_before = k.log(None, 100).unwrap().len();
    let sent = k
        .send_to_latex_doc(&human(), Material::Page(PAGE), ARTICLE_MAIN, NOW)
        .unwrap();
    assert!(sent.appended);
    assert_eq!(sent.doc.main_path, ARTICLE_MAIN);
    let after = text_of(&t, ARTICLE_MAIN);
    // Everything that was there stays, in order; the new text sits just before the end.
    let kept = before.replace("\\end{document}\n", "");
    let without_package = after.replace("\\usepackage{hyperref}\n", "");
    assert!(without_package.starts_with(kept.trim_end()), "{after}");
    assert!(
        after.ends_with("  \\item two\n\\end{itemize}\n\\end{document}\n"),
        "{after}"
    );
    assert!(after.contains("\\section{Trip}"), "{after}");
    // The page links, so the document now loads hyperref (once), before its body.
    assert_eq!(after.matches("{hyperref}").count(), 1, "{after}");
    assert!(after.find("{hyperref}").unwrap() < after.find("\\begin{document}").unwrap());
    assert!(k.commit_edits().unwrap().is_some());
    assert_eq!(k.log(None, 100).unwrap().len(), log_before + 1);
    // Sending again adds again, and does not load the package twice.
    k.send_to_latex_doc(
        &human(),
        Material::Selection("More words."),
        ARTICLE_MAIN,
        NOW,
    )
    .unwrap();
    let again = text_of(&t, ARTICLE_MAIN);
    assert_eq!(again.matches("{hyperref}").count(), 1);
    assert!(again.contains("More words.\n\\end{document}"), "{again}");
}

#[test]
fn nothing_to_send_is_said_in_a_sentence_and_writes_nothing() {
    let (t, k) = open();
    let before = text_of(&t, ARTICLE_MAIN);
    for md in ["", "\n\n", "---\ntitle: T\n---\n"] {
        assert!(
            invalid(k.send_to_latex_doc(&human(), Material::Page(md), ARTICLE_MAIN, NOW))
                .contains("no text")
        );
    }
    assert_eq!(text_of(&t, ARTICLE_MAIN), before);
    assert!(
        invalid(k.send_to_new_latex_doc(
            &human(),
            Material::Selection(""),
            "X",
            Template::Article,
            None,
            NOW
        ))
        .contains("no text")
    );
    assert!(
        k.send_to_latex_doc(&human(), Material::Selection("x"), "inbox/plan.tex", NOW)
            .is_err()
    );
    assert!(
        k.send_to_latex_doc(&agent(), Material::Selection("x"), ARTICLE_MAIN, NOW)
            .is_err()
    );
}

#[test]
fn a_page_too_big_for_a_source_file_is_refused() {
    let (t, k) = open();
    let big = "word ".repeat(60_000);
    let before = text_of(&t, ARTICLE_MAIN);
    assert!(
        invalid(k.send_to_latex_doc(&human(), Material::Selection(&big), ARTICLE_MAIN, NOW))
            .contains("at most")
    );
    assert_eq!(text_of(&t, ARTICLE_MAIN), before);
}
