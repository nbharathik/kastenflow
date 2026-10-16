//! Tests for highlights on a captured web page, kept in a sidecar file beside
//! its card: the ops, the colours, the file travelling with its card, and the
//! guard that keeps a PDF's own highlights file out of reach.

use std::fs;

use crate::common::{self, NOW, dev_vault};
use crate::highlights::{SAMPLE, quote};
use kasten_core::comments::Anchor;
use kasten_core::history::Actor;
use kasten_core::sources::COLORS;
use kasten_core::text_highlights::{NewTextHighlight, TextAnchor, TextHighlightEdit};
use kasten_core::{Instant, Kasten};

const CARD: &str = "inbox/capture-ideas-here.md";
const SIDECAR: &str = "inbox/capture-ideas-here.highlights.json";
const WORDS: &str = "jot something down";

fn open() -> (common::TempVault, Kasten) {
    let t = dev_vault();
    let k = Kasten::open(t.vault.root()).unwrap();
    k.start_history().unwrap();
    (t, k)
}

fn anchor(quote: &str) -> TextAnchor {
    TextAnchor {
        quote: quote.to_owned(),
        prefix: Some("Press Ctrl+N anywhere to ".to_owned()),
        suffix: Some(". It lands in the inbox".to_owned()),
        section: None,
    }
}

fn new(quote: &str, color: &str) -> NewTextHighlight {
    NewTextHighlight {
        anchor: anchor(quote),
        color: color.to_owned(),
        comment: None,
    }
}

fn later(minutes: u64) -> Instant {
    Instant {
        millis: NOW.millis + minutes * 60_000,
    }
}

fn there(t: &common::TempVault, rel: &str) -> bool {
    t.vault.root().join(rel).is_file()
}

fn last(k: &Kasten) -> kasten_core::history::CommitInfo {
    k.log(None, 1).unwrap().remove(0)
}

#[test]
fn highlights_are_added_changed_moved_and_removed_one_commit_each() {
    let (t, k) = open();
    let h = Actor::Human;
    let card = k.read(CARD).unwrap();
    assert!(k.text_highlights(CARD).unwrap().is_empty());

    let mut with_comment = new(WORDS, "yellow");
    with_comment.comment = Some("  worth a card  ".to_owned());
    let added = k.add_text_highlight(&h, CARD, &with_comment, NOW).unwrap();
    assert!(added.id.starts_with("h-"));
    assert_eq!(added.comment.as_deref(), Some("worth a card"));
    let add_commit = last(&k);
    assert_eq!(
        add_commit.summary,
        "highlight: “jot something down” on Capture ideas here"
    );
    let text = fs::read_to_string(t.vault.root().join(SIDECAR)).unwrap();
    assert!(
        text.contains("\"format\": \"kasten-text-highlights\""),
        "{text}"
    );
    // The card's own bytes never change.
    assert_eq!(k.read(CARD).unwrap().text, card.text);

    // Recolour and drop the comment; the same edit again changes nothing.
    let edit = TextHighlightEdit {
        color: Some("blue".to_owned()),
        comment: Some(String::new()),
    };
    let edited = k
        .edit_text_highlight(&h, CARD, &added.id, &edit, later(1))
        .unwrap();
    assert_eq!((edited.color.as_str(), edited.comment), ("blue", None));
    assert_eq!(last(&k).summary, "highlight: edit on Capture ideas here");
    let before = last(&k).id;
    k.edit_text_highlight(&h, CARD, &added.id, &edit, later(2))
        .unwrap();
    assert_eq!(last(&k).id, before);

    // A new place after the card's words changed.
    let to = anchor("jot");
    let moved = k
        .move_text_highlight(&h, CARD, &added.id, &to, later(3))
        .unwrap();
    assert_eq!(moved.anchor, to);
    assert_eq!(last(&k).summary, "highlight: move on Capture ideas here");
    assert_eq!(k.text_highlights(CARD).unwrap()[0].anchor, to);

    // Removing takes it from the file; history keeps it, and Undo brings it back.
    k.remove_text_highlight(&h, CARD, &added.id, later(4))
        .unwrap();
    assert_eq!(
        last(&k).summary,
        "highlight: remove from Capture ideas here"
    );
    assert!(k.text_highlights(CARD).unwrap().is_empty());
    let kept = k.file_at(&add_commit.id, SIDECAR).unwrap().unwrap();
    assert!(kept.contains(WORDS), "{kept}");
    let remove_commit = last(&k).id;
    let undone = k.undo_commit(&remove_commit, NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert_eq!(k.text_highlights(CARD).unwrap()[0].id, added.id);
    assert_eq!(k.revision().annotations, 5);
}

#[test]
fn colours_are_the_pdf_colours_and_a_quote_is_needed() {
    let (_t, k) = open();
    for color in COLORS {
        k.add_text_highlight(&Actor::Human, CARD, &new(WORDS, color), NOW)
            .unwrap();
    }
    assert_eq!(k.text_highlights(CARD).unwrap().len(), COLORS.len());
    for bad in [new(WORDS, "orange"), new("   ", "yellow")] {
        assert!(
            k.add_text_highlight(&Actor::Human, CARD, &bad, NOW)
                .is_err()
        );
    }
    assert_eq!(k.text_highlights(CARD).unwrap().len(), COLORS.len());
    // Only a note in the vault.
    for path in ["inbox/nothing.md", ".trash/20260101T000000Z/inbox/x.md"] {
        assert!(
            k.add_text_highlight(&Actor::Human, path, &new(WORDS, "pink"), NOW)
                .is_err(),
            "{path}"
        );
    }
}

#[test]
fn a_cards_highlights_go_wherever_the_card_goes() {
    let (t, k) = open();
    let h = Actor::Human;
    let added = k
        .add_text_highlight(&h, CARD, &new(WORDS, "green"), NOW)
        .unwrap();

    // Filed as a page in the library.
    let page = k.convert_note(&h, CARD, "page", NOW).unwrap();
    assert_eq!(page.meta.path, "library/capture-ideas-here.md");
    assert!(!there(&t, SIDECAR));
    assert!(there(&t, "library/capture-ideas-here.highlights.json"));
    assert_eq!(k.text_highlights(&page.meta.path).unwrap()[0].id, added.id);
    let undone = k.undo_commit(&last(&k).id, NOW).unwrap();
    assert!(undone.conflict.is_none());
    assert!(there(&t, SIDECAR));
    assert!(!there(&t, "library/capture-ideas-here.highlights.json"));

    // Into a project and back to the inbox.
    let moved = k.move_note(&h, CARD, Some("photo-organiser")).unwrap();
    assert!(there(
        &t,
        "projects/photo-organiser/cards/capture-ideas-here.highlights.json"
    ));
    k.move_to_inbox(&h, &moved.meta.path).unwrap();
    assert!(there(&t, SIDECAR));

    // Trashed and restored, and copied.
    let trashed = k.trash(&h, CARD, NOW).unwrap();
    assert!(!there(&t, SIDECAR));
    assert!(there(&t, &trashed.replace(".md", ".highlights.json")));
    assert!(
        k.list_trash()
            .unwrap()
            .iter()
            .all(|x| !x.trashed.ends_with(".json"))
    );
    k.restore_trashed(&h, &trashed).unwrap();
    assert!(there(&t, SIDECAR));
    let copy = k.duplicate(&h, CARD, NOW).unwrap();
    assert!(there(
        &t,
        &copy.meta.path.replace(".md", ".highlights.json")
    ));
    assert_eq!(k.text_highlights(&copy.meta.path).unwrap()[0].id, added.id);
}

#[test]
fn a_note_beside_a_pdf_of_its_name_is_not_given_the_pdfs_highlights_file() {
    let (t, k) = open();
    let h = Actor::Human;
    let root = t.vault.root();
    // The PDF's highlights are in `sources/zettelkasten-primer.highlights.json`.
    let pdf_file = "sources/zettelkasten-primer.highlights.json";
    let pdf_bytes = fs::read(root.join(pdf_file)).unwrap();
    fs::write(
        root.join("sources/zettelkasten-primer.md"),
        "---\ntitle: Primer notes\ntype: page\n---\nSome words here.\n",
    )
    .unwrap();
    k.reindex().unwrap();

    // The note cannot be highlighted, and reads as having no highlights.
    let err = k
        .add_text_highlight(
            &h,
            "sources/zettelkasten-primer.md",
            &new("words", "pink"),
            NOW,
        )
        .unwrap_err();
    assert!(err.to_string().contains("PDF"), "{err}");
    assert!(
        k.text_highlights("sources/zettelkasten-primer.md")
            .unwrap()
            .is_empty()
    );
    assert_eq!(fs::read(root.join(pdf_file)).unwrap(), pdf_bytes);

    // Trashing, restoring and moving it leave the PDF's file where it is.
    let trashed = k.trash(&h, "sources/zettelkasten-primer.md", NOW).unwrap();
    assert_eq!(fs::read(root.join(pdf_file)).unwrap(), pdf_bytes);
    assert!(!there(&t, &trashed.replace(".md", ".highlights.json")));
    let back = k.restore_trashed(&h, &trashed).unwrap();
    assert_eq!(back.meta.path, "sources/zettelkasten-primer.md");
    let moved = k
        .move_note(&h, &back.meta.path, Some("photo-organiser"))
        .unwrap();
    assert!(moved.meta.path.starts_with("projects/photo-organiser/"));
    assert_eq!(fs::read(root.join(pdf_file)).unwrap(), pdf_bytes);
    assert!(!there(
        &t,
        &moved.meta.path.replace(".md", ".highlights.json")
    ));
    assert!(k.comment_problems().unwrap().is_empty());

    // The PDF's own highlights still work.
    let added = k
        .add_highlight(&h, SAMPLE, &quote("A new highlight in the PDF"), later(1))
        .unwrap();
    assert!(
        k.highlights(SAMPLE)
            .unwrap()
            .iter()
            .any(|x| x.id == added.id)
    );

    // And a copy of a note beside a PDF does not copy the PDF's file.
    fs::write(
        root.join("sources/paper-with-figures.md"),
        "---\ntitle: Figures\ntype: page\n---\nx\n",
    )
    .unwrap();
    k.reindex().unwrap();
    let copy = k
        .duplicate(&h, "sources/paper-with-figures.md", later(2))
        .unwrap();
    assert!(!there(
        &t,
        &copy.meta.path.replace(".md", ".highlights.json")
    ));
}

#[test]
fn agents_add_highlights_where_they_may_write_but_only_a_person_removes_them() {
    let (t, k) = open();
    let agent = Actor::Agent {
        client: "claude-code".to_owned(),
        session: "s1".to_owned(),
    };
    let added = k
        .add_text_highlight(&agent, CARD, &new(WORDS, "yellow"), NOW)
        .unwrap();
    let err = k
        .remove_text_highlight(&agent, CARD, &added.id, later(1))
        .unwrap_err();
    assert!(err.to_string().contains("person"), "{err}");
    assert_eq!(k.text_highlights(CARD).unwrap().len(), 1);

    let file = t.vault.path_of(CARD).unwrap();
    let text = fs::read_to_string(&file)
        .unwrap()
        .replacen("---\n", "---\nlocked: true\n", 1);
    fs::write(&file, text).unwrap();
    k.reindex().unwrap();
    let err = k
        .add_text_highlight(&agent, CARD, &new(WORDS, "pink"), later(2))
        .unwrap_err();
    assert!(err.to_string().contains("locked"), "{err}");
    k.remove_text_highlight(&Actor::Human, CARD, &added.id, later(3))
        .unwrap();
    assert!(k.text_highlights(CARD).unwrap().is_empty());
}

#[test]
fn a_cards_comments_and_highlights_are_separate_files_that_travel_together() {
    // The two sidecars of one page do not meet: a comment never lands in the highlights file.
    let (t, k) = open();
    let h = Actor::Human;
    k.add_text_highlight(&h, CARD, &new(WORDS, "yellow"), NOW)
        .unwrap();
    let a = Anchor {
        section: String::new(),
        nth: 1,
        quote: None,
        prefix: None,
        suffix: None,
    };
    let new_comment = kasten_core::comments::NewComment {
        anchor: a,
        text: "hm".to_owned(),
    };
    k.add_comment(&h, CARD, &new_comment, later(1)).unwrap();
    let highlights = fs::read_to_string(t.vault.root().join(SIDECAR)).unwrap();
    assert!(!highlights.contains("\"hm\""), "{highlights}");
    assert_eq!(k.comments(CARD).unwrap().len(), 1);
    assert_eq!(k.text_highlights(CARD).unwrap().len(), 1);
    // Both go with the card.
    k.convert_note(&h, CARD, "page", NOW).unwrap();
    assert!(there(&t, "library/capture-ideas-here.highlights.json"));
    assert!(there(&t, "library/capture-ideas-here.comments.json"));
}
