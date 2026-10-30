//! Keeping saved setups: renaming changes only the name line of the file and
//! keeps every key and comment a person added, a name with odd characters reads
//! back as typed, and deleting goes through the trash and can be undone.

use std::fs;

use crate::change_sets::{open, snapshot};
use crate::common::NOW;
use crate::setups_saved::{DRAFT, PROJECT, RELATED, commits, new, pages, tree};
use kasten_core::Kasten;
use kasten_core::history::Actor;

fn save(k: &Kasten, slug: &str, title: &str, include: &[&str]) -> kasten_core::SavedSetup {
    k.save_project_setup(&Actor::Human, PROJECT, slug, title, &pages(include), NOW)
        .unwrap()
}

#[test]
fn renaming_changes_the_name_line_and_keeps_every_other_byte_and_key() {
    let (t, k, _s) = open();
    save(&k, "", "Study kit", &[DRAFT]);
    let file = t.vault.root().join("templates/setups/study-kit.yaml");
    let mut text = fs::read_to_string(&file).unwrap();
    text.insert_str(0, "# hand notes\n");
    text.push_str("author: me   # kept\nextra:\n  - 1\n  - two\n");
    fs::write(&file, &text).unwrap();
    let info = k
        .rename_setup(&Actor::Human, "saved:study-kit", "Kit \"two\": a # b", NOW)
        .unwrap();
    assert_eq!(
        (info.id.as_str(), info.name.as_str()),
        ("saved:study-kit", "Kit \"two\": a # b")
    );
    let after = fs::read_to_string(&file).unwrap();
    assert_eq!(
        after,
        text.replacen("name: Study kit", "name: \"Kit \\\"two\\\": a # b\"", 1)
    );
    assert_eq!(k.list_setups().unwrap()[3].name, "Kit \"two\": a # b");
    // The file name stays, so a link or a habit that names it keeps working, and it still applies.
    assert!(
        k.apply_setup(&Actor::Human, "saved:study-kit", &new("Renamed"), NOW)
            .is_ok()
    );
    assert!(
        k.rename_setup(&Actor::Human, "saved:study-kit", "  ", NOW)
            .is_err()
    );
    assert!(
        k.rename_setup(&Actor::Human, "saved:study-kit", "a\nb", NOW)
            .is_err()
    );
    assert!(
        k.rename_setup(&Actor::Human, "saved:nothing", "X", NOW)
            .is_err()
    );
    assert!(
        k.rename_setup(&Actor::Human, "research", "X", NOW).is_err(),
        "built-in setups are not renamed"
    );
}

#[test]
fn a_name_with_odd_characters_reads_back_as_it_was_typed() {
    let (_t, k, _s) = open();
    for name in [
        "Say \"hi\": a # b",
        "日本語 キット",
        "- dash",
        "'quote'",
        "emoji 🎓",
        "tab\u{2003}x",
        "yes",
        "123",
    ] {
        let saved = save(&k, "", name, &[]);
        let listed = k.list_setups().unwrap();
        let info = listed.iter().find(|s| s.id == saved.id).unwrap();
        assert_eq!(info.name, name);
    }
}

#[test]
fn a_setup_with_no_pages_still_brings_the_tags_and_opens_on_the_project_page() {
    let (t, k, _s) = open();
    let saved = save(&k, "", "Just tags", &[]);
    assert!(
        saved
            .written
            .iter()
            .any(|p| p.ends_with("vault/tags/paper.yaml"))
    );
    assert!(!saved.written.iter().any(|p| p.contains("/pages/")));
    let plan = k.preview_setup("saved:just-tags", &new("Bare")).unwrap();
    assert_eq!(plan.home, "projects/bare/_project.md");
    let done = k
        .apply_setup(&Actor::Human, "saved:just-tags", &new("Bare"), NOW)
        .unwrap();
    assert!(
        done.written
            .contains(&"projects/bare/_project.md".to_owned())
    );
    assert!(t.vault.root().join("projects/bare/_project.md").is_file());
}

#[test]
fn deleting_a_setup_moves_it_to_the_trash_and_undo_brings_it_back() {
    let (t, k, _s) = open();
    save(&k, "", "Study kit", &[DRAFT, RELATED]);
    let before = tree(t.vault.root());
    let last = commits(&k);
    let gone = k
        .trash_setup(&Actor::Human, "saved:study-kit", NOW)
        .unwrap();
    assert_eq!(gone.id, "saved:study-kit");
    assert_eq!(commits(&k), last + 1, "one commit");
    let root = t.vault.root();
    assert!(!root.join("templates/setups/study-kit.yaml").exists());
    assert!(!root.join("templates/setups/study-kit").exists());
    assert!(
        gone.trashed.starts_with(".trash/") && root.join(&gone.trashed).is_file(),
        "{}",
        gone.trashed
    );
    let folder = gone.trashed.trim_end_matches(".yaml");
    assert!(root.join(folder).join("pages/report-draft.md").is_file());
    assert_eq!(k.list_setups().unwrap().len(), 3);
    assert!(
        k.apply_setup(&Actor::Human, "saved:study-kit", &new("X"), NOW)
            .is_err()
    );
    // Undo brings every file back.
    k.undo_commit(gone.commit.as_deref().unwrap(), NOW).unwrap();
    assert!(tree(root) == before);
    assert_eq!(k.list_setups().unwrap().len(), 4);
}

#[test]
fn the_name_of_a_deleted_setup_is_free_again() {
    let (_t, k, _s) = open();
    save(&k, "", "Study kit", &[DRAFT]);
    k.trash_setup(&Actor::Human, "saved:study-kit", NOW)
        .unwrap();
    assert_eq!(save(&k, "", "Study kit", &[]).slug, "study-kit");
}

#[test]
fn only_a_person_renames_or_deletes_a_setup_and_built_in_ones_stay() {
    let (t, k, s) = open();
    save(&k, "", "Study kit", &[]);
    let before = snapshot(t.vault.root());
    assert!(
        k.rename_setup(&s.actor(), "saved:study-kit", "X", NOW)
            .is_err()
    );
    assert!(k.trash_setup(&s.actor(), "saved:study-kit", NOW).is_err());
    assert!(k.trash_setup(&Actor::Human, "research", NOW).is_err());
    assert!(k.trash_setup(&Actor::Human, "saved:../x", NOW).is_err());
    assert!(snapshot(t.vault.root()) == before);
}
