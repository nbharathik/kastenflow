//! The agent modes and a smart page's folder: Review holds every write (and
//! a lock made meanwhile stops it), Autonomous commits with its mark, a
//! project on Review holds in an autonomous vault, a page of many files is
//! not stopped by the notes-per-session limit, a chat that previews its
//! changes holds a write as a proposal, and the destruction drill loses
//! nothing and undoes whole.

use crate::common::NOW;
use crate::smart_support::{
    DIR, PAGE, all_files, delete, dir_of, done, expected, folder_files, make_page, open, session,
    set_mode, smart, snapshot, there, tree, write,
};

use kasten_core::Outcome;
use kasten_core::agent::AgentOp;
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::smart::hash_bytes;

#[test]
fn review_holds_every_write_and_a_lock_made_meanwhile_stops_it() {
    let (t, k) = open();
    smart(&t, &k);
    set_mode(&k, AgentMode::Review, &[]);
    let s = session();
    let hash = hash_bytes(&expected()["app.js"]);
    // Proposals are kept in the order of their time.
    let later = |n: u64| kasten_core::Instant {
        millis: NOW.millis + n * 60_000,
    };

    let op = write(PAGE, "app.js", "console.log('agent');\n", &hash);
    let held = k.agent_run(&s, &op, later(1)).unwrap();
    assert!(matches!(held, Outcome::PendingReview { .. }), "{held:?}");
    let held_delete = k
        .agent_run(&s, &delete(PAGE, "data/venues.json"), later(2))
        .unwrap();
    assert!(matches!(held_delete, Outcome::PendingReview { .. }));
    let new_file = k
        .agent_run(&s, &write(PAGE, "n.js", "n", ""), later(3))
        .unwrap();
    assert!(matches!(new_file, Outcome::PendingReview { .. }));
    assert_eq!(
        snapshot(&t, DIR),
        expected(),
        "nothing is written while it waits"
    );
    let proposals = k.proposals().unwrap();
    assert_eq!(proposals.len(), 3);
    // What a reviewer sees: the file, before and after.
    assert!(
        proposals[0].diff.contains("Rewrite the file app.js"),
        "{}",
        proposals[0].diff
    );
    assert!(proposals[0].diff.contains("agent"), "{}", proposals[0].diff);
    assert_eq!(
        proposals[0].before.as_deref(),
        Some("console.log('hi');\r\nlet x = 1;\r\n")
    );
    assert_eq!(
        proposals[0].after.as_deref(),
        Some("console.log('agent');\n")
    );
    assert!(
        proposals[1].diff.contains("to the trash"),
        "{}",
        proposals[1].diff
    );
    assert!(
        proposals[2].diff.contains("Make the file n.js"),
        "{}",
        proposals[2].diff
    );

    // Accepted: it runs, as the agent's change approved by the person.
    k.accept_proposal(&proposals[0].id, "me", NOW).unwrap();
    assert_eq!(snapshot(&t, DIR)["app.js"], b"console.log('agent');\n");
    // A lock put on meanwhile stops the others.
    k.set_meta(&Actor::Human, PAGE, "locked", Some("true"), NOW)
        .unwrap();
    assert!(k.accept_proposal(&proposals[1].id, "me", NOW).is_err());
    assert!(k.accept_proposal(&proposals[2].id, "me", NOW).is_err());
    assert!(there(&t, &format!("{DIR}/data/venues.json")));
    assert!(!there(&t, &format!("{DIR}/n.js")));
    // And a file that changed since the proposal is not written over.
    k.set_meta(&Actor::Human, PAGE, "locked", None, NOW)
        .unwrap();
    let again = k
        .agent_run(
            &s,
            &write(
                PAGE,
                "app.js",
                "second",
                &hash_bytes(b"console.log('agent');\n"),
            ),
            later(4),
        )
        .unwrap();
    assert!(matches!(again, Outcome::PendingReview { .. }));
    k.smart_write_file(&Actor::Human, PAGE, "app.js", b"person", None, NOW)
        .unwrap();
    let stale = k.proposals().unwrap().pop().unwrap();
    assert!(k.accept_proposal(&stale.id, "me", NOW).is_err());
    assert_eq!(snapshot(&t, DIR)["app.js"], b"person");
}

#[test]
fn autonomous_mode_commits_code_edits_with_its_mark() {
    let (t, k) = open();
    smart(&t, &k);
    set_mode(&k, AgentMode::Autonomous, &[]);
    let s = session();
    let made = k.agent_run(&s, &write(PAGE, "n.js", "n", ""), NOW).unwrap();
    assert!(matches!(made, Outcome::Done { .. }), "{made:?}");
    assert_eq!(
        k.log(None, 1).unwrap()[0].mode.as_deref(),
        Some("autonomous")
    );
    let gone = k.agent_run(&s, &delete(PAGE, "n.js"), NOW).unwrap();
    assert!(matches!(gone, Outcome::Done { .. }));
    assert!(!there(&t, &format!("{DIR}/n.js")));
    assert!(
        !k.list_checkpoints().unwrap().is_empty(),
        "the first autonomous write took a checkpoint"
    );
}

#[test]
fn a_project_on_review_holds_its_pages_folders_in_an_autonomous_vault() {
    let (t, k) = open();
    set_mode(
        &k,
        AgentMode::Autonomous,
        &[("photo-organiser", AgentMode::Review)],
    );
    let inside = make_page(&k, "In project", Some("photo-organiser"), None);
    let outside = make_page(&k, "Outside", None, None);
    for page in [&inside, &outside] {
        k.set_meta(&Actor::Human, &page.meta.path, "layout", Some("smart"), NOW)
            .unwrap();
    }
    let s = session();
    let held = k
        .agent_run(&s, &write(&inside.meta.path, "index.html", "x", ""), NOW)
        .unwrap();
    assert!(matches!(held, Outcome::PendingReview { .. }), "{held:?}");
    let ran = k
        .agent_run(&s, &write(&outside.meta.path, "index.html", "x", ""), NOW)
        .unwrap();
    assert!(matches!(ran, Outcome::Done { .. }));
    assert!(!there(&t, &dir_of(&inside.meta.path)));
}

#[test]
fn a_session_held_to_a_project_takes_the_stricter_of_it_and_the_note() {
    let (_t, k) = open();
    set_mode(
        &k,
        AgentMode::Autonomous,
        &[("photo-organiser", AgentMode::Review)],
    );
    let loose = make_page(&k, "Loose", None, None);
    let append = |path: &str| AgentOp::Append {
        path: path.to_owned(),
        markdown: "more\n".into(),
        heading: None,
    };
    // The page lives in a Review project; its write lands in a looser place.
    let held_session = session();
    k.hold_session_to(&held_session, Some("photo-organiser"));
    let held = k
        .agent_run(&held_session, &append(&loose.meta.path), NOW)
        .unwrap();
    assert!(matches!(held, Outcome::PendingReview { .. }), "{held:?}");
    // A batch is decided the same way.
    let batch = AgentOp::Batch {
        ops: vec![append(&loose.meta.path)],
        reason: None,
    };
    let held = k.agent_run(&held_session, &batch, NOW).unwrap();
    assert!(matches!(held, Outcome::PendingReview { .. }), "{held:?}");
    // The other way round: a page in a looser place does not loosen a strict note.
    let strict = make_page(&k, "Strict", Some("photo-organiser"), None);
    let free_session = session();
    k.hold_session_to(&free_session, None);
    let held = k
        .agent_run(&free_session, &append(&strict.meta.path), NOW)
        .unwrap();
    assert!(matches!(held, Outcome::PendingReview { .. }), "{held:?}");
    // A session held to nothing special is decided by the note alone.
    let plain = session();
    let ran = k.agent_run(&plain, &append(&loose.meta.path), NOW).unwrap();
    assert!(matches!(ran, Outcome::Done { .. }), "{ran:?}");
}

#[test]
fn a_board_or_diagram_made_in_a_project_is_held_by_the_projects_mode_whatever_the_spelling() {
    let (t, k) = open();
    set_mode(
        &k,
        AgentMode::Autonomous,
        &[("photo-organiser", AgentMode::Review)],
    );
    make_page(&k, "In project", Some("photo-organiser"), None);
    let before = all_files(&t);
    let s = session();
    for op in [
        AgentOp::CreateBoard {
            title: "Spelled".into(),
            project: Some("Photo Organiser".into()),
        },
        AgentOp::CreateDiagram {
            title: "Spelled".into(),
            project: Some("PHOTO-ORGANISER".into()),
            xml: String::new(),
        },
    ] {
        // Held for review (or refused), never made at once in the project's folder.
        match k.agent_run(&s, &op, NOW) {
            Ok(Outcome::PendingReview { .. }) | Err(_) => {}
            other => panic!("{op:?} was not held: {other:?}"),
        }
    }
    // Nothing was made outside the proposals the app keeps for itself.
    assert!(
        all_files(&t)
            .keys()
            .all(|p| before.contains_key(p) || p.starts_with(".kasten/")),
        "something was written"
    );
}

#[test]
fn building_a_page_of_many_files_is_not_stopped_by_the_notes_per_session_limit() {
    let (t, k) = open();
    smart(&t, &k);
    let s = session();
    for n in 0..60 {
        let outcome = k
            .agent_run(
                &s,
                &write(PAGE, &format!("data/part{n}.json"), "{}", ""),
                NOW,
            )
            .unwrap();
        assert!(matches!(outcome, Outcome::Done { .. }), "{n}: {outcome:?}");
    }
    assert!(k.proposals().unwrap().is_empty());
    assert_eq!(snapshot(&t, DIR).len(), expected().len() + 60);
}

#[test]
fn a_chat_that_previews_its_changes_holds_a_smart_write_as_a_proposal() {
    let (t, k) = open();
    smart(&t, &k);
    let s = session();
    let mut set = k.begin_changes(&s, NOW);
    let op = write(PAGE, "n.js", "n", "");
    assert!(matches!(
        k.stage(&mut set, &s, &op, NOW).unwrap(),
        Outcome::PendingReview { .. }
    ));
    assert!(!there(&t, &format!("{DIR}/n.js")));
    // The refusals hold there too.
    k.set_meta(&Actor::Human, PAGE, "locked", Some("true"), NOW)
        .unwrap();
    assert!(k.stage(&mut set, &s, &op, NOW).is_err());
}

#[test]
fn the_destruction_drill_with_a_smart_page_loses_nothing_and_undoes_whole() {
    let (t, k) = open();
    let page = smart(&t, &k);
    set_mode(&k, AgentMode::Autonomous, &[]);
    // A person's typing waits for its commit: it goes in before the session starts.
    k.commit_edits().unwrap();
    k.commit_external().unwrap();
    let before = tree(&t);
    let files_before = all_files(&t);
    // Every file but the smart page's own: those are renamed and moved on purpose.
    let originals: Vec<String> = all_files(&t)
        .into_keys()
        .filter(|path| !path.starts_with(DIR) && path != PAGE)
        .collect();
    let s = session();

    // Empty every file of the folder, then take each out.
    for (rel, bytes) in folder_files() {
        if rel.ends_with(".png") {
            continue; // agents write text
        }
        let hash = hash_bytes(&bytes);
        let outcome = k.agent_run(&s, &write(PAGE, rel, "", &hash), NOW);
        // smart.yaml cannot be emptied (it must stay a manifest); the rest can.
        assert_eq!(outcome.is_ok(), rel != "smart.yaml", "{rel}");
    }
    for (rel, _) in folder_files() {
        assert!(k.agent_run(&s, &delete(PAGE, rel), NOW).is_ok(), "{rel}");
    }
    // Reach for everything that is not theirs.
    for attempt in [
        write(".git/config", "x.js", "x", ""),
        write("../outside.md", "x.js", "x", ""),
        write(".kasten/config.yaml", "x.js", "x", ""),
        write("templates/page.md", "x.js", "x", ""),
        write(PAGE, "../../outside.js", "x", ""),
        delete(PAGE, ".git/config"),
    ] {
        assert!(k.agent_run(&s, &attempt, NOW).is_err(), "{attempt:?}");
    }
    // The page and the folder, renamed, moved, trashed in a storm.
    let mut current = page.meta.path.clone();
    for n in 0..5 {
        let op = AgentOp::Rename {
            path: current.clone(),
            title: format!("Storm {n}"),
        };
        let renamed = done(k.agent_run(&s, &op, NOW).unwrap());
        current = renamed["note"]["path"].as_str().unwrap().to_owned();
    }
    let op = AgentOp::Move {
        path: current,
        project: Some("photo-organiser".into()),
    };
    let moved = done(k.agent_run(&s, &op, NOW).unwrap());
    let at = moved["path"].as_str().unwrap().to_owned();
    let op = AgentOp::Trash {
        path: at,
        reason: None,
    };
    done(k.agent_run(&s, &op, NOW).unwrap());

    // Nothing else was touched, and what the agent took out is in the trash.
    let now = all_files(&t);
    for path in &originals {
        assert!(now.contains_key(path), "{path} was lost");
    }
    let trash = snapshot(&t, ".trash");
    for (rel, _) in folder_files() {
        assert!(
            trash
                .keys()
                .any(|p| p.ends_with(&format!("tracker.smart/{rel}"))),
            "{rel} is not in the trash"
        );
    }
    assert!(trash.keys().any(|p| p.ends_with("pages/storm-4.md")));
    // And the whole session undoes to the exact tree, by new commits.
    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert_eq!(undone.conflict, None);
    assert_eq!(all_files(&t), files_before);
    assert_eq!(tree(&t), before);
    assert_eq!(snapshot(&t, DIR), expected());
}
