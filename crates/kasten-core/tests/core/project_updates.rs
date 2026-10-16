//! The project update template: a dated page with Progress, Decisions,
//! Blockers and Next action, tagged so a project's latest update is found.
//! A vault made before it shipped still creates one: creating a note from a
//! template the vault lacks falls back to the one that shipped with the app.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::history::Actor;
use kasten_core::{Error, Kasten, Kind, NewNote, shipped_template};

const TEMPLATE: &str = "templates/project-update.md";

fn update(title: &str, project: &str) -> NewNote {
    NewNote {
        kind: Kind::Page,
        title: title.to_owned(),
        date: "2026-10-06".to_owned(),
        project: Some(project.to_owned()),
        parent: None,
        template: Some("project-update".to_owned()),
        icon: None,
    }
}

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

#[test]
fn a_new_vault_starts_with_the_template() {
    let dir = std::env::temp_dir().join(format!(
        "kasten-updates-{}",
        kasten_core::ulid_at(kasten_core::Instant::now().millis)
    ));
    let k = Kasten::init(&dir, "Updates").unwrap();
    let text = fs::read_to_string(dir.join(TEMPLATE)).unwrap();
    assert_eq!(Some(text.as_str()), shipped_template("project-update"));
    for part in [
        "type: page",
        "tags: [project-update]",
        "date: \"{{date}}\"",
        "## Progress",
        "## Decisions",
        "## Blockers",
        "## Next action",
    ] {
        assert!(text.contains(part), "{part} in {text}");
    }
    let order: Vec<usize> = [
        "## Progress",
        "## Decisions",
        "## Blockers",
        "## Next action",
    ]
    .iter()
    .map(|h| text.find(h).unwrap())
    .collect();
    assert!(order.windows(2).all(|w| w[0] < w[1]));
    assert!(k.missing_templates().unwrap().is_empty());
    drop(k);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn an_update_is_a_dated_page_in_the_project_made_in_one_commit() {
    let (t, k) = open();
    let before = k.log(None, 1).unwrap()[0].id.clone();
    let note = k
        .create(
            &Actor::Human,
            &update("Update 2026-10-06", "photo-organiser"),
            NOW,
        )
        .unwrap();
    assert_eq!(
        note.meta.path,
        "projects/photo-organiser/pages/update-2026-10-06.md"
    );
    assert_eq!(note.meta.tags, ["project-update"]);
    assert_eq!(note.meta.props["date"], "2026-10-06");
    assert_eq!(note.meta.kind, "page");
    let text = fs::read_to_string(t.vault.root().join(&note.meta.path)).unwrap();
    assert!(
        text.contains("title: Update 2026-10-06\n")
            || text.contains("title: \"Update 2026-10-06\"\n"),
        "{text}"
    );
    for heading in [
        "## Progress",
        "## Decisions",
        "## Blockers",
        "## Next action",
    ] {
        assert!(text.contains(heading));
    }
    let log = k.log(None, 3).unwrap();
    assert_eq!(log[1].id, before, "one commit");
    // The hub finds it as the project's last update.
    let summary = k.project_summaries("2026-10-07").unwrap();
    let project = summary
        .iter()
        .find(|p| p.folder == "photo-organiser")
        .unwrap();
    let last = project.last_update.as_ref().unwrap();
    assert_eq!(
        (last.path.as_str(), last.date.as_deref()),
        (note.meta.path.as_str(), Some("2026-10-06"))
    );
}

#[test]
fn a_vault_without_the_template_uses_the_shipped_one_and_the_vaults_own_wins() {
    let (t, k) = open();
    let shipped = shipped_template("project-update").unwrap();
    let with = k
        .create(&Actor::Human, &update("With", "photo-organiser"), NOW)
        .unwrap();

    fs::remove_file(t.vault.root().join(TEMPLATE)).unwrap();
    k.outside_changes(&[TEMPLATE.to_owned()], 1);
    assert!(
        k.missing_templates()
            .unwrap()
            .contains(&"project-update".to_owned())
    );
    let without = k
        .create(&Actor::Human, &update("Without", "photo-organiser"), NOW)
        .unwrap();
    let strip = |text: &str| {
        text.lines()
            .filter(|l| {
                !l.starts_with("id:")
                    && !l.starts_with("title:")
                    && !l.starts_with("created:")
                    && !l.starts_with("updated:")
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    assert_eq!(strip(&without.text), strip(&with.text));
    assert!(shipped.contains("## Progress"));

    // The vault's own version is what a note is made from while it exists.
    let own = "---\ntitle: \"{{title}}\"\ntype: page\ntags: [project-update]\n---\nMy own shape.\n";
    fs::write(t.vault.root().join(TEMPLATE), own).unwrap();
    let mine = k
        .create(&Actor::Human, &update("Mine", "photo-organiser"), NOW)
        .unwrap();
    assert!(mine.text.contains("My own shape."));
    assert!(!mine.text.contains("## Progress"));
}

#[test]
fn only_shipped_templates_are_stood_in_for() {
    let (_t, k) = open();
    let mut missing = update("Nothing", "photo-organiser");
    missing.template = Some("no-such-template".to_owned());
    assert!(matches!(
        k.create(&Actor::Human, &missing, NOW),
        Err(Error::NotFound(_))
    ));
    assert!(shipped_template("no-such-template").is_none());
    assert!(shipped_template("project-update").is_some());
    assert!(shipped_template("page").is_some());
    // The name is read as a template name, never as a path.
    assert!(shipped_template("../.kasten/config").is_none());
}
