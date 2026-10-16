use std::fs;

use super::*;
use crate::rollback::Rollback;

fn vault() -> (std::path::PathBuf, Vault) {
    let dir = std::env::temp_dir().join(format!(
        "kasten-companions-{}",
        crate::ulid_at(crate::Instant::now().millis)
    ));
    fs::create_dir_all(dir.join("sources")).unwrap();
    fs::create_dir_all(dir.join("library")).unwrap();
    (dir.clone(), Vault::open(dir).unwrap())
}

#[test]
fn names_the_sidecars_of_a_page_and_the_page_of_a_sidecar() {
    assert_eq!(
        of("projects/x/pages/p.md", COMMENTS).as_deref(),
        Some("projects/x/pages/p.comments.json")
    );
    assert_eq!(of("a.md", HIGHLIGHTS).as_deref(), Some("a.highlights.json"));
    assert_eq!(of("a.canvas", COMMENTS), None);
    assert_eq!(of(".md", COMMENTS), None);
    assert_eq!(
        note_of("projects/x/pages/p.comments.json").as_deref(),
        Some("projects/x/pages/p.md")
    );
    assert_eq!(note_of("p.highlights.json").as_deref(), Some("p.md"));
    assert_eq!(note_of("p.json"), None);
    assert!(is_companion("a/b.comments.json"));
    assert!(is_companion("a/b.highlights.json"));
    assert!(!is_companion("a/b.json"));
}

#[test]
fn finds_only_the_sidecars_that_are_there() {
    let (dir, vault) = vault();
    fs::write(dir.join("library/a.md"), "x").unwrap();
    assert!(existing(&vault, "library/a.md").is_empty());
    fs::write(dir.join("library/a.comments.json"), "{}").unwrap();
    assert_eq!(
        existing(&vault, "library/a.md"),
        ["library/a.comments.json"]
    );
    fs::write(dir.join("library/a.highlights.json"), "{}").unwrap();
    assert_eq!(existing(&vault, "library/a.md").len(), 2);
    assert!(name_taken(&vault, "library/a.md"));
    assert!(!name_taken(&vault, "library/b.md"));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_pdf_s_highlights_file_is_not_a_note_s() {
    let (dir, vault) = vault();
    fs::write(dir.join("sources/paper.pdf"), "%PDF-1.4").unwrap();
    fs::write(dir.join("sources/paper.highlights.json"), "{}").unwrap();
    fs::write(dir.join("sources/paper.md"), "x").unwrap();
    assert!(pdf_owns_highlights(&vault, "sources/paper.md"));
    // The PDF's file stays with the PDF, and does not stand in the note's way.
    assert!(existing(&vault, "sources/paper.md").is_empty());
    assert!(!name_taken(&vault, "sources/paper.md"));
    // A note elsewhere, or beside no PDF, owns its own.
    fs::write(dir.join("sources/other.md"), "x").unwrap();
    fs::write(dir.join("sources/other.highlights.json"), "{}").unwrap();
    assert!(!pdf_owns_highlights(&vault, "sources/other.md"));
    assert_eq!(
        existing(&vault, "sources/other.md"),
        ["sources/other.highlights.json"]
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn carries_sidecars_to_the_new_name_and_never_over_a_file() {
    let (dir, vault) = vault();
    fs::write(dir.join("library/a.md"), "x").unwrap();
    fs::write(dir.join("library/a.comments.json"), "{\"comments\": []}").unwrap();
    let mut done = Rollback::default();
    let moved = carry(
        &vault,
        &[("library/a.md".to_owned(), "library/b.md".to_owned())],
        &mut done,
    )
    .unwrap();
    assert_eq!(
        moved,
        [(
            "library/a.comments.json".to_owned(),
            "library/b.comments.json".to_owned()
        )]
    );
    assert!(!dir.join("library/a.comments.json").exists());
    assert!(dir.join("library/b.comments.json").is_file());
    // Put back, as a failed op does.
    done.put_back();
    assert!(dir.join("library/a.comments.json").is_file());
    assert!(!dir.join("library/b.comments.json").exists());

    // A file at the new name stops the move before anything moves.
    fs::write(dir.join("library/c.comments.json"), "other").unwrap();
    let mut done = Rollback::default();
    let refused = carry(
        &vault,
        &[("library/a.md".to_owned(), "library/c.md".to_owned())],
        &mut done,
    );
    assert!(refused.is_err());
    assert!(dir.join("library/a.comments.json").is_file());
    assert_eq!(
        fs::read_to_string(dir.join("library/c.comments.json")).unwrap(),
        "other"
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn copies_sidecars_for_a_copied_page() {
    let (dir, vault) = vault();
    fs::write(dir.join("library/a.md"), "x").unwrap();
    fs::write(dir.join("library/a.comments.json"), "{\"comments\": []}").unwrap();
    let mut done = Rollback::default();
    let made = copy_for(&vault, "library/a.md", "library/a-2.md", &mut done).unwrap();
    assert_eq!(made, ["library/a-2.comments.json"]);
    assert!(dir.join("library/a.comments.json").is_file());
    assert_eq!(
        fs::read_to_string(dir.join("library/a-2.comments.json")).unwrap(),
        "{\"comments\": []}"
    );
    fs::remove_dir_all(dir).unwrap();
}
