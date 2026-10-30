use serde_json::json;

use super::*;

#[test]
fn every_tool_of_the_list_has_words_and_none_shows_its_name() {
    for name in TOOLS {
        let said = action(name, &json!({})).unwrap();
        let told = told(name, &json!({}), &json!({})).unwrap().summary;
        assert!(
            !said.contains('_') && !told.contains('_'),
            "{name}: {said} / {told}"
        );
    }
    assert!(action("search", &json!({})).is_none());
    assert!(told("search", &json!({}), &json!({})).is_none());
}

#[test]
fn the_file_tools_read_as_a_person_would_say_them() {
    let input = json!({"doc": "projects/p/latex/paper", "file": "sections/intro.tex"});
    assert_eq!(
        action("latex_write_file", &input).as_deref(),
        Some("write the LaTeX file “intro.tex” of “paper”")
    );
    assert_eq!(
        action("latex_append", &input).as_deref(),
        Some("add to the LaTeX file “intro.tex” of “paper”")
    );
    assert_eq!(
        action("latex_delete_file", &input).as_deref(),
        Some("move the LaTeX file “intro.tex” of “paper” to the trash")
    );
    assert_eq!(
        action("latex_create_document", &json!({"title": "Thesis"})).as_deref(),
        Some("start the LaTeX document “Thesis”")
    );
    let saved = json!({"file": "sections/intro.tex",
        "result": {"status": "saved", "path": "projects/p/latex/paper/sections/intro.tex"}});
    let made = told("latex_write_file", &input, &saved).unwrap();
    assert_eq!(made.summary, "Made the LaTeX file “intro.tex”");
    let replaced = json!({"doc": "paper", "file": "a.tex", "base_hash": "abc"});
    assert_eq!(
        told("latex_write_file", &replaced, &saved).unwrap().summary,
        "Changed the LaTeX file “intro.tex”"
    );
    assert_eq!(
        told("latex_append", &input, &saved).unwrap().summary,
        "Added to the LaTeX file “intro.tex”"
    );
    let started = json!({"result": {"title": "thesis", "path": "library/latex/thesis/main.tex"}});
    let told_create = told(
        "latex_create_document",
        &json!({"title": "Thesis"}),
        &started,
    )
    .unwrap();
    assert_eq!(told_create.summary, "Started the LaTeX document “thesis”");
    assert_eq!(told_create.paths, ["library/latex/thesis/main.tex"]);
    let gone =
        json!({"file": "x.bib", "result": {"path": "a/x.bib", "trashed": ".trash/t/a/x.bib"}});
    let told_delete = told("latex_delete_file", &input, &gone).unwrap();
    assert_eq!(
        told_delete.summary,
        "Moved the LaTeX file “x.bib” to the trash"
    );
    assert_eq!(told_delete.paths, ["a/x.bib", ".trash/t/a/x.bib"]);
}

#[test]
fn pictures_citations_and_pages_read_as_a_person_would_say_them() {
    let picture = json!({"doc": "projects/p/latex/paper", "name": "results.png"});
    assert_eq!(
        action("latex_add_asset", &picture).as_deref(),
        Some("add the picture “results.png” to “paper”")
    );
    let added = json!({"result": {"status": "added", "figure": "figures/results.png",
        "path": "projects/p/latex/paper/figures/results.png"}});
    let told_picture = told("latex_add_asset", &picture, &added).unwrap();
    assert_eq!(
        told_picture.summary,
        "Added the picture “results.png” to “paper”"
    );
    assert_eq!(
        told_picture.paths,
        ["projects/p/latex/paper/figures/results.png"]
    );
    let same = json!({"result": {"status": "existing", "figure": "figures/results.png"}});
    assert_eq!(
        told("latex_add_asset", &picture, &same).unwrap().summary,
        "The picture “results.png” was in “paper” already"
    );
    let cite = json!({"doc": "paper", "file": "sections/intro.tex", "key": "a"});
    assert_eq!(
        action("latex_cite", &cite).as_deref(),
        Some("cite a reference in the LaTeX file “intro.tex” of “paper”")
    );
    let cited = json!({"file": "sections/intro.tex", "result": {"status": "cited",
        "path": "p/paper/sections/intro.tex", "bib": {"path": "p/paper/references.bib", "added": true}}});
    let told_cite = told("latex_cite", &cite, &cited).unwrap();
    assert_eq!(
        told_cite.summary,
        "Cited a reference in the LaTeX file “intro.tex”"
    );
    assert_eq!(
        told_cite.paths,
        ["p/paper/sections/intro.tex", "p/paper/references.bib"]
    );
    assert_eq!(
        action("latex_send_page", &json!({"page": "library/notes.md"})).as_deref(),
        Some("make a LaTeX document from the page “notes.md”")
    );
    assert_eq!(
        action(
            "latex_send_page",
            &json!({"page": "library/notes.md", "doc": "paper"})
        )
        .as_deref(),
        Some("add the page “notes.md” to the LaTeX document “paper”")
    );
    let sent = json!({"result": {"doc": "library/latex/notes", "appended": false,
        "path": "library/latex/notes/main.tex"}});
    let told_sent = told("latex_send_page", &json!({}), &sent).unwrap();
    assert_eq!(
        told_sent.summary,
        "Made the LaTeX document “notes” from the page"
    );
    assert_eq!(told_sent.paths, ["library/latex/notes/main.tex"]);
}

#[test]
fn calls_read_as_a_person_would_say_them() {
    let input = json!({"doc": "projects/p/latex/paper", "file": "sections/intro.tex"});
    assert_eq!(
        action("latex_edit", &input).as_deref(),
        Some("change the LaTeX file “intro.tex” of “paper”")
    );
    let saved = json!({"status": "done", "file": "sections/intro.tex",
        "result": {"status": "saved", "path": "projects/p/latex/paper/sections/intro.tex"}});
    let told_edit = told("latex_edit", &input, &saved).unwrap();
    assert_eq!(told_edit.summary, "Changed the LaTeX file “intro.tex”");
    assert_eq!(
        told_edit.paths,
        ["projects/p/latex/paper/sections/intro.tex"]
    );
    let build = json!({"built": true, "errors": 1, "warnings": 2});
    assert_eq!(
        told("latex_build", &json!({"doc": "paper"}), &build)
            .unwrap()
            .summary,
        "Read the last build of “paper”: 1 error, 2 warnings"
    );
    assert_eq!(
        told(
            "latex_build",
            &json!({"doc": "paper"}),
            &json!({"built": false})
        )
        .unwrap()
        .summary,
        "There is no build of “paper” to read yet"
    );
}

#[test]
fn a_diagram_as_a_figure_reads_as_a_person_would_say_it() {
    let input = json!({"diagram": "library/Login flow.drawio", "doc": "projects/p/latex/paper"});
    assert_eq!(
        action("diagram_to_latex_figure", &input).as_deref(),
        Some("draw “Login flow” as a figure of “paper”")
    );
    let done = json!({"doc": "projects/p/latex/paper", "result": {"status": "added",
        "figure": "figures/login-flow.png", "path": "projects/p/latex/paper/figures/login-flow.png"}});
    let told_it = told("diagram_to_latex_figure", &input, &done).unwrap();
    assert_eq!(told_it.summary, "Drew “Login flow” as a figure of “paper”");
    assert_eq!(
        told_it.paths,
        ["projects/p/latex/paper/figures/login-flow.png"]
    );
    let again = json!({"result": {"status": "existing"}});
    assert_eq!(
        told("diagram_to_latex_figure", &input, &again)
            .unwrap()
            .summary,
        "The picture of “Login flow” was in “paper” already"
    );
}

#[test]
fn building_now_and_keeping_the_pdf_read_as_a_person_would_say_them() {
    let wait = json!({"doc": "projects/p/latex/paper", "wait": true});
    assert_eq!(
        action("latex_build", &wait).as_deref(),
        Some("build “paper” in the app")
    );
    let built = json!({"built": true, "waited": true, "errors": 0, "warnings": 1});
    assert_eq!(
        told("latex_build", &wait, &built).unwrap().summary,
        "Built “paper”: 0 errors, 1 warning"
    );
    let input = json!({"doc": "projects/p/latex/paper"});
    assert_eq!(
        action("latex_export_pdf", &input).as_deref(),
        Some("keep the PDF of “paper”")
    );
    let kept = json!({"status": "done", "doc": "projects/p/latex/paper",
        "result": {"path": "projects/p/latex/paper/main.pdf"}});
    let told_kept = told("latex_export_pdf", &input, &kept).unwrap();
    assert_eq!(told_kept.summary, "Kept the PDF of “paper”");
    assert_eq!(told_kept.paths, ["projects/p/latex/paper/main.pdf"]);
    let held = json!({"status": "pending_review", "doc": "projects/p/latex/paper"});
    assert_eq!(
        told("latex_export_pdf", &input, &held).unwrap().summary,
        "The PDF of “paper” waits for review"
    );
}
