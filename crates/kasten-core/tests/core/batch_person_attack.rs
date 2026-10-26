//! Attacks on a person's batch: spellings of a path that name the same file in
//! another way, the lock compared with single changes, a failure that has to
//! put files back when the path was spelled oddly.

use std::fs;

use kasten_core::Kasten;
use kasten_core::agent::AgentOp;
use kasten_core::history::{Actor, History};

use crate::batch_person::{commits, person};
use crate::change_sets::{DRAFT, WELCOME, append, create, open, replace, snapshot};
use crate::common::NOW;

const SKETCH: &str = "projects/photo-organiser/cards/duplicate-score-sketch.md";

/// The same file as `WELCOME`, spelled with other capitals.
fn shouted(path: &str) -> String {
    path.replacen("library", "Library", 1)
}

#[test]
fn a_path_spelled_with_other_capitals_never_deletes_the_real_file_when_the_batch_fails() {
    let (t, k, _) = open();
    let files = snapshot(t.vault.root());
    let before = commits(&k);
    k.fail_batch_after(1);
    let ops = vec![
        append(&shouted(WELCOME), "Via capitals."),
        create("Second", ""),
    ];
    let result = person(&k, ops);
    // Whatever happened to the batch, the note is where it was, with its bytes.
    let after = snapshot(t.vault.root());
    assert!(result.is_err());
    assert_eq!(after.get(WELCOME), files.get(WELCOME), "the real note");
    assert_eq!(after, files, "every byte back");
    assert_eq!(commits(&k), before);
}

#[test]
fn a_path_spelled_with_other_capitals_is_refused_with_nothing_changed() {
    let (t, k, _) = open();
    let h = History::open(t.vault.root()).unwrap().unwrap();
    let files = snapshot(t.vault.root());
    let before = commits(&k);
    let mut child = create("Child", "");
    if let AgentOp::CreateNote { parent, .. } = &mut child {
        *parent = Some(shouted(WELCOME));
    }
    for op in [append(&shouted(WELCOME), "Via capitals."), child] {
        let err = person(&k, vec![create("First", ""), op])
            .unwrap_err()
            .to_string();
        assert!(err.contains("Change 2 of 2"), "{err}");
        assert!(err.contains("Nothing in the batch was changed"), "{err}");
    }
    assert_eq!(snapshot(t.vault.root()), files);
    assert_eq!(commits(&k), before);
    assert!(h.dirty().unwrap().is_empty());
}

#[test]
fn an_agents_batch_cannot_use_other_capitals_to_get_a_file_removed_by_a_failure_either() {
    let (t, k, s) = open();
    let files = snapshot(t.vault.root());
    k.fail_batch_after(1);
    let batch = AgentOp::Batch {
        ops: vec![
            append(&shouted(WELCOME), "Via capitals."),
            create("Second", ""),
        ],
        reason: None,
    };
    assert!(k.agent_run(&s, &batch, NOW).is_err());
    assert_eq!(snapshot(t.vault.root()), files, "every byte back");
}

#[test]
fn a_note_that_history_does_not_hold_is_never_removed_by_a_failed_batch() {
    let (t, k, _) = open();
    // A note the vault's ignore list keeps out of History.
    let ignore = t.vault.root().join(".gitignore");
    let mut list = fs::read_to_string(&ignore).unwrap_or_default();
    list.push_str("\ninbox/kept-out.md\n");
    fs::write(&ignore, list).unwrap();
    let kept = "---\ntitle: Kept out\ntype: page\n---\nMine.\n";
    fs::write(t.vault.root().join("inbox/kept-out.md"), kept).unwrap();
    k.reindex().unwrap();
    k.commit_external().unwrap();
    let files = snapshot(t.vault.root());
    k.fail_batch_after(1);
    let err = person(
        &k,
        vec![append("inbox/kept-out.md", "More."), create("Second", "")],
    )
    .unwrap_err()
    .to_string();
    assert!(err.contains("not in History"), "{err}");
    assert_eq!(snapshot(t.vault.root()), files, "the note is as it was");
    assert_eq!(
        fs::read_to_string(t.vault.root().join("inbox/kept-out.md")).unwrap(),
        kept
    );
}

#[test]
fn windows_names_that_stand_for_other_files_are_refused_at_every_change() {
    let (t, k, _) = open();
    let files = snapshot(t.vault.root());
    let before = commits(&k);
    let one = |op: AgentOp| vec![append(WELCOME, "First."), op];
    let mut bad = Vec::new();
    for path in [
        "library/con.md",
        "library/NUL.md",
        "library/aux",
        "library/welcome-to-kasten.md.",
        "library/welcome-to-kasten.md ",
        "library./welcome-to-kasten.md",
        "libra~1/welcome-to-kasten.md",
        "library/welcom~1.md",
        "library//welcome-to-kasten.md",
        "library/./welcome-to-kasten.md",
        "library/welcome-to-kasten.md\0",
        "",
        "/",
        ".",
    ] {
        bad.push(append(path, "x"));
    }
    for op in bad {
        let name = format!("{op:?}");
        let err = person(&k, one(op));
        assert!(err.is_err(), "{name}");
        assert_eq!(snapshot(t.vault.root()), files, "{name}");
    }
    assert_eq!(commits(&k), before);
}

#[test]
fn a_link_inside_the_vault_is_never_followed_out_of_it() {
    let (t, k, _) = open();
    let outside = std::env::temp_dir().join(format!("kasten-outside-{}", std::process::id()));
    fs::create_dir_all(&outside).unwrap();
    let target = outside.join("x.md");
    fs::write(
        &target,
        "---\ntitle: Outside\ntype: page\n---\nNot yours.\n",
    )
    .unwrap();
    let link = t.vault.root().join("library/linked");
    let files = snapshot(t.vault.root());
    #[cfg(unix)]
    let made = std::os::unix::fs::symlink(&outside, &link);
    #[cfg(windows)]
    let made = std::os::windows::fs::symlink_dir(&outside, &link);
    if made.is_err() {
        // A computer that lets this account make no links has none to follow.
        let _ = fs::remove_dir_all(&outside);
        return;
    }
    let outside_before = fs::read(&target).unwrap();
    let ops = vec![
        create("First", ""),
        append("library/linked/x.md", "Pushed through the link."),
    ];
    let refused = person(&k, ops).is_err();
    let outside_after = fs::read(&target).unwrap();
    let _ = fs::remove_dir(&link);
    let _ = fs::remove_file(&link);
    let _ = fs::remove_dir_all(&outside);
    assert!(refused);
    assert_eq!(
        outside_after, outside_before,
        "the file outside is as it was"
    );
    assert_eq!(snapshot(t.vault.root()), files);
}

#[test]
fn a_tag_name_with_dots_and_slashes_only_ever_names_a_file_under_tags() {
    let (t, k, _) = open();
    for tag in [
        "../.kasten/x",
        "..",
        "a/../../b",
        ".git/hooks",
        "C:\\x",
        "con",
    ] {
        let before = snapshot(t.vault.root());
        let op = AgentOp::TagSchema {
            tag: tag.into(),
            schema: serde_json::json!({"properties": [{"key": "a", "type": "text"}]}),
        };
        match person(&k, vec![op]) {
            Err(_) => assert_eq!(snapshot(t.vault.root()), before, "{tag}"),
            Ok(done) => {
                let path = done.results[0]["path"].as_str().unwrap().to_owned();
                assert!(
                    path.starts_with("tags/") && !path.contains("..") && !path[5..].contains('/'),
                    "{tag}: {path}"
                );
            }
        }
    }
    assert!(!t.vault.root().join("../x").exists());
}

#[test]
fn projects_named_oddly_cannot_lead_a_move_or_a_board_out_of_the_vault() {
    let (t, k, _) = open();
    for project in [
        "../outside",
        "..",
        ".kasten",
        "a/../../b",
        "C:\\x",
        "/abs",
        "con",
    ] {
        let before = snapshot(t.vault.root());
        for op in [
            AgentOp::Move {
                path: SKETCH.into(),
                project: Some(project.into()),
            },
            AgentOp::CreateBoard {
                title: "Odd".into(),
                project: Some(project.into()),
            },
        ] {
            let name = format!("{project} {}", op.name());
            let result = person(&k, vec![op]);
            let after = snapshot(t.vault.root());
            if result.is_err() {
                assert_eq!(after, before, "{name}");
            } else {
                for new in after.keys().filter(|p| !before.contains_key(*p)) {
                    assert!(
                        !new.contains("..") && !new.starts_with('.') && !new.contains("/."),
                        "{name}: {new}"
                    );
                }
            }
        }
    }
    assert!(!t.vault.root().join("../outside").exists());
}

#[test]
fn a_person_changes_a_locked_page_in_a_batch_exactly_as_a_single_change_does() {
    let lock = |t: &crate::common::TempVault, k: &Kasten| {
        let file = t.vault.root().join(DRAFT);
        let text = fs::read_to_string(&file)
            .unwrap()
            .replacen("---\n", "---\nlocked: true\n", 1);
        fs::write(&file, text).unwrap();
        k.reindex().unwrap();
        k.commit_external().unwrap();
    };
    let ops = || {
        vec![
            append(DRAFT, "Appended."),
            replace(DRAFT, "3. Method", "Replaced."),
            AgentOp::Tags {
                path: DRAFT.into(),
                add: vec!["checked".into()],
                remove: vec![],
            },
            AgentOp::UpdateProps {
                path: DRAFT.into(),
                props: serde_json::from_value(serde_json::json!({"mood": "fine"})).unwrap(),
            },
        ]
    };
    let (single_vault, single, _) = open();
    lock(&single_vault, &single);
    for op in ops() {
        match op {
            AgentOp::Append {
                path,
                markdown,
                heading,
            } => single
                .append(&Actor::Human, &path, &markdown, heading.as_deref(), NOW)
                .map(|_| ()),
            AgentOp::ReplaceSection {
                path,
                heading,
                markdown,
            } => single
                .replace_section(&Actor::Human, &path, &heading, &markdown, NOW)
                .map(|_| ()),
            AgentOp::Tags { path, add, remove } => single
                .set_tags(&Actor::Human, &path, &add, &remove, NOW)
                .map(|_| ()),
            AgentOp::UpdateProps { path, props } => single
                .update_props(&Actor::Human, &path, &props, NOW)
                .map(|_| ()),
            _ => unreachable!(),
        }
        .unwrap_or_else(|err| panic!("a person's single change to a locked page: {err}"));
    }
    let (batch_vault, batched, _) = open();
    lock(&batch_vault, &batched);
    person(&batched, ops()).unwrap();
    let one = fs::read_to_string(single_vault.vault.root().join(DRAFT)).unwrap();
    let all = fs::read_to_string(batch_vault.vault.root().join(DRAFT)).unwrap();
    assert!(one.contains("locked: true") && one.contains("Appended."));
    assert_eq!(
        all, one,
        "the batch and the single changes make the same page"
    );
}
