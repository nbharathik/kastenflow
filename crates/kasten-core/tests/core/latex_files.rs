//! Agents making LaTeX documents and writing whole files: each template, a
//! taken name numbered, an unknown project refused, the three modes, the
//! write of a new file or a replace against what the agent read, and a lock
//! that holds in every mode and from every folder above.

use crate::common;

use std::fs;
use std::path::Path;

use common::{NOW, dev_vault};
use kasten_core::agent::{AgentOp, Session};
use kasten_core::config_keys::{AgentMode, AgentsConfig, ProjectAgents};
use kasten_core::latex::{MAX_SOURCE_BYTES, Template};
use kasten_core::{Error, Kasten, Outcome};
use serde_json::Value;

const BASE: &str = "projects/photo-organiser/latex";
const ARTICLE: &str = "projects/photo-organiser/latex/article";
const MAIN: &str = "projects/photo-organiser/latex/article/main.tex";

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

fn open() -> (common::TempVault, Kasten, Session) {
    let t = dev_vault();
    for name in ["article", "twocolumn"] {
        let from = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures/latex")
            .join(name);
        copy_dir(&from, &t.vault.root().join(BASE).join(name));
    }
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k, Session::start("claude-code", NOW))
}

fn text_of(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

fn set_mode(k: &Kasten, mode: AgentMode) {
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(mode),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
}

fn create(title: &str, template: &str, project: Option<&str>) -> AgentOp {
    AgentOp::CreateLatexDoc {
        title: title.into(),
        template: template.into(),
        project: project.map(str::to_owned),
        reason: None,
    }
}

fn save(path: &str, text: &str, base: &str) -> AgentOp {
    AgentOp::SaveSource {
        path: path.into(),
        text: text.into(),
        base: base.into(),
        reason: None,
    }
}

fn done(outcome: Outcome) -> Value {
    match outcome {
        Outcome::Done { result } => result,
        other => panic!("expected done, got {other:?}"),
    }
}

fn pending(outcome: Outcome) -> (String, String) {
    match outcome {
        Outcome::PendingReview { proposal, reason } => (proposal, reason),
        other => panic!("expected a proposal, got {other:?}"),
    }
}

fn refused(result: Result<Outcome, Error>) -> String {
    match result {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

/// Every file of the vault but git's folder and the cache, with its bytes.
fn snapshot(root: &Path) -> std::collections::BTreeMap<String, Vec<u8>> {
    fn walk(dir: &Path, root: &Path, out: &mut std::collections::BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let rel = path
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            if rel == ".git" || rel == ".kasten" {
                continue;
            }
            if path.is_dir() {
                walk(&path, root, out);
            } else {
                out.insert(rel, fs::read(&path).unwrap());
            }
        }
    }
    let mut out = std::collections::BTreeMap::new();
    walk(root, root, &mut out);
    out
}

#[test]
fn each_template_makes_a_document_in_a_folder_of_its_own() {
    for template in Template::ALL {
        let (t, k, s) = open();
        let result = done(
            k.agent_run(
                &s,
                &create("Fish & Chips", template.name(), Some("photo-organiser")),
                NOW,
            )
            .unwrap(),
        );
        assert_eq!(result["folder"], format!("{BASE}/fish-chips"));
        assert_eq!(result["main"], "main.tex");
        assert_eq!(result["path"], format!("{BASE}/fish-chips/main.tex"));
        assert_eq!(result["template"], template.name());
        assert_eq!(
            text_of(&t, result["path"].as_str().unwrap()),
            template.render("Fish & Chips", None),
            "{}",
            template.name()
        );
        assert!(
            k.latex_docs()
                .unwrap()
                .iter()
                .any(|d| d.folder == format!("{BASE}/fish-chips")),
            "{}",
            template.name()
        );
        let head = &k.log(None, 1).unwrap()[0];
        assert_eq!(head.session.as_deref(), Some(s.id.as_str()));
        assert!(head.agent);
    }
}

#[test]
fn no_template_named_means_an_article_and_the_library_is_the_default_place() {
    let (t, k, s) = open();
    let result = done(k.agent_run(&s, &create("Notes", "", None), NOW).unwrap());
    assert_eq!(result["folder"], "library/latex/notes");
    assert_eq!(
        text_of(&t, "library/latex/notes/main.tex"),
        Template::Article.render("Notes", None)
    );
}

#[test]
fn a_taken_name_is_numbered() {
    let (_t, k, s) = open();
    let make = || {
        done(
            k.agent_run(
                &s,
                &create("Thesis", "report", Some("photo-organiser")),
                NOW,
            )
            .unwrap(),
        )["folder"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    assert_eq!(make(), format!("{BASE}/thesis"));
    assert_eq!(make(), format!("{BASE}/thesis-2"));
    assert_eq!(make(), format!("{BASE}/thesis-3"));
}

#[test]
fn an_unknown_project_template_or_a_blank_title_is_refused_and_nothing_is_made() {
    let (t, k, s) = open();
    let before = snapshot(t.vault.root());
    let why = refused(k.agent_run(&s, &create("A", "article", Some("no-such")), NOW));
    assert!(why.contains("No project called"), "{why}");
    for hostile in ["../x", "a/b", ".hidden", "", "projects"] {
        assert!(
            k.agent_run(&s, &create("A", "article", Some(hostile)), NOW)
                .is_err(),
            "{hostile:?}"
        );
    }
    let why = refused(k.agent_run(&s, &create("A", "letter", None), NOW));
    assert!(why.contains("article, report and beamer"), "{why}");
    let why = refused(k.agent_run(&s, &create("   ", "article", None), NOW));
    assert!(why.contains("needs a title"), "{why}");
    assert_eq!(snapshot(t.vault.root()), before);
    assert!(k.proposals().unwrap().is_empty());
}

#[test]
fn a_new_document_follows_the_three_modes() {
    let (t, k, s) = open();
    set_mode(&k, AgentMode::Review);
    let (id, why) = pending(
        k.agent_run(
            &s,
            &create("Draft", "article", Some("photo-organiser")),
            NOW,
        )
        .unwrap(),
    );
    assert!(why.to_lowercase().contains("review"), "{why}");
    assert!(!t.vault.root().join(BASE).join("draft").exists());
    let waiting = &k.proposals().unwrap()[0];
    assert_eq!(
        waiting.target.as_ref().unwrap().path,
        format!("{BASE}/draft/main.tex")
    );
    assert!(waiting.diff.contains("documentclass"), "{}", waiting.diff);
    // The person accepts it, and the document is made as the proposal showed.
    k.accept_proposal(&id, "Ada", NOW).unwrap();
    assert_eq!(
        text_of(&t, &format!("{BASE}/draft/main.tex")),
        Template::Article.render("Draft", None)
    );

    for (mode, folder) in [
        (AgentMode::Balanced, "balanced"),
        (AgentMode::Autonomous, "autonomous"),
    ] {
        set_mode(&k, mode);
        let result = done(
            k.agent_run(&s, &create(folder, "beamer", Some("photo-organiser")), NOW)
                .unwrap(),
        );
        assert_eq!(result["folder"], format!("{BASE}/{folder}"), "{mode:?}");
    }
    assert_eq!(
        k.log(Some(&format!("{BASE}/autonomous/main.tex")), 1)
            .unwrap()[0]
            .mode
            .as_deref(),
        Some("autonomous")
    );
}

#[test]
fn a_new_document_is_judged_by_the_mode_of_its_project() {
    let (t, k, s) = open();
    let mut config = k.config();
    config.agents = Some(AgentsConfig {
        mode: Some(AgentMode::Autonomous),
        projects: [(
            "photo-organiser".to_owned(),
            ProjectAgents {
                mode: Some(AgentMode::Review),
                ..ProjectAgents::default()
            },
        )]
        .into_iter()
        .collect(),
        ..AgentsConfig::default()
    });
    k.set_config(config).unwrap();
    pending(
        k.agent_run(&s, &create("Held", "article", Some("photo-organiser")), NOW)
            .unwrap(),
    );
    assert!(!t.vault.root().join(BASE).join("held").exists());
    // The library follows the vault's mode.
    done(
        k.agent_run(&s, &create("Free", "article", None), NOW)
            .unwrap(),
    );
    assert!(t.vault.root().join("library/latex/free/main.tex").is_file());
}

#[test]
fn a_new_document_in_a_locked_folder_is_refused_in_every_mode() {
    let (t, k, s) = open();
    fs::create_dir_all(t.vault.root().join("library/latex")).unwrap();
    fs::write(
        t.vault.root().join("library/latex/kasten-latex.yaml"),
        "locked: true\n",
    )
    .unwrap();
    let before = snapshot(t.vault.root());
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        let why = refused(k.agent_run(&s, &create("Mine", "article", None), NOW));
        assert!(why.contains("locked"), "{mode:?}: {why}");
    }
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn a_file_is_written_new_or_replaced_against_what_was_read() {
    let (t, k, s) = open();
    // A new .bib and .sty join the document.
    for (name, text) in [
        ("refs.bib", "@book{a, title={T}}\n"),
        ("my.sty", "\\ProvidesPackage{my}\n"),
        ("sections/intro.tex", "Hello\n"),
    ] {
        let path = format!("{ARTICLE}/{name}");
        let result = done(k.agent_run(&s, &save(&path, text, ""), NOW).unwrap());
        assert_eq!(result["status"], "saved", "{name}");
        assert_eq!(text_of(&t, &path), text);
    }
    // A replace is written against the text read, and keeps a person's change.
    let read = text_of(&t, MAIN);
    let result = done(
        k.agent_run(
            &s,
            &save(MAIN, &read.replace("fixed rate", "steady rate"), &read),
            NOW,
        )
        .unwrap(),
    );
    assert_eq!(result["status"], "saved");
    assert!(text_of(&t, MAIN).contains("steady rate"));
    // A new file where one is already is told to read it first.
    let why = refused(k.agent_run(&s, &save(MAIN, "x", ""), NOW));
    assert!(why.contains("already exists"), "{why}");
    // A replace of a file that is not there is refused.
    assert!(
        k.agent_run(&s, &save(&format!("{ARTICLE}/gone.tex"), "x", "was"), NOW)
            .is_err()
    );
}

#[test]
fn a_wrong_path_or_extension_or_size_is_refused() {
    let (t, k, s) = open();
    let before = snapshot(t.vault.root());
    for path in [
        format!("{ARTICLE}/notes.md"),
        format!("{ARTICLE}/fig.pdf"),
        format!("{ARTICLE}/run.sh"),
        format!("{ARTICLE}/../escape.tex"),
        "/abs/escape.tex".to_owned(),
        format!("{ARTICLE}/sub\\win.tex"),
        format!("{ARTICLE}/.hidden/x.tex"),
        // The folder spelled with other capitals names the same one on some disks.
        format!("{BASE}/ARTICLE/extra.tex"),
        format!("{BASE}/Article/extra.tex"),
    ] {
        assert!(
            k.agent_run(&s, &save(&path, "x\n", ""), NOW).is_err(),
            "{path}"
        );
    }
    let big = "a".repeat(MAX_SOURCE_BYTES + 1);
    let why = refused(k.agent_run(&s, &save(&format!("{ARTICLE}/big.tex"), &big, ""), NOW));
    assert!(why.contains("KB"), "{why}");
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn a_locked_document_or_a_locked_folder_above_refuses_writes_in_every_mode() {
    let (t, k, s) = open();
    // A folder above a document that is not locked itself.
    fs::write(
        t.vault.root().join(BASE).join("kasten-latex.yaml"),
        "locked: true\n",
    )
    .unwrap();
    let locked_main = format!("{BASE}/twocolumn/main.tex");
    let before = snapshot(t.vault.root());
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode);
        for op in [
            save(&format!("{ARTICLE}/new.tex"), "x\n", ""),
            save(&locked_main, "x\n", &text_of(&t, &locked_main)),
            save(&format!("{BASE}/twocolumn/new.bib"), "x\n", ""),
            create("Under the lock", "article", Some("photo-organiser")),
        ] {
            let why = refused(k.agent_run(&s, &op, NOW));
            assert!(why.contains("locked"), "{mode:?} {op:?}: {why}");
        }
    }
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn a_rewrite_that_takes_out_much_waits_and_a_session_is_undone_in_one_step() {
    let (t, k, s) = open();
    let before = snapshot(t.vault.root());
    let read = text_of(&t, MAIN);
    // Much removed: held for review in Balanced mode.
    let (_, why) = pending(
        k.agent_run(&s, &save(MAIN, "\\documentclass{article}\n", &read), NOW)
            .unwrap(),
    );
    assert!(why.contains("Removes"), "{why}");
    assert_eq!(text_of(&t, MAIN), read);
    // A document, a section, a bibliography and a small replace: one session.
    let made = done(
        k.agent_run(&s, &create("Fresh", "article", None), NOW)
            .unwrap(),
    );
    let folder = made["folder"].as_str().unwrap().to_owned();
    done(
        k.agent_run(
            &s,
            &save(&format!("{folder}/refs.bib"), "@book{a}\n", ""),
            NOW,
        )
        .unwrap(),
    );
    done(
        k.agent_run(
            &s,
            &save(MAIN, &read.replace("fixed rate", "steady rate"), &read),
            NOW,
        )
        .unwrap(),
    );
    assert_ne!(snapshot(t.vault.root()), before);
    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert!(undone.reverted.len() >= 3, "{:?}", undone.reverted);
    assert_eq!(snapshot(t.vault.root()), before);
}
