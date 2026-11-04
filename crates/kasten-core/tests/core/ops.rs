//! The page ops against a private copy of the dev vault.

use crate::common;

use std::fs;

use common::{NOW, dev_vault};
use kasten_core::{
    Error, Kasten, Kind, NewNote, Saved, create_note, frontmatter, journal_day, save_body, set_meta,
};

fn new_page(title: &str) -> NewNote {
    NewNote {
        kind: Kind::Page,
        title: title.to_owned(),
        date: "2026-09-24".to_owned(),
        project: None,
        parent: None,
        template: None,
        icon: None,
    }
}

#[test]
fn lists_the_vault_with_kinds_projects_and_titles() {
    let t = dev_vault();
    let notes = t.vault.notes().unwrap();
    let find = |path: &str| {
        notes
            .iter()
            .find(|n| n.path == path)
            .unwrap_or_else(|| panic!("{path} missing"))
    };
    assert_eq!(find("projects/photo-organiser/_project.md").kind, "project");
    assert_eq!(
        find("projects/photo-organiser/pages/photo-organiser-roadmap.md")
            .project
            .as_deref(),
        Some("photo-organiser")
    );
    assert_eq!(find("templates/paper.md").kind, "template");
    assert_eq!(find("journal/2026/2026-09-23.md").title, "2026-09-23");
    assert!(notes.iter().all(|n| !n.path.starts_with('.')));
}

#[test]
fn refuses_paths_outside_the_vault_or_into_private_folders() {
    let t = dev_vault();
    for bad in [
        "../x.md",
        "/etc/passwd.md",
        ".git/config.md",
        ".kasten/x.md",
        "a/../b.md",
        "x.txt",
        "a\\b.md",
        "",
    ] {
        assert!(
            matches!(t.vault.read(bad), Err(Error::InvalidPath(_))),
            "{bad}"
        );
    }
    assert!(matches!(
        t.vault.read("library/nope.md"),
        Err(Error::NotFound(_))
    ));
}

#[test]
fn creates_a_page_in_the_library_with_fresh_frontmatter() {
    let t = dev_vault();
    let note = create_note(&t.vault, &new_page("Reading list: 2026"), NOW).unwrap();
    assert_eq!(note.meta.path, "library/reading-list-2026.md");
    assert_eq!(note.meta.title, "Reading list: 2026");
    assert_eq!(note.meta.kind, "page");
    assert_eq!(note.meta.id.as_deref().map(str::len), Some(26));
    assert!(
        note.text.contains("title: \"Reading list: 2026\"\n"),
        "{}",
        note.text
    );
    assert!(note.text.contains("created: 2026-09-24T08:00:00Z\n"));
    let again = create_note(&t.vault, &new_page("Reading list: 2026"), NOW).unwrap();
    assert_eq!(again.meta.path, "library/reading-list-2026-2.md");
}

#[test]
fn fills_templates_and_keeps_their_keys() {
    let t = dev_vault();
    let mut new = new_page("Old notes");
    new.template = Some("paper".to_owned());
    new.project = Some("photo-organiser".to_owned());
    let note = create_note(&t.vault, &new, NOW).unwrap();
    assert_eq!(
        note.meta.path,
        "projects/photo-organiser/pages/old-notes.md"
    );
    assert_eq!(note.meta.tags, vec!["paper"]);
    assert!(
        note.text.contains("props:\n  status: Idea\n"),
        "{}",
        note.text
    );
    assert!(!note.text.contains("{{"), "{}", note.text);
}

#[test]
fn nests_sub_pages_beside_their_parent_and_gives_the_parent_an_id() {
    let t = dev_vault();
    let parent = create_note(&t.vault, &new_page("Study"), NOW).unwrap();
    let mut child = new_page("Chapter 1");
    child.parent = Some(parent.meta.path.clone());
    let child = create_note(&t.vault, &child, NOW).unwrap();
    assert_eq!(child.meta.path, "library/chapter-1.md");
    assert_eq!(child.meta.parent, parent.meta.id);

    fs::write(t.vault.path_of("library/no-id.md").unwrap(), "Plain page\n").unwrap();
    let mut orphan = new_page("Child");
    orphan.parent = Some("library/no-id.md".to_owned());
    let orphan = create_note(&t.vault, &orphan, NOW).unwrap();
    let adopted = t.vault.read("library/no-id.md").unwrap();
    assert!(adopted.meta.id.is_some());
    assert_eq!(orphan.meta.parent, adopted.meta.id);
    assert!(
        adopted.text.ends_with("---\nPlain page\n"),
        "{}",
        adopted.text
    );
}

#[test]
fn creates_projects_cards_and_journal_days() {
    let t = dev_vault();
    let project = NewNote {
        kind: Kind::Project,
        ..new_page("Kasten app")
    };
    assert_eq!(
        create_note(&t.vault, &project, NOW).unwrap().meta.path,
        "projects/kasten-app/_project.md"
    );
    let card = NewNote {
        kind: Kind::Card,
        ..new_page("Quick idea")
    };
    assert_eq!(
        create_note(&t.vault, &card, NOW).unwrap().meta.path,
        "inbox/quick-idea.md"
    );

    let day = journal_day(&t.vault, None, "2026-09-24", NOW).unwrap();
    assert_eq!(day.meta.path, "journal/2026/2026-09-24.md");
    assert_eq!(day.meta.title, "2026-09-24");
    // The starter journal template is blank: a new day is an empty page.
    assert_eq!(
        frontmatter::split(&day.text).body.trim(),
        "",
        "{}",
        day.text
    );
    assert!(day.text.contains("type: journal"), "{}", day.text);
    assert_eq!(
        journal_day(&t.vault, None, "2026-09-24", NOW).unwrap().hash,
        day.hash
    );
    let existing = journal_day(&t.vault, None, "2026-09-23", NOW).unwrap();
    assert!(existing.text.contains("Talked to the team"));
    assert!(journal_day(&t.vault, None, "24.09.2026", NOW).is_err());
}

#[test]
fn saves_a_body_under_the_same_frontmatter_and_skips_no_op_saves() {
    let t = dev_vault();
    let path = "projects/photo-organiser/pages/photo-organiser-roadmap.md";
    let before = t.vault.read(path).unwrap();
    let body = frontmatter::split(&before.text).body;
    let Saved::Unchanged { .. } = save_body(&t.vault, path, body, &before.hash, NOW).unwrap()
    else {
        panic!("wrote an unchanged body")
    };
    assert_eq!(t.vault.read(path).unwrap().text, before.text);

    let saved = save_body(&t.vault, path, "New body\n", &before.hash, NOW).unwrap();
    let Saved::Written { note } = saved else {
        panic!("not written")
    };
    let prefix = frontmatter::split(&before.text).prefix;
    let expected = format!(
        "{}New body\n",
        frontmatter::set_key(prefix, "updated", Some("2026-09-24T08:00:00Z"), "\n")
    );
    assert_eq!(note.text, expected);
}

#[test]
fn keeps_both_versions_when_the_file_changed_on_disk() {
    let t = dev_vault();
    let path = "library/zettelkasten-method.md";
    let loaded = t.vault.read(path).unwrap();
    let outside = format!("{}Edited elsewhere.\n", loaded.text);
    fs::write(t.vault.path_of(path).unwrap(), &outside).unwrap();

    let Saved::Conflict { copy, note } =
        save_body(&t.vault, path, "Editor version\n", &loaded.hash, NOW).unwrap()
    else {
        panic!("no conflict")
    };
    assert_eq!(note.text, outside);
    assert_eq!(t.vault.read(path).unwrap().text, outside);
    assert_eq!(
        copy,
        "library/zettelkasten-method (conflict 2026-09-24 08-00).md"
    );
    let kept = t.vault.read(&copy).unwrap();
    assert!(kept.text.ends_with("Editor version\n"));
    assert!(kept.meta.title.ends_with("(conflict 2026-09-24 08-00)"));
    assert_ne!(kept.meta.id, loaded.meta.id);
}

#[test]
fn changes_header_keys_only() {
    let t = dev_vault();
    let path = "projects/photo-organiser/_project.md";
    let before = t.vault.read(path).unwrap();
    let after = set_meta(&t.vault, path, "icon", Some("🖼️"), NOW).unwrap();
    assert_eq!(after.meta.icon.as_deref(), Some("🖼️"));
    let expected = before.text.replace("icon: 📷", "icon: 🖼️").replace(
        "updated: 2026-09-23T09:40:00+02:00",
        "updated: 2026-09-24T08:00:00Z",
    );
    assert_eq!(after.text, expected);
    assert!(matches!(
        set_meta(&t.vault, path, "id", Some("X"), NOW),
        Err(Error::Invalid(_))
    ));
    for bad in ["x\u{1}", "a\nb", "\u{7f}"] {
        assert!(matches!(
            set_meta(&t.vault, path, "cover", Some(bad), NOW),
            Err(Error::Invalid(_))
        ));
    }
}

#[test]
fn searches_titles_and_bodies_and_finds_backlinks() {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    let hits = k.search("roadmap", 10).unwrap();
    assert_eq!(hits[0].title, "Photo organiser roadmap");
    let body = k.search("image hashes", 10).unwrap();
    assert!(
        body.iter()
            .any(|h| h.path == "journal/2026/2026-09-23.md" && h.snippet.contains("image")),
        "{body:?}"
    );
    assert!(k.search("   ", 10).unwrap().is_empty());

    let links = k
        .backlinks("projects/photo-organiser/pages/photo-organiser-roadmap.md")
        .unwrap();
    let paths: Vec<&str> = links.iter().map(|l| l.path.as_str()).collect();
    assert!(
        paths.contains(&"projects/photo-organiser/_project.md"),
        "{paths:?}"
    );
    assert!(paths.contains(&"journal/2026/2026-09-23.md"), "{paths:?}");
}

#[test]
fn fills_an_empty_page_from_a_template_without_losing_its_keys() {
    let t = dev_vault();
    let page = create_note(&t.vault, &new_page("Draft"), NOW).unwrap();
    let filled =
        kasten_core::apply_template(&t.vault, &page.meta.path, "paper", "2026-09-24", NOW).unwrap();
    assert_eq!(filled.meta.id, page.meta.id);
    assert_eq!(filled.meta.title, "Draft");
    assert_eq!(filled.meta.tags, vec!["paper"]);
    assert!(
        filled.text.contains("props:\n  status: Idea\n"),
        "{}",
        filled.text
    );
    assert!(!filled.text.contains("{{"));
    let body = frontmatter::split(&filled.text).body;
    assert!(!body.is_empty());
    // A page with text keeps it: templates only start empty pages.
    assert!(matches!(
        kasten_core::apply_template(&t.vault, &page.meta.path, "paper", "2026-09-24", NOW),
        Err(Error::Invalid(_))
    ));
}

#[cfg(unix)]
#[test]
fn a_save_keeps_the_note_s_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let t = dev_vault();
    let path = "library/zettelkasten-method.md";
    let file = t.vault.path_of(path).unwrap();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
    let loaded = t.vault.read(path).unwrap();
    save_body(&t.vault, path, "Private\n", &loaded.hash, NOW).unwrap();
    assert_eq!(
        fs::metadata(&file).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
