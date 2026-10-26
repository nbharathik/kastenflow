//! Agents and a smart page's folder: the page's lock keeps them out of it in
//! every mode (a header that cannot be read counts as a lock), Balanced lets
//! them write and take out files as ordinary writes, only a smart page and
//! only text, and nothing they do deletes anything for good: files go to the
//! trash, and a session undoes whole.

use crate::common::NOW;
use crate::smart_support::{
    DIR, PAGE, all_files, delete, done, expected, make_page, open, session, set_mode, smart,
    snapshot, there, write,
};

use std::fs;

use kasten_core::agent::AgentOp;
use kasten_core::config_keys::AgentMode;
use kasten_core::history::Actor;
use kasten_core::smart::hash_bytes;

#[test]
fn in_balanced_mode_an_agent_writes_and_takes_out_files_as_ordinary_writes() {
    let (t, k) = open();
    smart(&t, &k);
    let s = session();
    let before = all_files(&t);

    // A new file: no base.
    let made = done(
        k.agent_run(&s, &write(PAGE, "views/map.js", "let map = 1;\n", ""), NOW)
            .unwrap(),
    );
    assert_eq!(
        (made["status"].as_str(), made["path"].as_str()),
        (Some("created"), Some("views/map.js"))
    );
    assert_eq!(snapshot(&t, DIR)["views/map.js"], b"let map = 1;\n");
    let commit = &k.log(None, 1).unwrap()[0];
    assert_eq!(commit.session.as_deref(), Some(s.id.as_str()));
    assert!(commit.author.starts_with("agent:"), "{}", commit.author);
    assert!(
        commit.mode.is_none(),
        "a balanced write carries no autonomous mode"
    );

    // The same file against the hash it was read with.
    let hash = made["hash"].as_str().unwrap().to_owned();
    assert_eq!(hash, hash_bytes(b"let map = 1;\n"));
    let op = write(PAGE, "views/map.js", "let map = 2;\n", &hash);
    let saved = done(k.agent_run(&s, &op, NOW).unwrap());
    assert_eq!(saved["status"], "saved");
    // Writing the same text again changes nothing.
    let hash2 = saved["hash"].as_str().unwrap().to_owned();
    let op = write(PAGE, "views/map.js", "let map = 2;\n", &hash2);
    let same = done(k.agent_run(&s, &op, NOW).unwrap());
    assert_eq!(same["status"], "unchanged");

    // Taking one out moves it to the trash; a person can put it back.
    let gone = done(k.agent_run(&s, &delete(PAGE, "app.js"), NOW).unwrap());
    let trashed = gone["trashed"].as_str().unwrap().to_owned();
    assert!(!there(&t, &format!("{DIR}/app.js")));
    assert_eq!(
        fs::read(t.vault.root().join(&trashed)).unwrap(),
        expected()["app.js"]
    );
    k.smart_restore_file(&Actor::Human, &trashed, NOW).unwrap();
    assert_eq!(snapshot(&t, DIR)["app.js"], expected()["app.js"]);

    // Everything the session did undoes, and the tree is as it was.
    let undone = k.undo_session(&s.id, NOW).unwrap();
    assert_eq!(undone.conflict, None);
    let mut after = all_files(&t);
    after.retain(|path, _| !path.starts_with(".trash/"));
    assert_eq!(after, before);
}

#[test]
fn a_file_changed_since_it_was_read_is_never_written_over() {
    let (t, k) = open();
    smart(&t, &k);
    let s = session();
    let stale = hash_bytes(&expected()["app.js"]);
    k.smart_write_file(&Actor::Human, PAGE, "app.js", b"a person's edit", None, NOW)
        .unwrap();
    for op in [
        write(PAGE, "app.js", "agent text", &stale),
        write(PAGE, "app.js", "agent text", ""),
        write(PAGE, "nope.js", "agent text", &stale),
    ] {
        assert!(k.agent_run(&s, &op, NOW).is_err(), "{op:?}");
    }
    assert_eq!(snapshot(&t, DIR)["app.js"], b"a person's edit");
}

#[test]
fn only_a_smart_page_and_only_text_files() {
    let (t, k) = open();
    let page = make_page(&k, "Tracker", None, None);
    let s = session();
    let human = Actor::Human;
    // Not a smart page yet: no layout, or another one.
    let first = write(PAGE, "index.html", "x", "");
    assert!(k.agent_run(&s, &first, NOW).is_err());
    k.set_meta(&human, &page.meta.path, "layout", Some("sections"), NOW)
        .unwrap();
    let refused = k.agent_run(&s, &first, NOW).unwrap_err();
    assert!(
        refused.to_string().contains("not a smart page"),
        "{refused}"
    );
    assert!(!there(&t, DIR));
    k.set_meta(&human, &page.meta.path, "layout", Some("smart"), NOW)
        .unwrap();
    done(
        k.agent_run(&s, &write(PAGE, "index.html", "<p>x</p>", ""), NOW)
            .unwrap(),
    );

    let before = all_files(&t);
    for (path, content) in [
        ("assets/p.png", "not really a picture"),
        ("assets/p.jpg", "x"),
        ("x.wasm", "x"),
        ("x.exe", "x"),
        ("x.md", "# x"),
        (".hidden.js", "x"),
        ("../x.js", "x"),
        ("a/../../x.js", "x"),
        ("/abs.js", "x"),
        ("C:/x.js", "x"),
        ("smart.yaml", "title: ''\n"),
        ("smart.yaml", "title: [oops\n"),
    ] {
        let op = write(PAGE, path, content, "");
        assert!(k.agent_run(&s, &op, NOW).is_err(), "{path}");
    }
    // The manifest, when it is a good one, is welcome.
    let manifest = write(PAGE, "smart.yaml", "title: Tracker\n", "");
    done(k.agent_run(&s, &manifest, NOW).unwrap());
    // An agent's single write is held to the vault's size limit, not the folder's 2 MB.
    let big = "a".repeat(300_000);
    let op = write(PAGE, "data/big.json", &big, "");
    let refused = k.agent_run(&s, &op, NOW).unwrap_err();
    assert!(refused.to_string().contains("single write"), "{refused}");
    let mut after = all_files(&t);
    after.remove(&format!("{DIR}/smart.yaml"));
    assert_eq!(after, before);

    // A batch cannot carry a smart write.
    let batch = AgentOp::Batch {
        ops: vec![write(PAGE, "a.js", "x", "")],
        reason: None,
    };
    assert!(k.agent_run(&s, &batch, NOW).is_err());
    assert!(!there(&t, &format!("{DIR}/a.js")));
}

#[test]
fn a_locked_page_keeps_agents_out_of_its_folder_in_every_mode() {
    let (t, k) = open();
    smart(&t, &k);
    k.set_meta(&Actor::Human, PAGE, "locked", Some("true"), NOW)
        .unwrap();
    let s = session();
    let hash = hash_bytes(&expected()["app.js"]);
    for mode in [
        AgentMode::Review,
        AgentMode::Balanced,
        AgentMode::Autonomous,
    ] {
        set_mode(&k, mode, &[]);
        for op in [
            write(PAGE, "app.js", "x", &hash),
            write(PAGE, "new.js", "x", ""),
            delete(PAGE, "app.js"),
            delete(PAGE, "index.html"),
        ] {
            let refused = k.agent_run(&s, &op, NOW).unwrap_err();
            assert!(
                refused.to_string().contains("locked"),
                "{mode:?} {op:?}: {refused}"
            );
        }
        // Nor can the page and its folder be moved, renamed or trashed from under the lock.
        for op in [
            AgentOp::Rename {
                path: PAGE.into(),
                title: "Other".into(),
            },
            AgentOp::Move {
                path: PAGE.into(),
                project: Some("photo-organiser".into()),
            },
            AgentOp::Trash {
                path: PAGE.into(),
                reason: None,
            },
        ] {
            assert!(k.agent_run(&s, &op, NOW).is_err(), "{mode:?} {op:?}");
        }
    }
    assert!(k.proposals().unwrap().is_empty());
    assert_eq!(snapshot(&t, DIR), expected());
    // Unlocked by a person, the same write runs.
    k.set_meta(&Actor::Human, PAGE, "locked", None, NOW)
        .unwrap();
    set_mode(&k, AgentMode::Balanced, &[]);
    done(
        k.agent_run(&s, &write(PAGE, "new.js", "x", ""), NOW)
            .unwrap(),
    );
}

#[test]
fn a_header_that_cannot_be_read_counts_as_a_lock() {
    let (t, k) = open();
    smart(&t, &k);
    let s = session();
    let text = fs::read_to_string(t.vault.root().join(PAGE)).unwrap();
    // The lock written where the parser stumbles before it.
    let broken = text.replacen("---\n", "---\nbroken: [unclosed\nlocked: true\n", 1);
    fs::write(t.vault.root().join(PAGE), &broken).unwrap();
    for op in [write(PAGE, "new.js", "x", ""), delete(PAGE, "app.js")] {
        let refused = k.agent_run(&s, &op, NOW).unwrap_err();
        assert!(refused.to_string().contains("locked"), "{refused}");
    }
    assert_eq!(snapshot(&t, DIR), expected());
    // `locked: yes` is a lock too.
    let yes = text.replacen("---\n", "---\nlocked: yes\n", 1);
    fs::write(t.vault.root().join(PAGE), yes).unwrap();
    let op = write(PAGE, "new.js", "x", "");
    assert!(k.agent_run(&s, &op, NOW).is_err());
}

#[test]
fn a_page_inside_a_locked_pages_folder_cannot_be_a_way_in() {
    let (t, k) = open();
    smart(&t, &k);
    k.set_meta(&Actor::Human, PAGE, "locked", Some("true"), NOW)
        .unwrap();
    // A page made by hand inside the folder, not locked, a smart page.
    fs::write(
        t.vault.root().join(DIR).join("inner.md"),
        "---\ntitle: Inner\nlayout: smart\n---\nBody.\n",
    )
    .unwrap();
    let s = session();
    let inner = format!("{DIR}/inner.md");
    for op in [
        write(&inner, "new.js", "x", ""),
        write(&inner, "../app.js", "x", ""),
        write(&inner, "inner.smart/x.js", "x", ""),
        delete(&inner, "x.js"),
    ] {
        assert!(k.agent_run(&s, &op, NOW).is_err(), "{op:?}");
    }
    assert!(!there(&t, &format!("{DIR}/inner.smart")));
    assert_eq!(
        fs::read(t.vault.root().join(DIR).join("app.js")).unwrap(),
        expected()["app.js"]
    );
}
