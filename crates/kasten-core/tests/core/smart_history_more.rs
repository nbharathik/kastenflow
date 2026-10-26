//! Who made a smart page, whatever was done to its path since, and a restore
//! of the code from a history that holds hostile files: every check runs
//! before a byte is written, so a refused version leaves the folder as it was.

use crate::common::NOW;
use crate::smart_support::{DIR, PAGE, all_files, expected, open, smart, snapshot};

use git2::{FileMode, Oid, Repository, Signature};
use kasten_core::history::Actor;
use kasten_core::{Error, Kasten, Kind, NewNote};

fn agent() -> Actor {
    Actor::Approved {
        client: "claude-code".into(),
        session: "s-1".into(),
        by: "Bharathi".into(),
    }
}

fn new_page(k: &Kasten, actor: &Actor, title: &str) -> String {
    k.create(
        actor,
        &NewNote {
            kind: Kind::Page,
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
fn a_person_renaming_an_agents_page_does_not_change_who_made_it() {
    let (_t, k) = open();
    let made = new_page(&k, &agent(), "Made by an agent");
    let renamed = k
        .rename(&Actor::Human, &made, "Called something else", NOW)
        .unwrap()
        .note
        .meta
        .path;
    assert_ne!(renamed, made, "the file moved with its title");
    let first = k.first_commit(&renamed).unwrap().unwrap();
    assert!(
        first.agent,
        "the rename is not the making: {}",
        first.summary
    );
    assert_eq!(first.author, "agent:claude-code");
    // And a page a person made stays a person's, whoever renames it.
    let mine = new_page(&k, &Actor::Human, "Made by a person");
    let moved = k
        .rename(&agent(), &mine, "Agent renamed it", NOW)
        .unwrap()
        .note
        .meta
        .path;
    assert_ne!(moved, mine);
    assert!(!k.first_commit(&moved).unwrap().unwrap().agent);
}

#[test]
fn a_page_made_at_a_path_a_person_once_used_is_made_by_who_made_it_now() {
    let (_t, k) = open();
    let first = new_page(&k, &Actor::Human, "Reused name");
    k.trash(&Actor::Human, &first, NOW).unwrap();
    let again = new_page(&k, &agent(), "Reused name");
    assert_eq!(again, first, "the same path again");
    let made = k.first_commit(&again).unwrap().unwrap();
    assert!(made.agent, "not the person's old page: {}", made.summary);
}

#[test]
fn a_copy_a_person_makes_of_an_agents_page_is_still_the_agents_making() {
    let (_t, k) = open();
    let theirs = new_page(&k, &agent(), "Agent page");
    let mine = new_page(&k, &Actor::Human, "Person page");
    let copy = |actor: &Actor, path: &str| k.duplicate(actor, path, NOW).unwrap().meta.path;
    let person_copy_of_agent = copy(&Actor::Human, &theirs);
    assert!(
        k.first_commit(&person_copy_of_agent)
            .unwrap()
            .unwrap()
            .agent
    );
    // A copy of that copy, and a copy after the agent's page moved, too.
    let again = copy(&Actor::Human, &person_copy_of_agent);
    assert!(k.first_commit(&again).unwrap().unwrap().agent);
    k.rename(&Actor::Human, &theirs, "Agent page moved", NOW)
        .unwrap();
    let late = copy(&Actor::Human, &person_copy_of_agent);
    assert!(k.first_commit(&late).unwrap().unwrap().agent);
    // A person's page copied by a person, or by an agent, is whose copy it is.
    let person_copy = copy(&Actor::Human, &mine);
    assert!(!k.first_commit(&person_copy).unwrap().unwrap().agent);
    let agent_copy = copy(&agent(), &mine);
    assert!(k.first_commit(&agent_copy).unwrap().unwrap().agent);
}

/// A commit (not on any branch) that is HEAD's tree with the folder of `PAGE`
/// replaced by `files` (flat names, each with its file mode).
fn hostile_version(root: &std::path::Path, files: &[(&str, Vec<u8>, FileMode)]) -> String {
    let repo = Repository::open(root).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    let mut folder = repo.treebuilder(None).unwrap();
    for (name, bytes, mode) in files {
        let blob: Oid = repo.blob(bytes).unwrap();
        folder.insert(name, blob, (*mode).into()).unwrap();
    }
    let folder = folder.write().unwrap();
    let tree = head.tree().unwrap();
    let library = repo
        .find_tree(tree.get_name("library").unwrap().id())
        .unwrap();
    let mut library = repo.treebuilder(Some(&library)).unwrap();
    library
        .insert(
            DIR.strip_prefix("library/").unwrap(),
            folder,
            FileMode::Tree.into(),
        )
        .unwrap();
    let library = library.write().unwrap();
    let mut top = repo.treebuilder(Some(&tree)).unwrap();
    top.insert("library", library, FileMode::Tree.into())
        .unwrap();
    let top = repo.find_tree(top.write().unwrap()).unwrap();
    let sig = Signature::now("someone", "someone@example.com").unwrap();
    repo.commit(None, &sig, &sig, "hostile", &top, &[&head])
        .unwrap()
        .to_string()
}

fn index() -> (&'static str, Vec<u8>, FileMode) {
    ("index.html", b"<p>Old</p>".to_vec(), FileMode::Blob)
}

/// Restoring `rev` is refused, in words, and nothing in the vault changed.
fn refused(files: &[(&str, Vec<u8>, FileMode)]) -> String {
    let (t, k) = open();
    smart(&t, &k);
    k.commit_edits().unwrap();
    let rev = hostile_version(t.vault.root(), files);
    let before = all_files(&t);
    let head = k.log(None, 1).unwrap()[0].id.clone();
    let err = k
        .smart_restore_version(&Actor::Human, PAGE, &rev, NOW)
        .expect_err("the hostile version must be refused");
    assert!(matches!(err, Error::Invalid(_)), "{err:?}");
    assert_eq!(all_files(&t), before, "no file written, none taken out");
    assert_eq!(snapshot(&t, DIR), expected());
    assert_eq!(k.log(None, 1).unwrap()[0].id, head, "no commit");
    err.to_string()
}

#[test]
fn names_that_differ_only_in_case_are_refused_before_anything_is_written() {
    let why = refused(&[
        index(),
        ("A.js", b"1".to_vec(), FileMode::Blob),
        ("a.js", b"2".to_vec(), FileMode::Blob),
    ]);
    assert!(why.contains("case"), "{why}");
}

#[test]
fn more_than_the_most_files_is_refused_before_anything_is_written() {
    let mut files = vec![index()];
    for n in 0..520 {
        files.push((
            Box::leak(format!("f{n:03}.js").into_boxed_str()) as &str,
            b"x".to_vec(),
            FileMode::Blob,
        ));
    }
    let why = refused(&files);
    assert!(why.contains("500"), "{why}");
}

#[test]
fn a_version_over_the_folders_size_is_refused_before_anything_is_written() {
    let big = vec![b'a'; 1_900_000];
    let mut files = vec![index()];
    for n in 0..6 {
        files.push((
            Box::leak(format!("big{n}.js").into_boxed_str()) as &str,
            big.clone(),
            FileMode::Blob,
        ));
    }
    let why = refused(&files);
    assert!(why.contains("MB"), "{why}");
    // One file over the size of a file.
    let why = refused(&[index(), ("huge.js", vec![b'a'; 2_200_000], FileMode::Blob)]);
    assert!(why.contains("MB"), "{why}");
}

#[test]
fn hidden_programs_and_odd_names_in_a_version_are_left_out_not_written() {
    let (t, k) = open();
    smart(&t, &k);
    k.commit_edits().unwrap();
    let rev = hostile_version(
        t.vault.root(),
        &[
            index(),
            (".hidden.js", b"h".to_vec(), FileMode::Blob),
            ("evil.exe", b"MZ".to_vec(), FileMode::Blob),
            ("bad name.js ", b"x".to_vec(), FileMode::Blob),
            ("CON.js", b"x".to_vec(), FileMode::Blob),
            // A link in the version comes back as the text of its target,
            // never as a link.
            ("link.js", b"../../outside.txt".to_vec(), FileMode::Link),
        ],
    );
    let restored = k
        .smart_restore_version(&Actor::Human, PAGE, &rev, NOW)
        .unwrap();
    let now = snapshot(&t, DIR);
    assert_eq!(now["index.html"], b"<p>Old</p>");
    for left_out in [".hidden.js", "evil.exe", "bad name.js ", "CON.js"] {
        assert!(!now.contains_key(left_out), "{left_out}");
    }
    assert!(
        !t.vault.root().join(DIR).join("link.js").is_symlink(),
        "never a link"
    );
    assert!(restored.commit.is_some());
    // The folder's other files went to the trash, not away.
    assert!(!restored.trashed.is_empty());
}
