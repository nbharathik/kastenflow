//! Saved collections (`views/<slug>.yaml`): made, edited line by line so
//! unknown keys and comments stay as written, renamed, trashed and put back,
//! each as one commit that Undo takes back; refusals write nothing.

use std::fs;

use serde_json::{Map, Value, json};

use crate::common;

use common::{NOW, dev_vault};
use kasten_core::history::Actor;
use kasten_core::{Error, Kasten};

const HAND_MADE: &str = "# Written by hand, kept as it is\nformat: 1\nname: Reading queue\nicon: book\nquery: \"#capture project:photo-organiser\"   # the project's captures\nwhen: {updated: last-30-days}\nfilter:\n  - {key: reading, op: is, value: Unread}\nsort:\n  - {key: captured, dir: desc}\ndisplay: {type: table, columns: [title, site, captured, reading], limit: 500}\nowner: bharathi   # a key this version does not know\nextra:\n  - a\n  - b\n";

fn open_with(files: &[(&str, &str)]) -> (common::TempVault, Kasten) {
    let t = dev_vault();
    for (path, text) in files {
        let file = t.vault.root().join(path);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, text).unwrap();
    }
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn open() -> (common::TempVault, Kasten) {
    open_with(&[])
}

fn map(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

fn text_of(t: &common::TempVault, path: &str) -> String {
    fs::read_to_string(t.vault.root().join(path)).unwrap()
}

fn commits(k: &Kasten) -> usize {
    k.log(None, 1000).unwrap().len()
}

fn changed(k: &Kasten) -> Vec<String> {
    let mut files: Vec<String> = k
        .commit_changes(&k.log(None, 1).unwrap()[0].id)
        .unwrap()
        .into_iter()
        .map(|c| c.path)
        .collect();
    files.sort();
    files
}

fn summary(k: &Kasten) -> String {
    k.log(None, 1).unwrap()[0].summary.clone()
}

fn invalid(result: Result<impl std::fmt::Debug, Error>) -> String {
    match result {
        Err(Error::Invalid(why)) => why,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn makes_a_collection_in_one_commit_and_lists_it() {
    let (t, k) = open();
    assert!(k.collections().unwrap().is_empty());
    let before = commits(&k);
    let revised = k.revision().collections;
    let made = k
        .create_collection(
            &Actor::Human,
            "Reading queue",
            &map(json!({
                "icon": "book",
                "query": "#capture",
                "when": {"updated": "last-30-days"},
                "filter": [{"key": "reading", "op": "is_not", "value": "Finished"}],
                "sort": [{"key": "captured", "dir": "desc"}],
                "display": {"type": "table", "columns": ["title", "site"], "limit": 500},
            })),
            NOW,
        )
        .unwrap();
    assert_eq!(made.path, "views/reading-queue.yaml");
    assert_eq!(
        (made.name.as_str(), made.problem.clone()),
        ("Reading queue", None)
    );
    assert_eq!(made.query, "#capture");
    assert_eq!(
        made.hash,
        kasten_core::content_hash(&text_of(&t, &made.path))
    );
    assert_eq!(
        text_of(&t, "views/reading-queue.yaml"),
        "format: 1\nname: Reading queue\nicon: book\nquery: \"#capture\"\nwhen: {updated: last-30-days}\nfilter:\n  - {key: reading, op: is_not, value: Finished}\nsort:\n  - {key: captured, dir: desc}\ndisplay: {type: table, columns: [title, site], limit: 500}\n"
    );
    assert_eq!(commits(&k), before + 1);
    assert_eq!(summary(&k), "collection: create Reading queue");
    assert_eq!(changed(&k), ["views/reading-queue.yaml"]);
    assert_eq!(k.revision().collections, revised + 1);
    assert_eq!(k.collections().unwrap(), std::slice::from_ref(&made));
    assert_eq!(k.collection("views/reading-queue.yaml").unwrap(), made);

    // Undo takes it back, folder and all.
    let commit = k.log(None, 1).unwrap()[0].id.clone();
    k.undo_commit(&commit, NOW).unwrap();
    assert!(!t.vault.root().join("views/reading-queue.yaml").exists());
    assert!(k.collections().unwrap().is_empty());
}

#[test]
fn a_name_that_is_taken_is_numbered_and_the_list_is_by_name() {
    let (_t, k) = open();
    let make = |name: &str| {
        k.create_collection(&Actor::Human, name, &Map::new(), NOW)
            .unwrap()
            .path
    };
    assert_eq!(make("Reading queue"), "views/reading-queue.yaml");
    assert_eq!(make("Reading queue"), "views/reading-queue-2.yaml");
    assert_eq!(make("reading QUEUE"), "views/reading-queue-3.yaml");
    assert_eq!(make("Archive"), "views/archive.yaml");
    assert_eq!(make("!!!"), "views/untitled.yaml");
    let names: Vec<String> = k
        .collections()
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
    assert_eq!(
        names,
        [
            "!!!",
            "Archive",
            "Reading queue",
            "Reading queue",
            "reading QUEUE"
        ]
    );
}

#[test]
fn a_bad_name_or_value_is_refused_and_writes_nothing() {
    let (t, k) = open();
    let before = commits(&k);
    for (name, edits) in [
        ("", json!({})),
        ("   ", json!({})),
        ("two\nlines", json!({})),
        ("Fine", json!({"when": {"updated": "someday"}})),
        ("Fine", json!({"when": {"changed": "today"}})),
        ("Fine", json!({"query": "x".repeat(2001)})),
        (
            "Fine",
            json!({"filter": [{"key": "a", "op": "like", "value": "b"}]}),
        ),
        (
            "Fine",
            json!({"filter": [{"key": "a", "op": "before", "value": "soon"}]}),
        ),
        ("Fine", json!({"sort": [{"key": "a", "dir": "up"}]})),
        ("Fine", json!({"display": {"type": "pie"}})),
        ("Fine", json!({"name": "Other"})),
        ("Fine", json!({"format": 2})),
    ] {
        let result = k.create_collection(&Actor::Human, name, &map(edits.clone()), NOW);
        assert!(matches!(result, Err(Error::Invalid(_))), "{name:?} {edits}");
    }
    assert_eq!(commits(&k), before);
    assert!(!t.vault.root().join("views").exists());
    // A query of exactly the longest length is fine.
    k.create_collection(
        &Actor::Human,
        "Long",
        &map(json!({"query": "x".repeat(2000)})),
        NOW,
    )
    .unwrap();
}

#[test]
fn an_edit_keeps_unknown_keys_and_comments_byte_for_byte() {
    let (t, k) = open_with(&[("views/reading-queue.yaml", HAND_MADE)]);
    let listed = k.collections().unwrap();
    assert_eq!(listed.len(), 1);
    let before = commits(&k);
    let updated = k
        .update_collection(
            &Actor::Human,
            "views/reading-queue.yaml",
            &map(json!({
                "query": "tag:paper",
                "icon": null,
                "filter": [{"key": "reading", "op": "is_not", "value": "Finished"}],
            })),
            &listed[0].hash,
            NOW,
        )
        .unwrap();
    let want = HAND_MADE
        .replace(
            "query: \"#capture project:photo-organiser\"   # the project's captures\n",
            "query: tag:paper   # the project's captures\n",
        )
        .replace("icon: book\n", "")
        .replace(
            "  - {key: reading, op: is, value: Unread}",
            "  - {key: reading, op: is_not, value: Finished}",
        );
    assert_eq!(text_of(&t, "views/reading-queue.yaml"), want);
    assert_eq!(updated.query, "tag:paper");
    assert_eq!(updated.icon, None);
    assert_eq!(updated.hash, kasten_core::content_hash(&want));
    assert_eq!(commits(&k), before + 1);
    assert_eq!(summary(&k), "collection: edit Reading queue");
    assert_eq!(changed(&k), ["views/reading-queue.yaml"]);
    for kept in [
        "# Written by hand, kept as it is\n",
        "owner: bharathi   # a key this version does not know\n",
        "extra:\n  - a\n  - b\n",
        "display: {type: table, columns: [title, site, captured, reading], limit: 500}\n",
    ] {
        assert!(want.contains(kept), "{kept}");
    }

    // Undo puts the file back exactly as it was.
    let commit = k.log(None, 1).unwrap()[0].id.clone();
    k.undo_commit(&commit, NOW).unwrap();
    assert_eq!(text_of(&t, "views/reading-queue.yaml"), HAND_MADE);
}

#[test]
fn a_stale_hash_is_refused_and_the_file_is_left_alone() {
    let (t, k) = open_with(&[("views/reading-queue.yaml", HAND_MADE)]);
    let first = k.collections().unwrap().remove(0);
    let edit = |query: &str, hash: &str| {
        k.update_collection(
            &Actor::Human,
            &first.path,
            &map(json!({"query": query})),
            hash,
            NOW,
        )
    };
    edit("one", &first.hash).unwrap();
    let before = commits(&k);
    let text = text_of(&t, &first.path);
    let why = invalid(edit("two", &first.hash));
    assert!(why.contains("changed since"), "{why}");
    let why = invalid(edit("two", ""));
    assert!(why.contains("changed since"), "{why}");
    assert_eq!(text_of(&t, &first.path), text);
    assert_eq!(commits(&k), before);

    // A hand edit made outside the app is not overwritten either.
    let hash = k.collection(&first.path).unwrap().hash;
    fs::write(
        t.vault.root().join(&first.path),
        format!("{text}# added by hand\n"),
    )
    .unwrap();
    assert!(invalid(edit("three", &hash)).contains("changed since"));
    assert!(text_of(&t, &first.path).ends_with("# added by hand\n"));
}

#[test]
fn saying_what_is_already_so_commits_nothing() {
    let (t, k) = open_with(&[("views/reading-queue.yaml", HAND_MADE)]);
    let c = k.collections().unwrap().remove(0);
    let before = commits(&k);
    let again = k
        .update_collection(
            &Actor::Human,
            &c.path,
            &map(json!({"when": {"updated": "last-30-days"}, "icon": "book"})),
            &c.hash,
            NOW,
        )
        .unwrap();
    assert_eq!(again, c);
    assert_eq!(text_of(&t, &c.path), HAND_MADE);
    assert_eq!(commits(&k), before);
}

#[test]
fn only_files_in_views_can_be_changed_renamed_trashed_or_restored() {
    let (t, k) = open_with(&[
        ("views/ok.yaml", "name: Ok\n"),
        ("views/sub/deep.yaml", "name: Deep\n"),
    ]);
    let before = commits(&k);
    let task = text_of(&t, "tags/task.yaml");
    let page = text_of(&t, "library/welcome-to-kasten.md");
    for path in [
        "tags/task.yaml",
        "library/welcome-to-kasten.md",
        "views/sub/deep.yaml",
        "views/ok.yml",
        "Views/ok.yaml",
        "views/../tags/task.yaml",
        "../outside.yaml",
        "/views/ok.yaml",
        "views\\ok.yaml",
        ".kasten/config.yaml",
        "views/.hidden.yaml",
        "",
    ] {
        let hash = "0000000000000000";
        assert!(
            k.update_collection(&Actor::Human, path, &map(json!({"query": "x"})), hash, NOW)
                .is_err(),
            "update {path:?}"
        );
        assert!(
            k.rename_collection(&Actor::Human, path, "New name", hash, NOW)
                .is_err(),
            "rename {path:?}"
        );
        assert!(
            k.trash_collection(&Actor::Human, path, NOW).is_err(),
            "trash {path:?}"
        );
        assert!(
            k.restore_collection(&Actor::Human, path).is_err(),
            "restore {path:?}"
        );
        assert!(k.collection(path).is_err(), "read {path:?}");
    }
    assert_eq!(commits(&k), before);
    assert_eq!(text_of(&t, "tags/task.yaml"), task);
    assert_eq!(text_of(&t, "library/welcome-to-kasten.md"), page);
    assert!(t.vault.root().join("views/sub/deep.yaml").exists());
    // The nested file is not a collection, so it is not listed.
    let listed: Vec<String> = k
        .collections()
        .unwrap()
        .into_iter()
        .map(|c| c.path)
        .collect();
    assert_eq!(listed, ["views/ok.yaml"]);
    // The generic trash never takes a tag schema or a collection by its ending.
    assert!(k.trash(&Actor::Human, "tags/task.yaml", NOW).is_err());
    assert!(k.trash(&Actor::Human, "views/ok.yaml", NOW).is_err());
    assert!(t.vault.root().join("views/ok.yaml").exists());
}

#[test]
fn a_file_from_a_newer_version_is_listed_but_not_writable() {
    let newer = "format: 2\nname: From the future\nquery: tag:x\nlayers: {a: 1}\n";
    let (t, k) = open_with(&[("views/future.yaml", newer)]);
    let listed = k.collections().unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (listed[0].name.as_str(), listed[0].format),
        ("From the future", 2)
    );
    assert!(listed[0].read_only);
    assert!(
        listed[0]
            .problem
            .as_deref()
            .unwrap()
            .contains("newer version")
    );
    let before = commits(&k);
    let why = invalid(k.update_collection(
        &Actor::Human,
        "views/future.yaml",
        &map(json!({"query": "tag:y"})),
        &listed[0].hash,
        NOW,
    ));
    assert!(why.contains("newer version"), "{why}");
    let why = invalid(k.rename_collection(
        &Actor::Human,
        "views/future.yaml",
        "Renamed",
        &listed[0].hash,
        NOW,
    ));
    assert!(why.contains("newer version"), "{why}");
    assert_eq!(text_of(&t, "views/future.yaml"), newer);
    assert_eq!(commits(&k), before);
}

#[test]
fn an_unreadable_file_is_listed_with_the_reason_and_can_still_be_trashed() {
    let (t, k) = open_with(&[
        ("views/broken.yaml", "{ not: [valid"),
        ("views/fine.yaml", "name: Fine\n"),
    ]);
    fs::write(
        t.vault.root().join("views/binary.yaml"),
        [0xff, 0xfe, 0x00, 0x9f],
    )
    .unwrap();
    let listed = k.collections().unwrap();
    let broken: Vec<(&str, bool)> = listed
        .iter()
        .map(|c| (c.path.as_str(), c.problem.is_some()))
        .collect();
    assert_eq!(
        broken,
        [
            ("views/binary.yaml", true),
            ("views/broken.yaml", true),
            ("views/fine.yaml", false)
        ]
    );
    assert!(listed.iter().all(|c| c.read_only == c.problem.is_some()));
    let trashed = k
        .trash_collection(&Actor::Human, "views/broken.yaml", NOW)
        .unwrap();
    assert!(trashed.starts_with(".trash/") && trashed.ends_with("/views/broken.yaml"));
    assert!(!t.vault.root().join("views/broken.yaml").exists());
}

#[test]
fn renaming_moves_the_file_and_rewrites_only_the_name() {
    let (t, k) = open_with(&[("views/reading-queue.yaml", HAND_MADE)]);
    let c = k.collections().unwrap().remove(0);
    let before = commits(&k);
    let renamed = k
        .rename_collection(&Actor::Human, &c.path, "Papers to read", &c.hash, NOW)
        .unwrap();
    assert_eq!(renamed.path, "views/papers-to-read.yaml");
    assert_eq!(renamed.name, "Papers to read");
    assert!(!t.vault.root().join("views/reading-queue.yaml").exists());
    assert_eq!(
        text_of(&t, "views/papers-to-read.yaml"),
        HAND_MADE.replace("name: Reading queue\n", "name: Papers to read\n")
    );
    assert_eq!(commits(&k), before + 1);
    assert_eq!(
        summary(&k),
        "collection: rename Reading queue → Papers to read"
    );
    assert_eq!(
        changed(&k),
        ["views/papers-to-read.yaml", "views/reading-queue.yaml"]
    );

    // A name whose file name is the same changes the name in place.
    let again = k
        .rename_collection(
            &Actor::Human,
            &renamed.path,
            "Papers to READ!",
            &renamed.hash,
            NOW,
        )
        .unwrap();
    assert_eq!(again.path, "views/papers-to-read.yaml");
    assert_eq!(again.name, "Papers to READ!");

    // A taken file name is numbered.
    k.create_collection(&Actor::Human, "Archive", &Map::new(), NOW)
        .unwrap();
    let archived = k
        .rename_collection(&Actor::Human, &again.path, "archive", &again.hash, NOW)
        .unwrap();
    assert_eq!(archived.path, "views/archive-2.yaml");
    assert!(t.vault.root().join("views/archive.yaml").exists());

    // Stale hash, empty name: refused, nothing changes.
    let before = commits(&k);
    let why =
        invalid(k.rename_collection(&Actor::Human, &archived.path, "Other", &again.hash, NOW));
    assert!(why.contains("changed since"), "{why}");
    invalid(k.rename_collection(&Actor::Human, &archived.path, "  ", &archived.hash, NOW));
    assert_eq!(commits(&k), before);

    // Undo moves it back to its old name.
    let commit = k.log(None, 1).unwrap()[0].id.clone();
    let undone = k.undo_commit(&commit, NOW).unwrap();
    assert!(undone.conflict.is_none(), "{:?}", undone.conflict);
    assert!(!t.vault.root().join("views/archive-2.yaml").exists());
    assert_eq!(
        text_of(&t, "views/papers-to-read.yaml"),
        HAND_MADE.replace("name: Reading queue\n", "name: Papers to READ!\n")
    );
}

#[test]
fn trash_and_restore_are_one_commit_each() {
    let (t, k) = open_with(&[("views/reading-queue.yaml", HAND_MADE)]);
    let before = commits(&k);
    let revised = k.revision().collections;
    let trashed = k
        .trash_collection(&Actor::Human, "views/reading-queue.yaml", NOW)
        .unwrap();
    assert!(trashed.starts_with(".trash/"), "{trashed}");
    assert!(trashed.ends_with("/views/reading-queue.yaml"), "{trashed}");
    assert!(!t.vault.root().join("views/reading-queue.yaml").exists());
    assert_eq!(text_of(&t, &trashed), HAND_MADE);
    assert_eq!(commits(&k), before + 1);
    assert_eq!(summary(&k), "trash: collection Reading queue");
    assert_eq!(k.revision().collections, revised + 1);
    assert!(k.collections().unwrap().is_empty());

    // The trash lists it by its name and shows its text.
    let listed: Vec<_> = k
        .list_trash()
        .unwrap()
        .into_iter()
        .filter(|item| item.original == "views/reading-queue.yaml")
        .collect();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].title, "Reading queue");
    assert_eq!(listed[0].trashed, trashed);
    assert_eq!(k.read_trashed(&trashed).unwrap(), HAND_MADE);

    let restored = k.restore_collection(&Actor::Human, &trashed).unwrap();
    assert_eq!(restored.path, "views/reading-queue.yaml");
    assert_eq!(restored.name, "Reading queue");
    assert_eq!(text_of(&t, "views/reading-queue.yaml"), HAND_MADE);
    assert_eq!(commits(&k), before + 2);
    assert_eq!(summary(&k), "restore: collection Reading queue");
    assert_eq!(k.revision().collections, revised + 2);
    assert!(
        k.list_trash()
            .unwrap()
            .iter()
            .all(|item| item.original != "views/reading-queue.yaml")
    );
    assert_eq!(k.collections().unwrap(), [restored]);
}

#[test]
fn restoring_beside_a_new_file_of_the_same_name_takes_a_free_name() {
    let (t, k) = open_with(&[("views/reading-queue.yaml", HAND_MADE)]);
    let trashed = k
        .trash_collection(&Actor::Human, "views/reading-queue.yaml", NOW)
        .unwrap();
    k.create_collection(&Actor::Human, "Reading queue", &Map::new(), NOW)
        .unwrap();
    let restored = k.restore_collection(&Actor::Human, &trashed).unwrap();
    assert_eq!(restored.path, "views/reading-queue-2.yaml");
    assert_eq!(text_of(&t, "views/reading-queue-2.yaml"), HAND_MADE);
    assert_eq!(
        text_of(&t, "views/reading-queue.yaml"),
        "format: 1\nname: Reading queue\n"
    );
}

#[test]
fn undo_takes_back_a_trash() {
    let (t, k) = open_with(&[("views/reading-queue.yaml", HAND_MADE)]);
    k.trash_collection(&Actor::Human, "views/reading-queue.yaml", NOW)
        .unwrap();
    let commit = k.log(None, 1).unwrap()[0].id.clone();
    let undone = k.undo_commit(&commit, NOW).unwrap();
    assert!(undone.conflict.is_none(), "{:?}", undone.conflict);
    assert_eq!(text_of(&t, "views/reading-queue.yaml"), HAND_MADE);
}

#[test]
fn a_person_saves_collections_and_an_agent_does_not() {
    let (t, k) = open_with(&[("views/reading-queue.yaml", HAND_MADE)]);
    let agent = Actor::Agent {
        client: "test".into(),
        session: "S".into(),
    };
    let c = k.collections().unwrap().remove(0);
    let before = commits(&k);
    assert!(
        k.create_collection(&agent, "Mine", &Map::new(), NOW)
            .is_err()
    );
    assert!(
        k.update_collection(&agent, &c.path, &map(json!({"query": "x"})), &c.hash, NOW)
            .is_err()
    );
    assert!(
        k.rename_collection(&agent, &c.path, "Other", &c.hash, NOW)
            .is_err()
    );
    assert!(k.trash_collection(&agent, &c.path, NOW).is_err());
    assert_eq!(commits(&k), before);
    assert_eq!(text_of(&t, &c.path), HAND_MADE);
    // Reading is open to everyone.
    assert_eq!(k.collections().unwrap().len(), 1);
}

#[test]
fn a_collection_is_not_in_the_index_or_the_note_lists() {
    let (_t, k) = open();
    let notes = k.list().unwrap().len();
    k.create_collection(
        &Actor::Human,
        "Reading queue",
        &map(json!({"query": "zettelkasten"})),
        NOW,
    )
    .unwrap();
    assert_eq!(k.list().unwrap().len(), notes);
    assert!(
        k.search("Reading queue", 10)
            .unwrap()
            .iter()
            .all(|h| !h.path.starts_with("views/"))
    );
}

#[test]
fn check_reports_under_and_project_values_that_no_longer_resolve() {
    let (t, k) = open();
    let roadmap = k
        .read("projects/photo-organiser/pages/photo-organiser-roadmap.md")
        .unwrap();
    let id = roadmap.meta.id.clone().expect("the roadmap has an id");
    let make = |name: &str, query: String| {
        k.create_collection(&Actor::Human, name, &map(json!({"query": query})), NOW)
            .unwrap()
            .path
    };
    make("Good under", format!("under:{id} notes"));
    make(
        "Good path",
        "under:projects/photo-organiser/pages/photo-organiser-roadmap".to_owned(),
    );
    make(
        "Good project",
        "project:photo-organiser #capture".to_owned(),
    );
    make("Gone under", "under:01HZZZZZZZZZZZZZZZZZZZZZZZ".to_owned());
    let gone_project = make("Gone project", "project:Nowhere".to_owned());
    make("Odd project", "project:../../etc".to_owned());
    fs::write(t.vault.root().join("views/broken.yaml"), "{ not: [valid").unwrap();
    let problems = k.collection_problems().unwrap();
    let mut got: Vec<(&str, &str)> = problems
        .iter()
        .map(|p| (p.kind.as_str(), p.path.as_deref().unwrap_or("")))
        .collect();
    got.sort_unstable();
    assert_eq!(
        got,
        [
            ("collection", "views/broken.yaml"),
            ("collection-reference", "views/gone-project.yaml"),
            ("collection-reference", "views/gone-under.yaml"),
            ("collection-reference", "views/odd-project.yaml"),
        ]
    );
    assert!(
        problems
            .iter()
            .any(|p| p.detail.contains("Nowhere") || p.detail.contains("nowhere"))
    );
    assert_eq!(gone_project, "views/gone-project.yaml");
    // The page goes to the trash: the collection that was under it now reports.
    k.trash(&Actor::Human, &roadmap.meta.path, NOW).unwrap();
    let after: Vec<String> = k
        .collection_problems()
        .unwrap()
        .into_iter()
        .filter(|p| p.kind == "collection-reference")
        .filter_map(|p| p.path)
        .collect();
    assert!(
        after.contains(&"views/good-under.yaml".to_owned()),
        "{after:?}"
    );
}
