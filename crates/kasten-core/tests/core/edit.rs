//! Section, property and tag edits through the engine (the MCP tools
//! `replace_section`, `update_props`, `add_tags`, `remove_tags`,
//! `journal_append`, `update_tag_schema`).

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::Kasten;
use kasten_core::history::Actor;
use serde_json::{Map, Value, json};

const DRAFT: &str = "projects/note-taking-study/pages/report-draft.md";
const SKETCH: &str = "projects/photo-organiser/cards/duplicate-score-sketch.md";

fn props(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

#[test]
fn replaces_one_section_and_nothing_else() {
    let (t, k) = open();
    let before = fs::read_to_string(t.vault.root().join(DRAFT)).unwrap();
    let note = k
        .replace_section(
            &Actor::Human,
            DRAFT,
            "4. Evaluation",
            "We ran 1,200 edits.",
            NOW,
        )
        .unwrap();
    assert!(
        note.text
            .contains("## 4. Evaluation\n\nWe ran 1,200 edits.\n\n## 5. Discussion\n")
    );
    // Only the section and `updated` changed.
    let old: Vec<&str> = before
        .lines()
        .filter(|l| !l.starts_with("updated:"))
        .collect();
    let new: Vec<&str> = note
        .text
        .lines()
        .filter(|l| !l.starts_with("updated:") && !l.contains("1,200"))
        .collect();
    assert_eq!(
        new.iter().filter(|l| !l.is_empty()).count(),
        old.iter().filter(|l| !l.is_empty()).count()
    );
    assert_eq!(
        k.log(Some(DRAFT), 1).unwrap()[0].summary,
        "section: Report draft: How people find old notes § 4. Evaluation"
    );
    assert!(
        k.replace_section(&Actor::Human, DRAFT, "Nowhere", "x", NOW)
            .is_err()
    );
}

#[test]
fn updates_props_checked_against_the_tag_schema() {
    let (_t, k) = open();
    let note = k
        .update_props(
            &Actor::Human,
            DRAFT,
            &props(json!({"status": "submitted", "venue": "CHI 2027"})),
            NOW,
        )
        .unwrap();
    assert!(
        note.text
            .contains("props:\n  status: Submitted\n  venue: CHI 2027\n  deadline: 2026-12-01\n"),
        "{}",
        note.text
    );
    assert_eq!(note.meta.props["status"], json!("Submitted"));
    let err = k
        .update_props(
            &Actor::Human,
            DRAFT,
            &props(json!({"status": "Rejected"})),
            NOW,
        )
        .unwrap_err();
    assert!(err.to_string().contains("must be one of"), "{err}");
    let err = k
        .update_props(
            &Actor::Human,
            DRAFT,
            &props(json!({"deadline": "soon"})),
            NOW,
        )
        .unwrap_err();
    assert!(err.to_string().contains("date"), "{err}");
    // Removing a property removes its line.
    let note = k
        .update_props(&Actor::Human, DRAFT, &props(json!({"venue": null})), NOW)
        .unwrap();
    assert!(!note.text.contains("venue"));
}

#[test]
fn relations_store_ids_and_name_notes_by_title() {
    let (_t, k) = open();
    let note = k
        .update_props(
            &Actor::Human,
            DRAFT,
            &props(json!({"related": ["Duplicate score sketch", "01K5Y2RE1ATEDW0RKN0TES0001"]})),
            NOW,
        )
        .unwrap();
    assert_eq!(
        note.meta.props["related"],
        json!(["01M36R5PK06PHCVWBZ1FDV30FF", "01K5Y2RE1ATEDW0RKN0TES0001"])
    );
    let err = k
        .update_props(
            &Actor::Human,
            DRAFT,
            &props(json!({"related": ["No such page"]})),
            NOW,
        )
        .unwrap_err();
    assert!(err.to_string().contains("No note called"), "{err}");
}

#[test]
fn relations_name_notes_by_path_and_never_guess_among_namesakes() {
    let (t, k) = open();
    // Two notes share a title and have no ids, as imported notes may.
    for folder in ["photo-organiser", "note-taking-study"] {
        fs::write(
            t.vault
                .path_of(&format!("projects/{folder}/pages/readme.md"))
                .unwrap(),
            "---\ntitle: README\n---\n",
        )
        .unwrap();
    }
    k.reindex().unwrap();
    let relate = |item: &str| {
        k.update_props(
            &Actor::Human,
            DRAFT,
            &props(json!({ "related": [item] })),
            NOW,
        )
    };
    let err = relate("README").unwrap_err();
    assert!(err.to_string().contains("Several notes"), "{err}");
    let note = relate("projects/photo-organiser/pages/readme.md").unwrap();
    let chosen = k.read("projects/photo-organiser/pages/readme.md").unwrap();
    assert_eq!(
        note.meta.props["related"],
        json!([chosen.meta.id.clone().unwrap()])
    );
    let other = k
        .read("projects/note-taking-study/pages/readme.md")
        .unwrap();
    assert!(other.meta.id.is_none(), "the other README was written");
    // A template is never related to, by title or by path.
    for item in ["templates/blog-post.md", "{{title}}"] {
        let err = relate(item).unwrap_err();
        assert!(err.to_string().contains("No note called"), "{item}: {err}");
    }
    let template = fs::read_to_string(t.vault.path_of("templates/blog-post.md").unwrap()).unwrap();
    assert!(!template.contains("\nid:"), "the template was given an id");
    // A list with one name refused changes nothing: no note is given an id.
    let err = k
        .update_props(
            &Actor::Human,
            DRAFT,
            &props(json!({ "related": ["projects/note-taking-study/pages/readme.md", "No such page"] })),
            NOW,
        )
        .unwrap_err();
    assert!(err.to_string().contains("No note called"), "{err}");
    let other = k
        .read("projects/note-taking-study/pages/readme.md")
        .unwrap();
    assert!(other.meta.id.is_none(), "a refused list gave a note an id");
}

#[test]
fn adds_and_removes_tags() {
    let (_t, k) = open();
    let note = k
        .set_tags(
            &Actor::Human,
            SKETCH,
            &["#paper".into(), "Idea".into(), "trip".into()],
            &[],
            NOW,
        )
        .unwrap();
    assert_eq!(note.meta.tags, ["idea", "paper", "trip"]);
    assert!(note.text.contains("tags: [idea, paper, trip]\n"));
    let note = k
        .set_tags(
            &Actor::Human,
            SKETCH,
            &[],
            &["IDEA".into(), "paper".into(), "trip".into()],
            NOW,
        )
        .unwrap();
    assert!(note.meta.tags.is_empty());
    assert!(!note.text.contains("tags:"));
    assert_eq!(
        k.log(Some(SKETCH), 1).unwrap()[0].summary,
        "tags: Duplicate score sketch"
    );
}

#[test]
fn leaves_out_tags_with_control_characters() {
    let (_t, k) = open();
    let mut expected = k.read(SKETCH).unwrap().meta.tags;
    expected.push("ok".to_owned());
    let note = k
        .set_tags(
            &Actor::Human,
            SKETCH,
            &["ok".into(), "bad\u{1}".into(), "del\u{7f}".into()],
            &[],
            NOW,
        )
        .unwrap();
    assert_eq!(note.meta.tags, expected);
}

#[test]
fn appends_to_a_journal_day_and_writes_tag_schemas() {
    let (t, k) = open();
    let day = k
        .journal_append(
            &Actor::Human,
            None,
            "2026-09-30",
            "- [ ] Pack the charger",
            None,
            NOW,
        )
        .unwrap();
    assert_eq!(day.meta.path, "journal/2026/2026-09-30.md");
    assert!(day.text.ends_with("- [ ] Pack the charger\n"));
    let path = k
        .write_tag_schema(&Actor::Human, "Reading", &json!({"color": "purple", "properties": [{"key": "stage", "type": "select", "options": ["To read", "Done"]}]}), NOW)
        .unwrap();
    assert_eq!(path, "tags/reading.yaml");
    let yaml = fs::read_to_string(t.vault.root().join(&path)).unwrap();
    assert!(yaml.starts_with("name: Reading\ncolor: purple\n"), "{yaml}");
    assert!(k.tag_schemas().unwrap().iter().any(|s| s.name == "Reading"));
    assert!(
        k.write_tag_schema(
            &Actor::Human,
            "x",
            &json!({"properties": [{"key": "a", "type": "nope"}]}),
            NOW
        )
        .is_err()
    );
    // A name with no letters or digits names no tag, not "untitled".
    assert!(matches!(
        k.write_tag_schema(&Actor::Human, "???", &json!({}), NOW),
        Err(kasten_core::Error::Invalid(_))
    ));
    assert!(matches!(
        k.set_tag_views(&Actor::Human, "#", &[], NOW),
        Err(kasten_core::Error::Invalid(_))
    ));
    assert!(!t.vault.root().join("tags/untitled.yaml").exists());
}

#[test]
fn creates_a_note_with_tags_and_properties_in_one_commit() {
    let (t, k) = open();
    let new = kasten_core::NewNote {
        kind: kasten_core::Kind::Page,
        title: "Book flights".into(),
        date: "2026-09-24".into(),
        project: None,
        parent: None,
        template: None,
        icon: None,
    };
    let commits = k.log(None, 500).unwrap().len();
    let good = props(json!({"status": "Todo", "due": "2026-10-02"}));
    let note = k
        .create_with_body(
            &Actor::Human,
            &new,
            "",
            &["task".into()],
            &good,
            "create",
            NOW,
        )
        .unwrap();
    assert_eq!(note.meta.tags, ["task"]);
    assert_eq!(note.meta.props["due"], "2026-10-02");
    assert_eq!(k.log(None, 500).unwrap().len(), commits + 1);

    // A value the schema refuses leaves nothing behind: no file, no commit.
    let before: Vec<_> = fs::read_dir(t.vault.root().join("library"))
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    let bad = props(json!({"status": "Maybe"}));
    let other = kasten_core::NewNote {
        title: "Bad one".into(),
        ..new
    };
    assert!(
        k.create_with_body(
            &Actor::Human,
            &other,
            "",
            &["task".into()],
            &bad,
            "create",
            NOW
        )
        .is_err()
    );
    let after: Vec<_> = fs::read_dir(t.vault.root().join("library"))
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(before.len(), after.len(), "no file was left: {after:?}");
    assert_eq!(k.log(None, 500).unwrap().len(), commits + 1);
}
