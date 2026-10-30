//! Added when `SmartCreate` was verified: the project's mode however its name
//! is spelled, Autonomous marks, titles with path characters, names that are
//! taken, a page inside another smart page's folder, a folder that would need a
//! file to be a folder too, a failure half way, and what a reviewer is shown.

use crate::common::NOW;
use crate::smart_support::{all_files, done, make_page, open, session, set_mode, there};

use std::collections::BTreeMap;
use std::fs;

use kasten_core::agent::{AgentOp, SmartNewFile};
use kasten_core::config_keys::AgentMode;
use kasten_core::{Kasten, Outcome};

fn file(path: &str, content: &str) -> SmartNewFile {
    SmartNewFile {
        path: path.into(),
        content: content.into(),
    }
}

fn good() -> Vec<SmartNewFile> {
    vec![
        file("index.html", "<h1>Hi</h1><script src=\"app.js\"></script>"),
        file("app.js", "console.log('hi');\n"),
    ]
}

fn create(title: &str, project: Option<&str>, parent: Option<&str>) -> AgentOp {
    AgentOp::SmartCreate {
        title: title.into(),
        project: project.map(str::to_owned),
        parent: parent.map(str::to_owned),
        files: good(),
        reason: None,
    }
}

fn commits(k: &Kasten) -> usize {
    k.log(None, 500).unwrap().len()
}

/// The vault is as it was: says which paths differ, never the bytes.
fn same(before: &BTreeMap<String, Vec<u8>>, after: &BTreeMap<String, Vec<u8>>, why: &str) {
    let mut differ: Vec<&String> = after
        .iter()
        .filter(|(path, bytes)| before.get(*path) != Some(*bytes))
        .map(|(path, _)| path)
        .collect();
    differ.extend(before.keys().filter(|path| !after.contains_key(*path)));
    assert!(differ.is_empty(), "{why}: changed {differ:?}");
}

#[test]
fn a_project_on_review_holds_a_new_page_however_the_project_is_spelled() {
    let (t, k) = open();
    set_mode(
        &k,
        AgentMode::Autonomous,
        &[("photo-organiser", AgentMode::Review)],
    );
    let s = session();
    let before = all_files(&t);
    for spelled in [
        "photo-organiser",
        "Photo-Organiser",
        "PHOTO-ORGANISER",
        "Photo Organiser",
        "photo organiser",
        " photo-organiser ",
    ] {
        match k.agent_run(&s, &create("Held", Some(spelled), None), NOW) {
            Ok(Outcome::PendingReview { .. }) | Err(_) => {}
            other => panic!("“{spelled}” got past the project's review: {other:?}"),
        }
        same(&before, &all_files(&t), spelled);
    }
    // An ordinary new note was let through the same way.
    let note = AgentOp::CreateNote {
        note_type: "page".into(),
        title: "Held note".into(),
        body: String::new(),
        project: Some("Photo Organiser".into()),
        tags: vec![],
        props: serde_json::Map::new(),
        parent: None,
        template: None,
    };
    assert!(matches!(
        k.agent_run(&s, &note, NOW).unwrap(),
        Outcome::PendingReview { .. }
    ));
    // And the same project, reached through a parent page inside it.
    let inside = make_page(&k, "Inside", Some("photo-organiser"), None);
    let held = k
        .agent_run(&s, &create("Held 2", None, Some(&inside.meta.path)), NOW)
        .unwrap();
    assert!(matches!(held, Outcome::PendingReview { .. }), "{held:?}");
    // Outside the project the vault's mode holds.
    let ran = k.agent_run(&s, &create("Free", None, None), NOW).unwrap();
    assert!(matches!(ran, Outcome::Done { .. }), "{ran:?}");
}

#[test]
fn autonomous_mode_commits_a_new_page_with_its_mark_after_a_checkpoint() {
    let (_t, k) = open();
    set_mode(&k, AgentMode::Autonomous, &[]);
    let s = session();
    let ran = k.agent_run(&s, &create("Auto", None, None), NOW).unwrap();
    assert!(matches!(ran, Outcome::Done { .. }), "{ran:?}");
    assert_eq!(
        k.log(None, 1).unwrap()[0].mode.as_deref(),
        Some("autonomous")
    );
    assert!(!k.list_checkpoints().unwrap().is_empty());
}

#[test]
fn titles_with_path_characters_stay_inside_the_library() {
    let (t, k) = open();
    let s = session();
    for title in [
        "../../evil",
        "..\\..\\evil",
        "a/b\\c:d*e?f",
        "/etc/passwd",
        "C:\\Windows\\x",
        "CON",
        "nul",
        "com1",
        "...",
        &"x".repeat(300),
        "emoji 🎉 title",
    ] {
        let before = all_files(&t);
        let result = k.agent_run(&s, &create(title, None, None), NOW);
        let after = all_files(&t);
        for path in after.keys().filter(|p| !before.contains_key(*p)) {
            assert!(
                path.starts_with("library/") && !path.contains(".."),
                "{title:?} wrote {path}"
            );
            for part in path.split('/') {
                let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
                assert!(
                    !["CON", "PRN", "AUX", "NUL", "COM1", "LPT1"].contains(&stem.as_str()),
                    "{title:?}: {path} is a Windows device name"
                );
            }
        }
        if let Ok(outcome) = result {
            let made = done(outcome);
            assert!(there(&t, made["page"].as_str().unwrap()), "{title:?}");
        } else {
            assert_eq!(before, after, "{title:?} failed and left traces");
        }
    }
    for title in ["a\nb", "a\tb", "a\0b"] {
        assert!(
            k.agent_run(&s, &create(title, None, None), NOW).is_err(),
            "{title:?}"
        );
    }
}

#[test]
fn a_taken_name_gives_a_free_one_and_a_stray_folder_is_never_adopted() {
    let (t, k) = open();
    let s = session();
    let first = done(
        k.agent_run(&s, &create("Deadlines", None, None), NOW)
            .unwrap(),
    );
    let second = done(
        k.agent_run(&s, &create("Deadlines", None, None), NOW)
            .unwrap(),
    );
    assert_ne!(first["page"], second["page"]);
    assert_ne!(first["id"], second["id"]);

    // A folder left behind by a page deleted outside the app.
    let stray = t.vault.root().join("library/stray.smart");
    fs::create_dir_all(&stray).unwrap();
    fs::write(stray.join("junk.js"), "keep me").unwrap();
    let made = done(k.agent_run(&s, &create("Stray", None, None), NOW).unwrap());
    assert_eq!(made["page"], "library/stray-2.md");
    assert_eq!(
        fs::read_to_string(stray.join("junk.js")).unwrap(),
        "keep me"
    );
    assert!(!stray.join("index.html").exists());
}

#[test]
fn a_new_smart_page_is_never_made_inside_another_smart_pages_folder() {
    let (t, k) = open();
    let s = session();
    let outer = done(k.agent_run(&s, &create("Outer", None, None), NOW).unwrap());
    let dir = format!(
        "{}.smart",
        outer["page"].as_str().unwrap().trim_end_matches(".md")
    );
    fs::write(
        t.vault.root().join(format!("{dir}/inner.md")),
        "---\ntitle: Inner\n---\nstray\n",
    )
    .unwrap();
    let inner = format!("{dir}/inner.md");
    let before = all_files(&t);
    let commits_before = commits(&k);
    for parent in [inner.as_str(), &inner.to_uppercase()] {
        assert!(
            k.agent_run(&s, &create("Nested", None, Some(parent)), NOW)
                .is_err(),
            "{parent}"
        );
    }
    same(
        &before,
        &all_files(&t),
        "not even the stray note's header changed",
    );
    assert_eq!(commits(&k), commits_before);
}

#[test]
fn a_file_that_is_also_a_folder_is_refused_before_anything_is_made() {
    let (t, k) = open();
    let s = session();
    let before = all_files(&t);
    for files in [
        vec![
            file("index.html", "x"),
            file("a.js", "x"),
            file("a.js/b.js", "x"),
        ],
        vec![
            file("index.html", "x"),
            file("a.js/b.js", "x"),
            file("a.js", "x"),
        ],
        vec![
            file("index.html", "x"),
            file("a.js", "x"),
            file("A.JS/b.js", "x"),
        ],
    ] {
        let op = AgentOp::SmartCreate {
            title: "Clash".into(),
            project: None,
            parent: None,
            files,
            reason: None,
        };
        assert!(k.agent_run(&s, &op, NOW).is_err());
        same(&before, &all_files(&t), "a clash");
    }
}

#[test]
fn many_files_and_the_limits_hold_for_a_whole_page() {
    let (t, k) = open();
    let s = session();
    let before = all_files(&t);
    let many = |n: usize| -> Vec<SmartNewFile> {
        let mut files = vec![file("index.html", "x")];
        files.extend((0..n).map(|i| file(&format!("d/p{i}.json"), "{}")));
        files
    };
    let op = |files| AgentOp::SmartCreate {
        title: "Many".into(),
        project: None,
        parent: None,
        files,
        reason: None,
    };
    // 501 files is one too many; 500 is fine (the whole call is small).
    assert!(k.agent_run(&s, &op(many(500)), NOW).is_err());
    same(&before, &all_files(&t), "501 files");
    let ok = done(k.agent_run(&s, &op(many(499)), NOW).unwrap());
    assert_eq!(ok["files"].as_array().unwrap().len(), 500);
    // Past the single-write cap of agents (200 KB) nothing is made, in any mode.
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode, &[]);
        let snapshot = all_files(&t);
        let big = vec![
            file("index.html", &"a".repeat(150_000)),
            file("app.js", &"b".repeat(150_000)),
        ];
        assert!(k.agent_run(&s, &op(big), NOW).is_err(), "{mode:?}");
        same(&snapshot, &all_files(&t), &format!("{mode:?}"));
    }
}

#[test]
fn a_stray_file_at_the_folders_name_is_never_written_through() {
    let (t, k) = open();
    let s = session();
    let blocked = t.vault.root().join("library/halfway.smart");
    fs::write(&blocked, "i am a file").unwrap();
    let made = done(
        k.agent_run(&s, &create("Halfway", None, None), NOW)
            .unwrap(),
    );
    assert_eq!(made["page"], "library/halfway-2.md");
    assert_eq!(fs::read_to_string(&blocked).unwrap(), "i am a file");
}

#[test]
fn a_reviewer_is_shown_every_file_not_just_the_first() {
    let (_t, k) = open();
    set_mode(&k, AgentMode::Review, &[]);
    let s = session();
    let op = AgentOp::SmartCreate {
        title: "Reviewed".into(),
        project: None,
        parent: None,
        files: vec![
            file("index.html", "<p>shown</p>"),
            file("js/hidden.js", "console.log('code the reviewer must see');"),
            file("smart.yaml", "title: Reviewed\n"),
        ],
        reason: None,
    };
    assert!(matches!(
        k.agent_run(&s, &op, NOW).unwrap(),
        Outcome::PendingReview { .. }
    ));
    let proposal = &k.proposals().unwrap()[0];
    for needle in [
        "<p>shown</p>",
        "code the reviewer must see",
        "js/hidden.js",
        "title: Reviewed",
    ] {
        assert!(
            proposal.diff.contains(needle),
            "{needle}: {}",
            proposal.diff
        );
    }
}
