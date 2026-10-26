//! An agent makes a whole smart page in one op: the page with `layout: smart`
//! and its code folder, one commit, held in Review like any other write, and
//! never half made.

use crate::common::NOW;
use crate::smart_support::{all_files, done, make_page, open, session, set_mode, there};

use kasten_core::agent::{AgentOp, SmartNewFile};
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::{Kasten, Outcome};

fn file(path: &str, content: &str) -> SmartNewFile {
    SmartNewFile {
        path: path.into(),
        content: content.into(),
    }
}

fn create(title: &str, files: Vec<SmartNewFile>) -> AgentOp {
    AgentOp::SmartCreate {
        title: title.into(),
        project: None,
        parent: None,
        files,
        reason: Some("test".into()),
    }
}

fn good() -> Vec<SmartNewFile> {
    vec![
        file(
            "index.html",
            "<h1>Deadlines</h1>\r\n<script src=\"app.js\"></script>",
        ),
        file("app.js", "console.log('hi');\n"),
        file("smart.yaml", "title: Deadlines\nfuture: kept\n"),
    ]
}

fn commits(k: &Kasten) -> usize {
    k.log(None, 500).unwrap().len()
}

#[test]
fn an_agent_makes_the_page_and_its_folder_in_one_commit_that_one_undo_takes_back() {
    let (t, k) = open();
    let s = session();
    let before = all_files(&t);
    let commits_before = commits(&k);

    let made = done(k.agent_run(&s, &create("Deadlines", good()), NOW).unwrap());
    assert_eq!(made["status"], "created");
    let page = made["page"].as_str().unwrap().to_owned();
    assert!(page.ends_with("deadlines.md"), "{page}");
    assert_eq!(commits(&k), commits_before + 1, "one commit");

    let note = k.read(&page).unwrap();
    assert_eq!(note.meta.title, "Deadlines");
    assert!(note.text.contains("layout: smart"), "{}", note.text);
    let dir = format!("{}.smart", page.strip_suffix(".md").unwrap());
    for (rel, text) in [
        ("index.html", good()[0].content.clone()),
        ("app.js", good()[1].content.clone()),
        ("smart.yaml", good()[2].content.clone()),
    ] {
        let bytes = std::fs::read(t.vault.root().join(format!("{dir}/{rel}"))).unwrap();
        assert_eq!(bytes, text.as_bytes(), "{rel} is byte for byte as sent");
    }
    // The answer names each file with the hash to edit it against.
    let hashes = made["files"].as_array().unwrap();
    assert_eq!(hashes.len(), 3);
    assert!(hashes.iter().all(|f| f["hash"].as_str().is_some()));

    let commit = &k.log(None, 1).unwrap()[0];
    assert_eq!(commit.session.as_deref(), Some(s.id.as_str()));
    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert_eq!(undone.conflict, None);
    let mut after = all_files(&t);
    after.retain(|path, _| !path.starts_with(".trash/"));
    assert_eq!(after, before, "the page and every file are gone");
}

#[test]
fn in_review_mode_it_waits_as_one_proposal_and_nothing_is_written() {
    let (t, k) = open();
    set_mode(&k, AgentMode::Review, &[]);
    let s = session();
    let before = all_files(&t);

    let held = k.agent_run(&s, &create("Deadlines", good()), NOW).unwrap();
    assert!(matches!(held, Outcome::PendingReview { .. }), "{held:?}");
    assert_eq!(all_files(&t), before);
    let proposals = k.proposals().unwrap();
    assert_eq!(proposals.len(), 1);
    assert!(
        proposals[0]
            .diff
            .contains("Make the smart page “Deadlines”"),
        "{}",
        proposals[0].diff
    );
    assert!(
        proposals[0].diff.contains("3 files"),
        "{}",
        proposals[0].diff
    );

    k.accept_proposal(&proposals[0].id, "me", NOW).unwrap();
    let notes = k.list().unwrap();
    let page = notes.iter().find(|n| n.title == "Deadlines").unwrap();
    assert!(there(
        &t,
        &format!("{}.smart/index.html", page.path.trim_end_matches(".md"))
    ));
}

#[test]
fn what_can_never_run_is_refused_and_leaves_no_trace() {
    let (t, k) = open();
    let s = session();
    let before = all_files(&t);
    let with = |extra: SmartNewFile| {
        let mut files = good();
        files.push(extra);
        files
    };
    let cases: Vec<(&str, Vec<SmartNewFile>)> = vec![
        ("no files", vec![]),
        ("no index", vec![file("app.js", "x")]),
        ("a program", with(file("x.exe", "x"))),
        ("a picture", with(file("p.png", "not a picture"))),
        ("up a folder", with(file("../x.js", "x"))),
        ("hidden", with(file(".env.js", "x"))),
        ("absolute", with(file("/x.js", "x"))),
        ("twice", with(file("app.js", "again"))),
        ("case twin", with(file("APP.js", "again"))),
        (
            "bad manifest",
            vec![file("index.html", "x"), file("smart.yaml", "title: ''\n")],
        ),
        (
            "unreadable manifest",
            vec![
                file("index.html", "x"),
                file("smart.yaml", "title: [oops\n"),
            ],
        ),
        ("too big", vec![file("index.html", &"a".repeat(300_000))]),
    ];
    for (what, files) in cases {
        assert!(
            k.agent_run(&s, &create("Deadlines", files), NOW).is_err(),
            "{what}"
        );
        assert_eq!(all_files(&t), before, "{what}");
    }
    assert!(k.agent_run(&s, &create("  ", good()), NOW).is_err());
    assert_eq!(all_files(&t), before);
}

#[test]
fn a_locked_parent_stops_it_and_a_batch_cannot_carry_it() {
    let (t, k) = open();
    let s = session();
    let parent = make_page(&k, "Hub", None, None);
    k.set_meta(
        &Actor::Human,
        &parent.meta.path,
        "locked",
        Some("true"),
        NOW,
    )
    .unwrap();
    let before = all_files(&t);
    let op = AgentOp::SmartCreate {
        title: "Deadlines".into(),
        project: None,
        parent: Some(parent.meta.path.clone()),
        files: good(),
        reason: None,
    };
    assert!(k.agent_run(&s, &op, NOW).is_err());
    assert_eq!(all_files(&t), before);

    let batch = AgentOp::Batch {
        ops: vec![create("Deadlines", good())],
        reason: None,
    };
    assert!(k.agent_run(&s, &batch, NOW).is_err());
    assert_eq!(all_files(&t), before);
}

#[test]
fn a_page_made_this_way_can_be_edited_by_the_smart_write_op_afterwards() {
    let (_t, k) = open();
    let s = session();
    let made = done(k.agent_run(&s, &create("Deadlines", good()), NOW).unwrap());
    let page = made["page"].as_str().unwrap().to_owned();
    let hash = made["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "app.js")
        .unwrap()["hash"]
        .as_str()
        .unwrap()
        .to_owned();
    let edit = AgentOp::SmartWrite {
        page,
        path: "app.js".into(),
        content: "console.log('two');\n".into(),
        base: hash,
        reason: None,
    };
    done(k.agent_run(&s, &edit, NOW).unwrap());
}
