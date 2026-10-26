//! Saved setups under attack: names and paths that try to leave
//! `templates/setups/`, files a setup names that it may not, sizes, and
//! collisions. Renaming and deleting are in `setups_saved_manage`.

use std::fs;

use crate::change_sets::{open, snapshot};
use crate::common::NOW;
use crate::setups_saved::{DRAFT, PROJECT, RELATED, new, pages, read};
use kasten_core::Kasten;
use kasten_core::history::Actor;

fn save(k: &Kasten, slug: &str, title: &str, include: &[&str]) -> kasten_core::SavedSetup {
    k.save_project_setup(&Actor::Human, PROJECT, slug, title, &pages(include), NOW)
        .unwrap()
}

#[test]
fn a_name_in_use_gets_a_number_and_the_first_stays_as_it_was() {
    let (t, k, _s) = open();
    let first = save(&k, "", "Study kit", &[DRAFT]);
    let text = read(t.vault.root(), "templates/setups/study-kit.yaml");
    let second = save(&k, "", "Study kit", &[RELATED]);
    let third = save(&k, "study-kit", "Another", &[]);
    assert_eq!(
        (
            first.slug.as_str(),
            second.slug.as_str(),
            third.slug.as_str()
        ),
        ("study-kit", "study-kit-2", "study-kit-3")
    );
    assert_eq!(second.id, "saved:study-kit-2");
    assert_eq!(
        read(t.vault.root(), "templates/setups/study-kit.yaml"),
        text
    );
    assert!(
        t.vault
            .root()
            .join("templates/setups/study-kit-2/pages/related-work-notes.md")
            .is_file()
    );
    // A folder left over by hand counts as taken too.
    fs::create_dir_all(t.vault.root().join("templates/setups/left-over")).unwrap();
    assert_eq!(save(&k, "left-over", "Left over", &[]).slug, "left-over-2");
}

#[test]
fn a_slug_that_is_a_path_or_not_a_plain_name_is_refused_and_nothing_is_written() {
    let (t, k, _s) = open();
    let before = snapshot(t.vault.root());
    let long = "a".repeat(100);
    for slug in [
        "../x",
        "..",
        ".",
        "a/b",
        "a\\b",
        "x.yaml",
        "con",
        "UPPER",
        ".hidden",
        "a b",
        "é/..",
        "templates/setups/x",
        "x:y",
        "x\0",
        long.as_str(),
    ] {
        let err = k
            .save_project_setup(&Actor::Human, PROJECT, slug, "Kit", &[], NOW)
            .unwrap_err()
            .to_string();
        assert!(err.contains("file name"), "{slug:?}: {err}");
    }
    assert_eq!(snapshot(t.vault.root()), before);
    assert!(!t.vault.root().join("templates/setups").exists());
}

#[test]
fn a_name_is_one_line_of_text_of_a_sensible_length() {
    let (t, k, _s) = open();
    let before = snapshot(t.vault.root());
    let long = "x".repeat(101);
    for title in [
        "",
        "   ",
        "two\nlines",
        "tab\there",
        "\u{7}bell",
        long.as_str(),
    ] {
        assert!(
            k.save_project_setup(&Actor::Human, PROJECT, "", title, &[], NOW)
                .is_err(),
            "{title:?}"
        );
    }
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn pages_outside_the_project_or_that_are_not_pages_are_refused_whole() {
    let (t, k, _s) = open();
    fs::write(
        t.vault
            .root()
            .join("projects/note-taking-study/pages/broken.md"),
        "---\ntitle: [oops\n---\nbody\n",
    )
    .unwrap();
    k.reindex().unwrap();
    let before = snapshot(t.vault.root());
    for path in [
        "",
        "../../outside.md",
        "projects/note-taking-study/pages/../../../x.md",
        "/etc/passwd.md",
        "projects\\note-taking-study\\pages\\report-draft.md",
        "projects/photo-organiser/pages/photo-organiser-roadmap.md",
        "projects/PHOTO-organiser/pages/photo-organiser-roadmap.md",
        "projects/note-taking-study/_project.md",
        "templates/journal.md",
        "library/welcome-to-kasten.md",
        ".trash/x/a.md",
        ".git/config",
        "projects/note-taking-study/pages/missing.md",
        "projects/note-taking-study/pages/report-draft.txt",
        "projects/note-taking-study/pages/broken.md",
        "projects/note-taking-study/boards",
    ] {
        // One good page and one bad one: the whole save is refused.
        let err = k
            .save_project_setup(
                &Actor::Human,
                PROJECT,
                "",
                "Kit",
                &pages(&[DRAFT, path]),
                NOW,
            )
            .unwrap_err();
        assert!(!err.to_string().is_empty(), "{path:?}");
    }
    assert_eq!(snapshot(t.vault.root()), before);
    // A page named twice is saved once.
    let twice = save(&k, "", "Twice", &[DRAFT, DRAFT]);
    assert_eq!(
        twice
            .written
            .iter()
            .filter(|p| p.ends_with("report-draft.md"))
            .count(),
        1
    );
}

#[test]
fn a_page_that_went_since_the_dialog_was_opened_stops_the_save() {
    let (t, k, _s) = open();
    let source = k.preview_project_setup(PROJECT).unwrap();
    assert!(source.pages.iter().any(|p| p.path == DRAFT));
    k.trash(&Actor::Human, DRAFT, NOW).unwrap();
    let before = snapshot(t.vault.root());
    let err = k
        .save_project_setup(
            &Actor::Human,
            PROJECT,
            "",
            "Kit",
            &pages(&[DRAFT, RELATED]),
            NOW,
        )
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("no longer") || err.contains("not there"),
        "{err}"
    );
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn a_page_too_large_or_too_many_pages_are_refused() {
    let (t, k, _s) = open();
    let big = "projects/note-taking-study/pages/big.md";
    fs::write(
        t.vault.root().join(big),
        format!(
            "---\ntitle: Big\ntype: page\n---\n{}\n",
            "word ".repeat(30_000)
        ),
    )
    .unwrap();
    k.reindex().unwrap();
    let err = k
        .save_project_setup(&Actor::Human, PROJECT, "", "Kit", &pages(&[big]), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("too large"), "{err}");
    fs::remove_file(t.vault.root().join(big)).unwrap();
    let mut many = Vec::new();
    for n in 0..61 {
        let path = format!("projects/note-taking-study/pages/many-{n:02}.md");
        fs::write(
            t.vault.root().join(&path),
            format!("---\ntitle: Many {n}\ntype: page\n---\nx\n"),
        )
        .unwrap();
        many.push(path);
    }
    k.reindex().unwrap();
    let err = k
        .save_project_setup(&Actor::Human, PROJECT, "", "Kit", &many, NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("60"), "{err}");
    assert!(
        k.save_project_setup(&Actor::Human, PROJECT, "", "Kit", &many[..60], NOW)
            .is_ok()
    );
}

#[test]
fn a_hand_written_setup_cannot_name_a_file_outside_its_folder_or_the_new_project() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    fs::create_dir_all(root.join("templates/setups")).unwrap();
    let bad_pages = [
        "../../outside.md",
        "pages/../../x.md",
        "/abs.md",
        "pages\\x.md",
        "pages/.hidden.md",
        "pages/_project.md",
        "pages/a/b.md",
        "pages/x.txt",
        "boards/x.canvas",
        "tags/x.yaml",
        "pages/CON.md",
        "pages/",
        "",
    ];
    for entry in bad_pages {
        let yaml = format!(
            "name: Evil\nicon: x\nsummary: s\nhome: pages/a.md\npages:\n  - {}\n",
            serde_json::to_string(entry).unwrap()
        );
        fs::write(root.join("templates/setups/evil.yaml"), yaml).unwrap();
        let before = snapshot(root);
        let listed = k.list_setups().unwrap();
        let evil = listed
            .iter()
            .find(|s| s.id == "saved:evil")
            .expect("listed");
        assert!(evil.files.is_empty(), "{entry:?}: {:?}", evil.files);
        for run in [
            k.preview_setup("saved:evil", &new("Victim")).map(|_| ()),
            k.apply_setup(&Actor::Human, "saved:evil", &new("Victim"), NOW)
                .map(|_| ()),
        ] {
            let err = run.expect_err(entry).to_string();
            assert!(err.contains("evil"), "{entry:?}: {err}");
        }
        assert_eq!(snapshot(root), before, "{entry:?}");
    }
    for tag in [
        "../../.git/config",
        "a/b",
        "UPPER",
        "",
        ".hidden",
        "x.yaml",
        "con",
    ] {
        let yaml = format!(
            "name: Evil\nicon: x\nsummary: s\nhome: _project.md\ntags:\n  - {}\n",
            serde_json::to_string(tag).unwrap()
        );
        fs::write(root.join("templates/setups/evil.yaml"), yaml).unwrap();
        let before = snapshot(root);
        let err = k
            .apply_setup(&Actor::Human, "saved:evil", &new("Victim"), NOW)
            .unwrap_err()
            .to_string();
        assert!(err.contains("evil"), "{tag:?}: {err}");
        assert_eq!(snapshot(root), before, "{tag:?}");
    }
    // A home that leaves the project folder is not followed either.
    for home in ["../../x.md", "/x.md", "pages/../../x.md"] {
        fs::write(
            root.join("templates/setups/evil.yaml"),
            format!("name: Evil\nhome: {home}\n"),
        )
        .unwrap();
        assert!(
            k.apply_setup(&Actor::Human, "saved:evil", &new("Victim"), NOW)
                .is_err(),
            "{home}"
        );
    }
    assert!(!root.join("projects/victim").exists());
}

/// A page of a setup that is a link is not followed: what it points at is not read.
#[cfg(unix)]
#[test]
fn a_skeleton_that_is_a_link_is_never_followed() {
    use std::os::unix::fs::symlink;
    let (t, k, _s) = open();
    let root = t.vault.root();
    let outside = std::env::temp_dir().join(format!("kasten-secret-{}.md", std::process::id()));
    fs::write(&outside, "---\ntitle: Secret\n---\nnot for the vault\n").unwrap();
    fs::create_dir_all(root.join("templates/setups/linked/pages")).unwrap();
    symlink(&outside, root.join("templates/setups/linked/pages/a.md")).unwrap();
    fs::write(
        root.join("templates/setups/linked.yaml"),
        "name: Linked\nhome: pages/a.md\npages:\n  - pages/a.md\n",
    )
    .unwrap();
    let err = k
        .apply_setup(&Actor::Human, "saved:linked", &new("Victim"), NOW)
        .unwrap_err()
        .to_string();
    assert!(!err.is_empty());
    assert!(!root.join("projects/victim").exists());
    let _ = fs::remove_file(&outside);
}

#[test]
fn a_setup_id_cannot_be_a_path() {
    let (t, k, _s) = open();
    let before = snapshot(t.vault.root());
    for id in [
        "saved:",
        "saved:../x",
        "saved:a/b",
        "saved:A",
        "saved:a b",
        "saved:..",
        "saved:x.yaml",
        "saved:\\x",
        "x",
    ] {
        let err = k.preview_setup(id, &new("T")).unwrap_err().to_string();
        assert!(err.contains("There is no setup"), "{id}: {err}");
        assert!(
            k.apply_setup(&Actor::Human, id, &new("T"), NOW).is_err(),
            "{id}"
        );
    }
    assert_eq!(snapshot(t.vault.root()), before);
}

#[test]
fn a_skeleton_file_over_the_limit_is_not_applied() {
    let (t, k, _s) = open();
    let root = t.vault.root();
    fs::create_dir_all(root.join("templates/setups/huge/pages")).unwrap();
    fs::write(
        root.join("templates/setups/huge.yaml"),
        "name: Huge\nhome: pages/big.md\npages:\n  - pages/big.md\n",
    )
    .unwrap();
    fs::write(
        root.join("templates/setups/huge/pages/big.md"),
        "x".repeat(200_000),
    )
    .unwrap();
    let before = snapshot(root);
    let err = k
        .apply_setup(&Actor::Human, "saved:huge", &new("Victim"), NOW)
        .unwrap_err()
        .to_string();
    assert!(err.contains("too large"), "{err}");
    assert_eq!(snapshot(root), before);
}
