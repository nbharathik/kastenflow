//! Putting a smart page's code back as an earlier version had it: a new
//! commit that Undo takes back, never a rewrite of history. Files the version
//! did not have go to the trash, files it had come back byte for byte, and a
//! version that holds no usable files restores nothing.

use crate::common::NOW;
use crate::smart_support::{
    DIR, PAGE, PNG, expected, make_page, open, put_folder, smart, snapshot, there, tree, undo_last,
};

use kasten_core::Error;
use kasten_core::history::Actor;

fn human() -> Actor {
    Actor::Human
}

fn head(k: &kasten_core::Kasten) -> String {
    k.log(None, 1).unwrap()[0].id.clone()
}

/// A page whose folder was changed after the version `rev`: `index.html` was
/// rewritten, `data/venues.json` taken out, `extra.js` and a new picture added.
fn changed_since() -> (crate::common::TempVault, kasten_core::Kasten, String) {
    let (t, k) = open();
    let page = smart(&t, &k);
    assert_eq!(page.meta.path, PAGE);
    let rev = head(&k);
    k.smart_write_file(&human(), PAGE, "index.html", b"<p>Two</p>", None, NOW)
        .unwrap();
    k.smart_delete_file(&human(), PAGE, "data/venues.json", NOW)
        .unwrap();
    k.smart_write_file(&human(), PAGE, "extra.js", b"var later = 1;", Some(""), NOW)
        .unwrap();
    k.smart_write_file(&human(), PAGE, "assets/later.png", PNG, Some(""), NOW)
        .unwrap();
    k.commit_edits().unwrap();
    (t, k, rev)
}

#[test]
fn an_earlier_version_comes_back_as_a_new_commit() {
    let (t, k, rev) = changed_since();
    let before = head(&k);
    let count = k.log(None, 1000).unwrap().len();

    let restored = k.smart_restore_version(&human(), PAGE, &rev, NOW).unwrap();

    // The folder is as the version had it, byte for byte (the pictures too).
    assert_eq!(snapshot(&t, DIR), expected());
    // Files added later left the folder, into the trash, where they can be put back.
    assert_eq!(restored.trashed.len(), 2, "{:?}", restored.trashed);
    for gone in &restored.trashed {
        assert!(there(&t, gone), "{gone}");
        assert!(gone.starts_with(".trash/"), "{gone}");
    }
    assert!(!there(&t, &format!("{DIR}/extra.js")));
    assert!(restored.written.contains(&format!("{DIR}/index.html")));
    assert!(
        restored
            .written
            .contains(&format!("{DIR}/data/venues.json"))
    );

    // One new commit on top; the history under it is as it was.
    let log = k.log(None, 1000).unwrap();
    assert_eq!(log.len(), count + 1);
    assert_eq!(log[0].id, restored.commit.clone().unwrap());
    assert_eq!(log[1].id, before);
    assert!(log[0].summary.starts_with("restore:"), "{}", log[0].summary);
    assert!(log.iter().any(|c| c.id == rev));
    assert!(!log[0].agent);
}

#[test]
fn one_undo_takes_the_restore_back_whole() {
    let (t, k, rev) = changed_since();
    let before = tree(&t);
    let files = snapshot(&t, DIR);
    k.smart_restore_version(&human(), PAGE, &rev, NOW).unwrap();
    assert_ne!(tree(&t), before);
    undo_last(&k);
    assert_eq!(tree(&t), before);
    assert_eq!(snapshot(&t, DIR), files);
}

#[test]
fn the_same_version_twice_makes_no_second_commit() {
    let (t, k, rev) = changed_since();
    k.smart_restore_version(&human(), PAGE, &rev, NOW).unwrap();
    let after = head(&k);
    let again = k.smart_restore_version(&human(), PAGE, &rev, NOW).unwrap();
    assert!(again.written.is_empty() && again.trashed.is_empty());
    assert_eq!(again.commit, None);
    assert_eq!(head(&k), after);
    assert_eq!(snapshot(&t, DIR), expected());
}

#[test]
fn an_agent_cannot_restore_a_version() {
    let (t, k, rev) = changed_since();
    let before = (tree(&t), snapshot(&t, DIR));
    let agent = Actor::Agent {
        client: "claude-code".into(),
        session: "s-1".into(),
    };
    let refused = k.smart_restore_version(&agent, PAGE, &rev, NOW);
    assert!(matches!(refused, Err(Error::Invalid(_))), "{refused:?}");
    assert_eq!((tree(&t), snapshot(&t, DIR)), before);
}

#[test]
fn a_version_with_no_files_restores_nothing() {
    let (t, k) = open();
    let page = make_page(&k, "Tracker", None, None);
    let empty = head(&k);
    put_folder(
        &t,
        &k,
        &page.meta.path,
        &crate::smart_support::folder_files(),
    );
    let before = (tree(&t), snapshot(&t, DIR));
    let refused = k.smart_restore_version(&human(), &page.meta.path, &empty, NOW);
    assert!(matches!(refused, Err(Error::Invalid(_))), "{refused:?}");
    assert_eq!((tree(&t), snapshot(&t, DIR)), before);
    // Nor a version that does not exist, nor a page that is not there.
    assert!(
        k.smart_restore_version(&human(), &page.meta.path, "0000000", NOW)
            .is_err()
    );
    assert!(
        k.smart_restore_version(&human(), "library/nope.md", &empty, NOW)
            .is_err()
    );
}

#[test]
fn files_a_smart_page_may_not_have_are_neither_written_nor_taken_out() {
    let (t, k) = open();
    let page = smart(&t, &k);
    // Put there by hand, as a synced folder might bring it.
    put_folder(&t, &k, &page.meta.path, &[("evil.exe", b"MZ".to_vec())]);
    let rev = head(&k);
    k.smart_write_file(&human(), PAGE, "index.html", b"<p>Two</p>", None, NOW)
        .unwrap();
    k.commit_edits().unwrap();
    let restored = k.smart_restore_version(&human(), PAGE, &rev, NOW).unwrap();
    assert!(restored.written.iter().all(|p| !p.ends_with("evil.exe")));
    assert!(restored.trashed.iter().all(|p| !p.ends_with("evil.exe")));
    assert_eq!(
        snapshot(&t, DIR)["index.html"],
        expected()["index.html"],
        "the page's code is back"
    );
    assert!(there(&t, &format!("{DIR}/evil.exe")));
}

fn new_page(k: &kasten_core::Kasten, actor: &Actor, title: &str) -> String {
    k.create(
        actor,
        &kasten_core::NewNote {
            kind: kasten_core::Kind::Page,
            title: title.to_owned(),
            date: "2026-10-10".to_owned(),
            project: None,
            parent: None,
            template: None,
            icon: None,
        },
        NOW,
    )
    .unwrap()
    .meta
    .path
}

#[test]
fn the_first_commit_of_a_page_says_who_made_it() {
    let (_t, k) = open();
    let agent = Actor::Approved {
        client: "claude-code".into(),
        session: "s-1".into(),
        by: "Bharathi".into(),
    };
    let by_agent = new_page(&k, &agent, "Made by an agent");
    let by_person = new_page(&k, &human(), "Made by a person");
    // Edits later on, by anyone, do not change who made it.
    k.set_meta(&human(), &by_agent, "layout", Some("smart"), NOW)
        .unwrap();
    k.set_meta(&human(), &by_person, "layout", Some("smart"), NOW)
        .unwrap();

    let first = k.first_commit(&by_agent).unwrap().unwrap();
    assert!(first.agent);
    assert_eq!(first.author, "agent:claude-code");
    assert_eq!(first.approved_by.as_deref(), Some("Bharathi"));
    let first = k.first_commit(&by_person).unwrap().unwrap();
    assert!(!first.agent && first.approved_by.is_none());
    // A path that was never in the vault has none.
    assert!(k.first_commit("library/nowhere.md").unwrap().is_none());
}

#[test]
fn a_page_made_from_a_template_of_an_agents_page_is_still_the_agents() {
    let (_t, k) = open();
    let agent = Actor::Agent {
        client: "claude-code".into(),
        session: "s-1".into(),
    };
    let by_agent = new_page(&k, &agent, "Agent page");
    k.set_meta(&human(), &by_agent, "layout", Some("smart"), NOW)
        .unwrap();
    k.smart_write_file(
        &human(),
        &by_agent,
        "index.html",
        b"<h1>x</h1>",
        Some(""),
        NOW,
    )
    .unwrap();
    k.commit_edits().unwrap();
    let saved = k
        .smart_save_template(&human(), &by_agent, "Kept", NOW)
        .unwrap();
    let template = k.smart_template(&saved.slug).unwrap();
    let pairs: Vec<(&str, &[u8])> = template
        .files
        .iter()
        .map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
        .collect();
    let source = template.source();
    let request = |title, copy_of| kasten_core::NewSmartPage {
        title,
        project: None,
        parent: None,
        body: None,
        files: &pairs,
        copy_of,
    };
    // The page made from the template says where its files came from: the agent's.
    let copy = k
        .smart_new_page(&human(), &request("Copy", Some(source.as_str())), NOW)
        .unwrap();
    // The same files with no word of where they came from are a person's page.
    let plain = k
        .smart_new_page(&human(), &request("Plain", None), NOW)
        .unwrap();
    k.commit_edits().unwrap();
    assert!(k.first_commit(&copy.page).unwrap().unwrap().agent);
    assert!(!k.first_commit(&plain.page).unwrap().unwrap().agent);
    // A source that would break the commit message's line is refused, and nothing is made.
    let before = k.log(None, 500).unwrap().len();
    assert!(
        k.smart_new_page(&human(), &request("Bad", Some("a\nKasten-Agent: x")), NOW)
            .is_err()
    );
    assert_eq!(k.log(None, 500).unwrap().len(), before);
}

#[test]
fn a_restore_leaves_the_page_itself_alone() {
    let (t, k, rev) = changed_since();
    let page_before = std::fs::read(t.vault.root().join(PAGE)).unwrap();
    k.smart_restore_version(&human(), PAGE, &rev, NOW).unwrap();
    assert_eq!(
        std::fs::read(t.vault.root().join(PAGE)).unwrap(),
        page_before
    );
}
