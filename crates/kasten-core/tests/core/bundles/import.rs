//! Importing a bundle: into an empty vault, and into a vault that has some of the same
//! things, where every clash is settled in the open and the whole import is one commit.

use std::collections::BTreeSet;

use kasten_core::history::Actor;
use kasten_core::import::{ImportConflictKind as Kind, ImportKind, ImportOptions, ImportSummary};
use serde_json::Value;

use super::project::{
    BIB, FOLDER, HIGHLIGHTS, PDF, TAG_ATLAS, TAG_JOURNEY, exported, id, plan_page, tree,
};
use crate::bibliography::support::{Fresh, MANAGED, NOW, fresh};

fn plan(into: &Fresh, from: &super::project::Dest) -> ImportSummary {
    into.k
        .plan_import(&from.dir, &ImportOptions::default(), NOW)
        .unwrap()
}

fn import(into: &Fresh, from: &super::project::Dest) -> (ImportSummary, String) {
    let done = into
        .k
        .import(&Actor::Human, &from.dir, &ImportOptions::default(), NOW)
        .unwrap();
    (
        done.summary,
        done.commit.expect("a vault with history commits"),
    )
}

fn kinds(summary: &ImportSummary) -> Vec<Kind> {
    summary.conflicts.iter().map(|c| c.kind).collect()
}

const ALL: [&str; 15] = [
    "projects/trip/_project.md",
    "projects/trip/pages/plan.md",
    "projects/trip/pages/itinerary.md",
    "projects/trip/pages/plan.comments.json",
    "projects/trip/boards/map.canvas",
    "projects/trip/decks/talk.deck",
    "assets/map.png",
    "assets/.meta/map.png.json",
    "assets/chart.png",
    "assets/.meta/chart.png.json",
    "assets/guide.pdf",
    "sources/paper.pdf",
    "sources/paper.highlights.json",
    "tags/atlas.yaml",
    "tags/journey.yaml",
];

#[test]
fn a_bundle_comes_into_an_empty_vault_as_it_was_in_one_commit_that_undo_takes_back() {
    let (source, bundle) = exported();
    let into = fresh();
    let head = into.head();

    let planned = plan(&into, &bundle);
    assert_eq!(planned.kind, ImportKind::Bundle);
    assert_eq!(planned.project, "Trip");
    assert_eq!(planned.project_path, "projects/trip/_project.md");
    assert_eq!(
        (planned.notes, planned.boards, planned.files, planned.tags),
        (2, 1, 5, 2)
    );
    assert_eq!((planned.days, planned.days_appended), (0, 0));
    assert!(planned.conflicts.is_empty(), "{:?}", planned.conflicts);
    assert_eq!(
        planned.warnings,
        ["2 links lead to notes outside the project"]
    );
    assert_eq!(into.head(), head, "planning writes nothing");
    assert!(!into.exists("projects/trip"));

    let (summary, commit) = import(&into, &bundle);
    assert_eq!(summary, planned);
    assert_eq!(commit, into.head());
    for path in ALL {
        assert_eq!(
            into.text_or_bytes(path),
            source.text_or_bytes(path),
            "{path} is as it was"
        );
    }
    assert_eq!(into.text(MANAGED), bundle.text("references.bib"));
    let notes: BTreeSet<String> = into.k.list().unwrap().into_iter().map(|n| n.path).collect();
    assert!(
        notes.contains("projects/trip/pages/plan.md")
            && notes.contains("projects/trip/pages/itinerary.md")
    );
    assert_eq!(
        into.k
            .read("projects/trip/pages/itinerary.md")
            .unwrap()
            .meta
            .parent,
        Some(id(2))
    );
    assert_eq!(into.k.bibliography().unwrap().managed.entries.len(), 2);

    let undone = into.k.undo_commit(&commit, NOW).unwrap();
    assert!(undone.conflict.is_none(), "{:?}", undone.conflict);
    for path in ALL.iter().copied().chain([MANAGED]) {
        assert!(!into.exists(path), "{path} is gone");
    }
}

#[test]
fn importing_a_bundle_into_the_vault_it_came_from_settles_the_folder_and_the_ids() {
    let (a, bundle) = exported();
    let before = tree(&a.dir);
    let planned = plan(&a, &bundle);
    assert_eq!(kinds(&planned), [Kind::Project, Kind::Id]);
    assert_eq!(planned.conflicts[0].what, "projects/trip");
    assert!(planned.conflicts[0].resolution.contains("projects/trip-2"));
    assert_eq!(planned.conflicts[1].what, "3 notes");
    assert_eq!(planned.project_path, "projects/trip-2/_project.md");
    assert_eq!(
        (planned.notes, planned.boards, planned.files, planned.tags),
        (2, 1, 1, 0)
    );
    assert_eq!(tree(&a.dir), before, "planning writes nothing");

    let (summary, commit) = import(&a, &bundle);
    assert_eq!(summary, planned);
    assert_eq!(commit, a.head());
    let after = tree(&a.dir);
    let new: Vec<&String> = after.keys().filter(|p| !before.contains_key(*p)).collect();
    assert!(
        new.iter().all(|p| p.starts_with("projects/trip-2/")),
        "only the project's files are new: {new:?}"
    );
    assert_eq!(new.len(), 6);
    for (path, bytes) in &before {
        assert_eq!(after.get(path), Some(bytes), "{path} is as it was");
    }

    // The ids are new, and what refers to them follows; the links by path follow the folder.
    let plan_note = a.k.read("projects/trip-2/pages/plan.md").unwrap();
    let itinerary = a.k.read("projects/trip-2/pages/itinerary.md").unwrap();
    let new_id = plan_note.meta.id.clone().unwrap();
    assert_ne!(new_id, id(2));
    assert_ne!(itinerary.meta.id.clone().unwrap(), id(3));
    assert_eq!(itinerary.meta.parent.as_deref(), Some(new_id.as_str()));
    assert_ne!(
        a.k.read("projects/trip-2/_project.md").unwrap().meta.id,
        Some(id(1))
    );
    assert!(
        plan_note
            .text
            .contains("[[projects/trip-2/pages/itinerary|the days]]"),
        "{}",
        plan_note.text
    );
    assert_eq!(
        plan_note
            .text
            .replace("trip-2", "trip")
            .replace(&new_id, &id(2)),
        plan_page()
    );
    assert!(
        a.text("projects/trip-2/boards/map.canvas")
            .contains("\"file\": \"projects/trip-2/pages/plan.md\"")
    );
    assert!(
        a.text("projects/trip-2/boards/map.canvas")
            .contains("\"file\": \"library/outside-note.md\"")
    );
    assert!(
        !a.exists("assets/map-2.png"),
        "the same picture is used, not copied"
    );
    assert_eq!(
        a.k.bibliography().unwrap().managed.entries.len(),
        3,
        "the works are there already"
    );
}

#[test]
fn a_picture_or_pdf_with_the_name_of_another_comes_in_under_a_new_name_and_the_project_follows() {
    let (_source, bundle) = exported();
    let into = fresh();
    into.put_bytes("assets/map.png", b"someone else's map");
    into.put(
        "assets/.meta/map.png.json",
        "{\n  \"id\": \"01K5ZK0000000000000000AS09\"\n}\n",
    );
    into.put_bytes("sources/paper.pdf", b"%PDF-1.4 another paper");
    into.reindex();
    into.k.commit_external().unwrap();

    let planned = plan(&into, &bundle);
    assert_eq!(kinds(&planned), [Kind::Asset, Kind::Source]);
    assert_eq!(planned.conflicts[0].what, "assets/map.png");
    assert!(planned.conflicts[0].resolution.contains("assets/map-2.png"));
    assert_eq!(planned.conflicts[1].what, "sources/paper.pdf");
    import(&into, &bundle);

    assert_eq!(
        into.text_or_bytes("assets/map.png"),
        "someone else's map",
        "yours is as it was"
    );
    assert_eq!(into.text_or_bytes("assets/map-2.png"), "the map picture");
    assert_eq!(
        into.text("assets/.meta/map-2.png.json"),
        super::project::CARD_MAP
    );
    assert_eq!(
        into.text_or_bytes("sources/paper-2.pdf"),
        String::from_utf8_lossy(PDF)
    );
    assert_eq!(into.text("sources/paper-2.highlights.json"), HIGHLIGHTS);
    assert!(!into.exists("sources/paper.highlights.json"));

    let page = into.text("projects/trip/pages/plan.md");
    assert!(page.contains("![map](../../../assets/map-2.png)"), "{page}");
    assert!(
        page.contains("![[chart.png]]"),
        "a file that came in as it was is not renamed: {page}"
    );
    assert!(page.contains("[[sources/paper-2.pdf]]"), "{page}");
    assert!(
        into.text("projects/trip/boards/map.canvas")
            .contains("\"file\": \"assets/map-2.png\"")
    );
    assert!(
        into.text("projects/trip/decks/talk.deck")
            .contains("\"src\": \"assets/map-2.png\"")
    );
}

#[test]
fn a_tag_schema_the_vault_has_is_kept_and_the_difference_is_said() {
    let (_source, bundle) = exported();
    let into = fresh();
    into.put(
        "tags/atlas.yaml",
        "name: atlas\ncolor: red\nproperties:\n  - {key: status, type: text}\n",
    );
    into.reindex();
    into.k.commit_external().unwrap();
    let planned = plan(&into, &bundle);
    assert_eq!(kinds(&planned), [Kind::Tag]);
    assert_eq!(planned.conflicts[0].what, "atlas");
    assert_eq!(planned.tags, 1, "only the schema the vault lacked comes in");
    import(&into, &bundle);
    assert!(into.text("tags/atlas.yaml").contains("color: red"));
    assert_eq!(into.text("tags/journey.yaml"), TAG_JOURNEY);

    // The same schema is no conflict.
    let same = fresh();
    same.put("tags/atlas.yaml", TAG_ATLAS);
    same.reindex();
    assert!(plan(&same, &bundle).conflicts.is_empty());
}

#[test]
fn a_work_under_a_key_the_vault_has_for_another_work_comes_in_under_a_new_key() {
    let (_source, bundle) = exported();
    let into = fresh();
    let other =
        &BIB[BIB.find("@article{other2019").unwrap()..BIB.find("@article{notcited2018").unwrap()];
    into.put(
        MANAGED,
        &format!(
            "@article{{old2020thing,\n  title = {{Something else}},\n  year = {{1999}}\n}}\n\n{}",
            other.trim_end()
        ),
    );
    into.reindex();
    into.k.commit_external().unwrap();
    let before = into.text(MANAGED);

    let planned = plan(&into, &bundle);
    assert_eq!(kinds(&planned), [Kind::Key]);
    assert_eq!(planned.conflicts[0].what, "old2020thing");
    assert!(planned.conflicts[0].resolution.contains("old2020thing-2"));
    import(&into, &bundle);

    let text = into.text(MANAGED);
    assert!(text.starts_with(&before), "what was there is untouched");
    assert!(
        text.contains("@article{old2020thing-2,\n  title = {A thing},\n  booktitle = nips,"),
        "{text}"
    );
    assert_eq!(
        text.matches("@article{other2019").count(),
        1,
        "an identical work is not added again"
    );
    assert_eq!(text.matches("@string{nips").count(), 1);
    let bib = into.k.bibliography().unwrap();
    assert_eq!(bib.managed.entries.len(), 3);
    assert!(
        bib.managed
            .entries
            .iter()
            .any(|e| e.key == "old2020thing-2" && e.fields["booktitle"] == "Advances in NIPS")
    );

    let page = into.text("projects/trip/pages/plan.md");
    assert!(
        page.contains("[@old2020thing-2, p. 4] and [see @other2019]"),
        "{page}"
    );
    let deck: Value = serde_json::from_str(&into.text("projects/trip/decks/talk.deck")).unwrap();
    assert_eq!(
        deck["slides"][0]["elements"][0]["keys"],
        serde_json::json!(["old2020thing-2"])
    );
    assert_eq!(deck["slides"][0]["elements"][1]["src"], "assets/map.png");
}

#[test]
fn a_second_import_of_the_same_bundle_does_not_pile_up_files() {
    let (_a, bundle) = exported();
    let into = fresh();
    import(&into, &bundle);
    let after_first = tree(&into.dir);
    let (summary, _) = import(&into, &bundle);
    assert_eq!(kinds(&summary), [Kind::Project, Kind::Id]);
    let after_second = tree(&into.dir);
    let added: Vec<&String> = after_second
        .keys()
        .filter(|p| !after_first.contains_key(*p))
        .collect();
    assert!(
        added.iter().all(|p| p.starts_with("projects/trip-2/")),
        "{added:?}"
    );
    assert_eq!(into.k.bibliography().unwrap().managed.entries.len(), 2);
}

#[test]
fn naming_a_project_does_not_change_what_a_bundle_is() {
    let (_a, bundle) = exported();
    let into = fresh();
    let options = ImportOptions {
        kind: None,
        project: Some("Elsewhere".to_owned()),
    };
    let planned = into.k.plan_import(&bundle.dir, &options, NOW).unwrap();
    assert_eq!(
        planned.project, "Trip",
        "a bundle keeps its project's own name"
    );
    assert_eq!(FOLDER, "trip");
}
