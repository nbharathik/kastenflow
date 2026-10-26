//! Applying a setup a person saved: a new project with the same tags, views and
//! skeleton pages as the project it came from, in one commit that undo takes
//! back, with the project's name filled in where the page said it.

use std::fs;

use crate::change_sets::open;
use crate::common::NOW;
use crate::setups_saved::{
    DRAFT, PROJECT, RELATED, commits, copy_dir, fresh, new, pages, read, tree,
};
use kasten_core::SetupTarget;
use kasten_core::frontmatter::split;
use kasten_core::history::Actor;

#[test]
fn applying_a_saved_setup_makes_a_project_with_the_same_tags_views_and_pages() {
    let (t, k, _s) = open();
    k.save_project_setup(
        &Actor::Human,
        PROJECT,
        "",
        "Study kit",
        &pages(&[DRAFT, RELATED]),
        NOW,
    )
    .unwrap();
    // Another vault that has only the setup's folder (templates are an ordinary folder).
    let other = fresh();
    copy_dir(
        &t.vault.root().join("templates/setups"),
        &other.dir.join("templates/setups"),
    );
    // A vault that does not have the tag's schema yet.
    let _ = fs::remove_file(other.dir.join("tags/paper.yaml"));
    assert!(!other.dir.join("tags/paper.yaml").exists());
    other.k.commit_external().unwrap();
    let before = tree(&other.dir);
    let last = commits(&other.k);

    let plan = other
        .k
        .preview_setup("saved:study-kit", &new("Second study"))
        .unwrap();
    assert_eq!(plan.project_path, "projects/second-study/_project.md");
    assert!(tree(&other.dir) == before, "a preview writes nothing");
    let done = other
        .k
        .apply_setup(&Actor::Human, "saved:study-kit", &new("Second study"), NOW)
        .unwrap();
    assert_eq!(done.written, plan.create);
    assert_eq!(commits(&other.k), last + 1, "one commit");
    let head = &other.k.log(None, 1).unwrap()[0];
    assert!(
        head.message.contains("Kasten-Setup: saved:study-kit"),
        "{}",
        head.message
    );
    assert_eq!(done.commit.as_deref(), Some(head.id.as_str()));

    // The tag's schema came along as it was, with its three views.
    assert_eq!(
        read(&other.dir, "tags/paper.yaml"),
        read(t.vault.root(), "tags/paper.yaml")
    );
    let schemas = other.k.tag_schemas().unwrap();
    let paper = schemas.iter().find(|s| s.name == "paper").unwrap();
    let views: Vec<&str> = paper
        .views
        .iter()
        .filter_map(|v| v.get("name").and_then(|n| n.as_str()))
        .collect();
    assert_eq!(views, ["Pipeline", "Deadlines", "All"]);

    // The pages: same title, tags, properties and body; new ids; the sub-page under its page.
    let draft = other
        .k
        .read("projects/second-study/pages/report-draft.md")
        .unwrap();
    let source = fs::read_to_string(t.vault.root().join(DRAFT)).unwrap();
    let source_note = t.vault.read(DRAFT).unwrap();
    assert_eq!(draft.meta.title, source_note.meta.title);
    assert_eq!(draft.meta.kind, "page");
    assert_eq!(draft.meta.tags, source_note.meta.tags);
    assert_eq!(draft.meta.props, source_note.meta.props);
    assert_eq!(split(&draft.text).body, split(&source).body);
    let id = draft.meta.id.clone().unwrap();
    assert_eq!(id.len(), 26);
    assert_ne!(Some(id.clone()), source_note.meta.id);
    let related = other
        .k
        .read("projects/second-study/pages/related-work-notes.md")
        .unwrap();
    assert_eq!(related.meta.parent.as_deref(), Some(id.as_str()));
    assert_eq!(related.meta.project.as_deref(), Some("second-study"));
    assert!(
        other.k.verify().unwrap().problems.is_empty(),
        "{:?}",
        other.k.verify().unwrap().problems
    );

    // Undo takes all of it back, the project too.
    other
        .k
        .undo_commit(done.commit.as_deref().unwrap(), NOW)
        .unwrap();
    assert!(tree(&other.dir) == before);
}

#[test]
fn applying_in_the_vault_it_came_from_keeps_the_schema_that_is_there() {
    let (t, k, _s) = open();
    k.save_project_setup(
        &Actor::Human,
        PROJECT,
        "",
        "Study kit",
        &pages(&[DRAFT]),
        NOW,
    )
    .unwrap();
    let schema = read(t.vault.root(), "tags/paper.yaml");
    let done = k
        .apply_setup(&Actor::Human, "saved:study-kit", &new("Again"), NOW)
        .unwrap();
    assert!(
        done.kept.contains(&"tags/paper.yaml".to_owned()),
        "{:?}",
        done.kept
    );
    assert_eq!(read(t.vault.root(), "tags/paper.yaml"), schema);
    assert!(
        t.vault
            .root()
            .join("projects/again/pages/report-draft.md")
            .is_file()
    );
    // And onto a project that is there already, only what it lacks is added.
    let again = k
        .apply_setup(
            &Actor::Human,
            "saved:study-kit",
            &SetupTarget::Existing {
                folder: "photo-organiser".into(),
            },
            NOW,
        )
        .unwrap();
    assert!(
        again
            .written
            .contains(&"projects/photo-organiser/pages/report-draft.md".to_owned())
    );
}

#[test]
fn the_project_name_stands_in_for_itself_in_the_body_and_the_header_is_left_alone() {
    let (t, k, _s) = open();
    k.create_project(&Actor::Human, "Thesis", None, NOW)
        .unwrap();
    let page = "---\nid: 01K5Y2THESISINTRO000000001\ntitle: Thesis intro\ntype: page\n---\nThe Thesis introduces Thesis and the thesis.\n";
    fs::create_dir_all(t.vault.root().join("projects/thesis/pages")).unwrap();
    fs::write(t.vault.root().join("projects/thesis/pages/intro.md"), page).unwrap();
    k.reindex().unwrap();
    k.save_project_setup(
        &Actor::Human,
        "thesis",
        "",
        "Thesis start",
        &pages(&["projects/thesis/pages/intro.md"]),
        NOW,
    )
    .unwrap();
    let skeleton = read(
        t.vault.root(),
        "templates/setups/thesis-start/pages/intro.md",
    );
    assert_eq!(
        skeleton,
        "---\nid: \"{{id:p1}}\"\ntitle: Thesis intro\ntype: page\n---\nThe {{project}} introduces {{project}} and the thesis.\n"
    );
    let done = k
        .apply_setup(
            &Actor::Human,
            "saved:thesis-start",
            &new("Dissertation"),
            NOW,
        )
        .unwrap();
    let made = read(t.vault.root(), "projects/dissertation/pages/intro.md");
    assert!(
        made.contains("The Dissertation introduces Dissertation and the thesis.\n"),
        "{made}"
    );
    assert!(
        done.written
            .iter()
            .all(|p| !read(t.vault.root(), p).contains("{{")),
        "{:?}",
        done.written
    );
}
