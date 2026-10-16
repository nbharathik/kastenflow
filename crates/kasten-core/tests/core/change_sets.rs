//! Tests for staged agent changes that are inspected, applied or discarded as a set.
//! Staging: nothing reaches the vault, later steps see earlier ones, and what is
//! staged is what the real op writes. (The rules staging keeps are in `change_sets_rules`.)

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use kasten_core::agent::{AgentOp, ChangeSet, Session};
use kasten_core::{Kasten, Outcome};
use serde_json::{Map, Value, json};

use crate::common::{NOW, TempVault, dev_vault};

pub const WELCOME: &str = "library/welcome-to-kasten.md";
pub const DRAFT: &str = "projects/note-taking-study/pages/report-draft.md";
pub const JOURNAL: &str = "journal/2026/2026-09-23.md";

/// A copy of the dev vault with history and a chat's session.
pub fn open() -> (TempVault, Kasten, Session) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k, Session::start("kasten-chat", NOW))
}

fn walk(dir: &Path, root: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
    for entry in fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        if rel == ".git" || rel == ".kasten/cache" || rel == ".kasten/write.lock" {
            continue;
        }
        if entry.file_type().unwrap().is_dir() {
            walk(&path, root, out);
        } else {
            out.insert(rel, fs::read(&path).unwrap());
        }
    }
}

/// Every file of the vault but git's folder and the cache, with its bytes.
pub fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

/// A text without the lines a run stamps differently (ids and times).
pub fn without_stamps(text: &str) -> String {
    text.lines()
        .filter(|l| {
            !["id:", "created:", "updated:"]
                .iter()
                .any(|k| l.starts_with(k))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn append(path: &str, text: &str) -> AgentOp {
    AgentOp::Append {
        path: path.into(),
        markdown: text.into(),
        heading: None,
    }
}

pub fn replace(path: &str, heading: &str, text: &str) -> AgentOp {
    AgentOp::ReplaceSection {
        path: path.into(),
        heading: heading.into(),
        markdown: text.into(),
    }
}

pub fn create(title: &str, body: &str) -> AgentOp {
    AgentOp::CreateNote {
        note_type: "page".into(),
        title: title.into(),
        body: body.into(),
        project: None,
        tags: vec![],
        props: Map::new(),
        parent: None,
        template: None,
    }
}

/// Stages `op` and returns what the tool is told.
pub fn stage(k: &Kasten, set: &mut ChangeSet, s: &Session, op: &AgentOp) -> Value {
    match k.stage(set, s, op, NOW).unwrap() {
        Outcome::Staged {
            change_set,
            paths,
            result,
        } => {
            assert_eq!(change_set, set.id);
            assert!(
                paths
                    .iter()
                    .all(|p| set.text_of(p).is_some() || p.starts_with("assets/"))
            );
            result
        }
        other => panic!("expected the op to be staged, got {other:?}"),
    }
}

#[test]
fn staging_writes_nothing_to_the_vault() {
    let (t, k, s) = open();
    let before = snapshot(t.vault.root());
    let head = k.log(None, 1).unwrap()[0].id.clone();
    let dirty = k.dirty().unwrap();
    let mut set = k.begin_changes(&s, NOW);
    stage(&k, &mut set, &s, &append(WELCOME, "Added by the chat."));
    stage(
        &k,
        &mut set,
        &s,
        &replace(DRAFT, "3. Method", "A new method."),
    );
    stage(&k, &mut set, &s, &create("Staged page", "Body.\n"));
    stage(
        &k,
        &mut set,
        &s,
        &AgentOp::Tags {
            path: WELCOME.into(),
            add: vec!["staged".into()],
            remove: vec![],
        },
    );
    stage(
        &k,
        &mut set,
        &s,
        &AgentOp::Capture {
            markdown: "Idea: staged capture".into(),
            tags: vec![],
        },
    );
    assert_eq!(snapshot(t.vault.root()), before, "no vault file changed");
    assert_eq!(k.log(None, 1).unwrap()[0].id, head, "nothing was committed");
    assert_eq!(k.dirty().unwrap(), dirty);
    assert!(k.proposals().unwrap().is_empty());
    assert!(!t.vault.exists("library/staged-page.md"));
    assert_eq!((set.files.len(), set.created_files.len()), (2, 2));
    assert_eq!(set.steps.len(), 5);
    // The set is kept in the cache, which is never committed.
    let kept = k.load_changes(&set.id).unwrap();
    assert_eq!(kept, set);
}

#[test]
fn later_steps_see_what_earlier_ones_staged() {
    let (t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    stage(&k, &mut set, &s, &append(WELCOME, "First."));
    stage(&k, &mut set, &s, &append(WELCOME, "Second."));
    let text = set.text_of(WELCOME).unwrap();
    let (first, second) = (text.find("First.").unwrap(), text.find("Second.").unwrap());
    assert!(first < second, "both appends landed, in order");
    // A section made by one step is there for the next to replace.
    stage(&k, &mut set, &s, &append(WELCOME, "## Staged section\n\nA"));
    stage(&k, &mut set, &s, &replace(WELCOME, "Staged section", "B"));
    let text = set.text_of(WELCOME).unwrap();
    assert!(
        text.contains("## Staged section\n\nB\n") && !text.contains("\nA\n"),
        "{text}"
    );
    // Reads go through the set.
    assert_eq!(k.read_in(&set, WELCOME).unwrap().text, text);
    assert!(!k.read(WELCOME).unwrap().text.contains("First."));
    // A note the set makes can be named by its title and changed again.
    let made = stage(&k, &mut set, &s, &create("Plan for Friday", "Start.\n"));
    let path = made["path"].as_str().unwrap().to_owned();
    assert_eq!(k.resolve_staged(&set, "Plan for Friday").unwrap(), path);
    assert_eq!(k.resolve_staged(&set, &path).unwrap(), path);
    assert_eq!(
        k.resolve_staged(&set, "Welcome to KastenFlow").unwrap(),
        WELCOME
    );
    stage(&k, &mut set, &s, &append(&path, "More."));
    assert!(set.text_of(&path).unwrap().contains("Start.\n\nMore."));
    assert_eq!(
        set.created_files.len(),
        1,
        "the new note changed, no file was added"
    );
    assert!(k.read(&path).is_err(), "it is not in the vault");
    assert!(!t.vault.exists(&path));
}

/// The same op through the real path on one copy of the vault and staged on
/// another: the text each leaves for `path`.
fn both(op: &AgentOp, setup: impl Fn(&Kasten)) -> (String, String, String) {
    let (_a, direct, ds) = open();
    let (_b, staging, ss) = open();
    setup(&direct);
    setup(&staging);
    let mut set = staging.begin_changes(&ss, NOW);
    let told = stage(&staging, &mut set, &ss, op);
    let Outcome::Done { result } = direct.agent_run(&ds, op, NOW).unwrap() else {
        panic!("the op should run directly")
    };
    assert_eq!(told["path"], result["path"], "the same path");
    let path = result["path"].as_str().unwrap().to_owned();
    let staged = set.text_of(&path).unwrap().to_owned();
    let written = direct.vault().read(&path).unwrap().text;
    (path, staged, written)
}

fn same(op: &AgentOp) {
    let (path, staged, written) = both(op, |_| {});
    assert_eq!(without_stamps(&staged), without_stamps(&written), "{path}");
}

#[test]
fn staged_edits_to_the_body_are_what_the_ops_write() {
    same(&append(WELCOME, "Added."));
    same(&AgentOp::Append {
        path: WELCOME.into(),
        markdown: "- [ ] one more".into(),
        heading: Some("Try these".into()),
    });
    same(&replace(
        DRAFT,
        "3. Method",
        "Different words.\n\nTwo paragraphs.",
    ));
    same(&AgentOp::JournalAppend {
        date: "2026-09-23".into(),
        markdown: "Evening note.".into(),
        heading: None,
    });
}

#[test]
fn staged_tags_and_properties_are_what_the_ops_write() {
    same(&AgentOp::Tags {
        path: DRAFT.into(),
        add: vec!["Reviewed".into(), "#extra".into()],
        remove: vec!["paper".into()],
    });
    let mut props = Map::new();
    props.insert("status".into(), json!("Submitted"));
    props.insert("venue".into(), json!("CHI"));
    same(&AgentOp::UpdateProps {
        path: DRAFT.into(),
        props,
    });
}

#[test]
fn staged_new_notes_are_what_the_ops_write() {
    same(&create(
        "A brand new page",
        "Some text.\n\n## Part\n\nMore.\n",
    ));
    same(&AgentOp::CreateNote {
        note_type: "card".into(),
        title: "Tagged card".into(),
        body: "Card body".into(),
        project: Some("photo-organiser".into()),
        tags: vec!["idea".into(), "#Later".into()],
        props: Map::new(),
        parent: None,
        template: None,
    });
    same(&AgentOp::Capture {
        markdown: "Idea: bike tour\nA few details.".into(),
        tags: vec!["trip".into()],
    });
}

#[test]
fn staged_notes_from_a_template_or_under_a_parent_are_what_the_ops_write() {
    same(&AgentOp::CreateNote {
        note_type: "page".into(),
        title: "From a template".into(),
        body: String::new(),
        project: None,
        tags: vec!["extra".into()],
        props: Map::new(),
        parent: None,
        template: Some("meeting".into()),
    });
    same(&AgentOp::CreateNote {
        note_type: "page".into(),
        title: "Sub page".into(),
        body: "Under another.".into(),
        project: None,
        tags: vec![],
        props: Map::new(),
        parent: Some(DRAFT.into()),
        template: None,
    });
}

#[test]
fn a_parent_without_an_id_is_given_one_by_the_set() {
    let (t, k, s) = open();
    fs::write(
        t.vault.root().join("library/no-id.md"),
        "---\ntitle: No id\n---\nA page that nothing can point at yet.\n",
    )
    .unwrap();
    k.reindex().unwrap();
    let mut set = k.begin_changes(&s, NOW);
    let made = stage(
        &k,
        &mut set,
        &s,
        &AgentOp::CreateNote {
            note_type: "page".into(),
            title: "Child".into(),
            body: "Under it.".into(),
            project: None,
            tags: vec![],
            props: Map::new(),
            parent: Some("library/no-id.md".into()),
            template: None,
        },
    );
    let parent = &set.files["library/no-id.md"];
    assert!(
        !parent.base.contains("id:") && parent.text.contains("id: "),
        "{}",
        parent.text
    );
    let id = parent
        .text
        .lines()
        .find_map(|l| l.strip_prefix("id: "))
        .unwrap()
        .trim()
        .to_owned();
    let child = set.text_of(made["path"].as_str().unwrap()).unwrap();
    assert!(child.contains(&format!("parent: {id}")), "{child}");
    assert_eq!(set.steps.len(), 1);
    assert_eq!(
        fs::read_to_string(t.vault.root().join("library/no-id.md")).unwrap(),
        parent.base,
        "the vault still has it as it was"
    );
}

#[test]
fn two_notes_with_one_title_are_numbered_as_they_are_when_made_at_once() {
    let (_t, k, s) = open();
    let mut set = k.begin_changes(&s, NOW);
    let a = stage(&k, &mut set, &s, &create("Twin", "one"));
    let b = stage(&k, &mut set, &s, &create("Twin", "two"));
    assert_eq!(a["path"], "library/twin.md");
    assert_eq!(b["path"], "library/twin-2.md");
    // Named by title it is ambiguous, as two notes with one title are.
    let err = k.resolve_staged(&set, "Twin").unwrap_err().to_string();
    assert!(err.contains("Several notes are called"), "{err}");
}
