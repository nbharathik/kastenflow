//! Checks added when the smart page core was verified: a lock that a header
//! hides holds for every agent op, the manifest keeps what the person wrote,
//! hostile pages search in bounded time, an agent can make and fill a smart
//! page and a session undoes it whole, and an agent works in the project's
//! mode however the folder is spelled.

use crate::common::NOW;
use crate::smart_support::{
    DIR, PAGE, all_files, delete, dir_of, done, expected, make_page, open, put_folder, session,
    set_mode, smart, snapshot, there, undo_last, write,
};

use std::fs;
use std::time::{Duration, Instant};

use kasten_core::Outcome;
use kasten_core::agent::{AgentOp, SmartNewFile};
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::smart::SmartManifest;

fn agent_ops(path: &str) -> Vec<AgentOp> {
    vec![
        AgentOp::Append {
            path: path.into(),
            markdown: "x".into(),
            heading: None,
        },
        AgentOp::Rename {
            path: path.into(),
            title: "Other".into(),
        },
        AgentOp::Trash {
            path: path.into(),
            reason: None,
        },
        AgentOp::Move {
            path: path.into(),
            project: Some("photo-organiser".into()),
        },
        AgentOp::Tags {
            path: path.into(),
            add: vec!["x".into()],
            remove: vec![],
        },
        AgentOp::SetNoteMeta {
            path: path.into(),
            key: "icon".into(),
            value: Some("star".into()),
        },
        AgentOp::Edit {
            path: path.into(),
            body: "new".into(),
            base: String::new(),
            reason: None,
        },
        write(path, "index.html", "x", ""),
        delete(path, "index.html"),
    ]
}

#[test]
fn a_lock_a_header_hides_still_holds_for_every_agent_op_in_every_mode() {
    let (t, k) = open();
    let page = make_page(&k, "Plain", None, None);
    let path = page.meta.path.clone();
    let s = session();
    // A control: the same page, unlocked, takes an agent's text.
    let control = AgentOp::Append {
        path: path.clone(),
        markdown: "control\n".into(),
        heading: None,
    };
    done(k.agent_run(&s, &control, NOW).unwrap());
    for (header, why) in [
        (
            "broken: [unclosed\nlocked: true\n",
            "yaml that does not parse",
        ),
        (
            "title: [a, b]\nlocked: true\n",
            "a value the known keys cannot read",
        ),
        ("locked: yes\n", "yes"),
        ("locked: true\nbad: [\n", "a lock before the break"),
    ] {
        fs::write(
            t.vault.root().join(&path),
            format!("---\n{header}---\nBody.\n"),
        )
        .unwrap();
        let before = all_files(&t);
        if why.starts_with("a value") {
            // The reader of the known keys gives up on this header and sees no
            // lock: only the plain reading of the keys finds it.
            assert!(!k.read(&path).unwrap().meta.locked);
        }
        for mode in [
            AgentMode::Review,
            AgentMode::Balanced,
            AgentMode::Autonomous,
        ] {
            set_mode(&k, mode, &[]);
            for op in agent_ops(&path) {
                match k.agent_run(&s, &op, NOW) {
                    Err(err) => {
                        let said = err.to_string();
                        assert!(
                            said.contains("locked") || said.contains("smart page"),
                            "{why} {mode:?} {op:?}: {said}"
                        );
                    }
                    Ok(outcome) => panic!("{why} {mode:?} {op:?} ran: {outcome:?}"),
                }
            }
        }
        assert_eq!(all_files(&t), before, "{why}");
        assert!(k.proposals().unwrap().is_empty(), "{why}");
    }
}

#[test]
fn the_manifest_keeps_comments_order_and_line_endings_when_one_key_changes() {
    let (t, k) = open();
    let human = Actor::Human;
    for (n, eol) in ["\n", "\r\n"].into_iter().enumerate() {
        let page = make_page(&k, &format!("Tracker {n}"), None, None);
        let path = page.meta.path.as_str();
        let text = "# The tracker\nversion: 1\ntitle: Conference tracker   # shown on top\n\nqueries:\n  venues:\n    tag: venue   # why\nfuture: [a, b]  # kept\nkit: \"1\"\n".replace('\n', eol);
        let file = t.vault.root().join(format!("{}/smart.yaml", dir_of(path)));
        let set =
            |manifest: &SmartManifest| k.smart_set_manifest(&human, path, manifest, None, NOW);
        k.smart_write_file(&human, path, "smart.yaml", text.as_bytes(), Some(""), NOW)
            .unwrap();
        let mut manifest = k.smart_manifest(path).unwrap().unwrap();
        // The typed file is committed first, whatever the op; then nothing more.
        set(&manifest).unwrap();
        let head = k.log(None, 1).unwrap()[0].id.clone();
        assert!(!set(&manifest).unwrap().changed);
        assert_eq!(k.log(None, 1).unwrap()[0].id, head);
        assert_eq!(fs::read_to_string(&file).unwrap(), text);

        manifest.title = "Venue tracker".to_owned();
        set(&manifest).unwrap();
        let after = fs::read_to_string(&file).unwrap();
        let line = |title: &str| format!("title: {title}{eol}");
        assert_eq!(
            after,
            text.replace(
                &line("Conference tracker   # shown on top"),
                &line("Venue tracker")
            )
        );

        // A changed query rewrites that block only.
        manifest.queries.get_mut("venues").unwrap().tag = "place".to_owned();
        set(&manifest).unwrap();
        let after = fs::read_to_string(&file).unwrap();
        let top = format!("# The tracker{eol}version: 1{eol}{}", line("Venue tracker"));
        assert!(after.starts_with(&top), "{after:?}");
        let end = format!("future: [a, b]  # kept{eol}kit: \"1\"{eol}");
        assert!(after.ends_with(&end), "{after:?}");
        assert!(after.contains("place"), "{after:?}");

        // Undo puts the bytes before the last change back.
        undo_last(&k);
        let back = fs::read_to_string(&file).unwrap();
        assert!(
            back.contains("Venue tracker") && back.contains("venue   # why"),
            "{back:?}"
        );
    }
}

#[test]
fn hostile_pages_are_searched_in_bounded_time_and_never_panic() {
    let (t, k) = open();
    let page = make_page(&k, "Tracker", None, None);
    let limit = 2 * 1024 * 1024;
    let started = Instant::now();
    let index = |bytes: Vec<u8>| put_folder(&t, &k, &page.meta.path, &[("index.html", bytes)]);
    for piece in ["&", "<head>", "<script>", "<!--", "<a b=\"", "é<"] {
        index(piece.repeat(limit / piece.len()).into_bytes());
        assert!(k.search("walrus", 10).unwrap().is_empty());
    }
    // Over the size a file may be: skipped, not read.
    index(
        "<p>walrus</p>"
            .repeat(10 * 1024 * 1024 / 13 + 1)
            .into_bytes(),
    );
    assert!(k.search("walrus", 10).unwrap().is_empty());
    // Not UTF-8: skipped.
    index(vec![0xff, 0xfe, b'w', 0x80]);
    assert!(k.search("walrus", 10).unwrap().is_empty());
    let took = started.elapsed();
    assert!(took < Duration::from_secs(120), "{took:?}");
}

#[test]
fn an_agent_makes_a_smart_page_and_fills_it_and_a_session_undoes_it_whole() {
    let (t, k) = open();
    let s = session();
    let before = all_files(&t);
    let create = AgentOp::CreateNote {
        note_type: "page".into(),
        title: "Agent tracker".into(),
        body: "Notes.\n".into(),
        project: None,
        tags: vec![],
        props: Default::default(),
        parent: None,
        template: None,
    };
    let made = done(k.agent_run(&s, &create, NOW).unwrap());
    let path = made["path"].as_str().unwrap().to_owned();
    // Not a smart page until its layout says so.
    let first = write(&path, "index.html", "<p>x</p>", "");
    assert!(k.agent_run(&s, &first, NOW).is_err());
    let layout = AgentOp::SetNoteMeta {
        path: path.clone(),
        key: "layout".into(),
        value: Some("smart".into()),
    };
    // An agent cannot turn a page into a smart page, alone or in a batch;
    // smart_create is its way in, and a person's choice is the other.
    assert!(k.agent_run(&s, &layout, NOW).is_err());
    let batched = AgentOp::Batch {
        ops: vec![layout],
        reason: None,
    };
    assert!(k.agent_run(&s, &batched, NOW).is_err());
    assert!(!k.read(&path).unwrap().text.contains("layout: smart"));
    assert!(k.agent_run(&s, &first, NOW).is_err());
    // smart_create is the way in: the page and its folder together.
    let create_smart = AgentOp::SmartCreate {
        title: "Agent smart tracker".into(),
        project: None,
        parent: None,
        files: vec![SmartNewFile {
            path: "index.html".into(),
            content: "<h1>Agent wrote this</h1>".into(),
        }],
        reason: None,
    };
    let page_made = done(k.agent_run(&s, &create_smart, NOW).unwrap());
    let path = page_made["page"].as_str().unwrap().to_owned();
    assert!(k.read(&path).unwrap().text.contains("layout: smart"));
    let manifest = write(&path, "smart.yaml", "title: Agent smart tracker\n", "");
    done(k.agent_run(&s, &manifest, NOW).unwrap());
    let hits = k.search("wrote", 10).unwrap();
    assert!(hits.iter().any(|hit| hit.path == path));
    // The page and its folder go to the trash together, then everything is undone.
    let trash = AgentOp::Trash {
        path: path.clone(),
        reason: None,
    };
    done(k.agent_run(&s, &trash, NOW).unwrap());
    assert!(!there(&t, &dir_of(&path)));
    assert_eq!(k.undo_session(&s.id, NOW).unwrap().conflict, None);
    let mut after = all_files(&t);
    after.retain(|p, _| !p.starts_with(".trash/"));
    assert_eq!(after, before);
}

#[test]
fn an_agent_works_in_the_projects_mode_however_the_folder_is_spelled() {
    let (t, k) = open();
    let page = make_page(&k, "Tracker", Some("photo-organiser"), None);
    k.set_meta(&Actor::Human, &page.meta.path, "layout", Some("smart"), NOW)
        .unwrap();
    set_mode(
        &k,
        AgentMode::Autonomous,
        &[("photo-organiser", AgentMode::Review)],
    );
    let upper = page.meta.path.replacen("projects", "PROJECTS", 1).replacen(
        "photo-organiser",
        "Photo-Organiser",
        1,
    );
    let s = session();
    let proper = write(&page.meta.path, "index.html", "<p>x</p>", "");
    assert!(matches!(
        k.agent_run(&s, &proper, NOW).unwrap(),
        Outcome::PendingReview { .. }
    ));
    if !t.vault.root().join(&upper).exists() {
        return; // A disk that tells the spellings apart has nothing to hold.
    }
    let spelled = write(&upper, "index.html", "<p>y</p>", "");
    match k.agent_run(&s, &spelled, NOW) {
        Ok(Outcome::PendingReview { .. }) | Err(_) => {}
        other => panic!("a spelling got past the project's review: {other:?}"),
    }
    let written = format!("{}/index.html", dir_of(&page.meta.path));
    assert!(!there(&t, &written));
}

#[test]
fn smart_helpers_still_agree_with_the_standard_page() {
    let (t, k) = open();
    smart(&t, &k);
    assert_eq!(snapshot(&t, DIR), expected());
    assert!(there(&t, PAGE));
}
