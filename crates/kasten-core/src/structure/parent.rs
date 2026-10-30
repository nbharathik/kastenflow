//! Who may hold whom. Only a page holds pages, a page or a card goes inside
//! one, and a page never goes inside itself or one of its own sub-pages.
//! `nest_note_among` makes the same three checks as it moves files; they are
//! here as well so a request that cannot be done is refused before it waits
//! for review, and the sentences are the same everywhere.

use crate::error::{Error, Result};
use crate::moving::subtree;
use crate::note::NoteMeta;
use crate::vault::in_templates;

/// Whether `note` may go inside `parent` (none: out of its page), judged from
/// the metadata of every note.
pub fn check_nesting(notes: &[NoteMeta], note: &NoteMeta, parent: Option<&NoteMeta>) -> Result<()> {
    if !matches!(note.kind.as_str(), "page" | "card") || in_templates(&note.path) {
        return Err(Error::Invalid(format!(
            "A {} note cannot go inside a page",
            note.kind
        )));
    }
    let Some(holder) = parent else {
        return Ok(());
    };
    if holder.kind != "page" || in_templates(&holder.path) {
        return Err(Error::Invalid("Only a page holds pages".to_owned()));
    }
    if holder.path == note.path || subtree(notes, note).iter().any(|n| n.path == holder.path) {
        return Err(Error::Invalid(
            "A page cannot go inside itself or its own sub-page".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::note::meta_for;

    fn page(path: &str, id: &str, parent: Option<&str>) -> NoteMeta {
        let parent = parent.map_or(String::new(), |p| format!("parent: {p}\n"));
        meta_for(
            path,
            &format!("---\nid: {id}\ntitle: {id}\ntype: page\n{parent}---\n"),
            0,
        )
    }

    #[test]
    fn a_page_cannot_go_in_itself_or_below_itself() {
        let a = page("library/a.md", "A", None);
        let b = page("library/b.md", "B", Some("A"));
        let c = page("library/c.md", "C", Some("B"));
        let d = page("library/d.md", "D", None);
        let all = [a.clone(), b.clone(), c.clone(), d.clone()];
        for (note, into) in [(&a, &a), (&a, &b), (&a, &c), (&b, &c)] {
            let why = check_nesting(&all, note, Some(into))
                .unwrap_err()
                .to_string();
            assert!(why.contains("inside itself"), "{why}");
        }
        assert!(check_nesting(&all, &c, Some(&a)).is_ok());
        assert!(check_nesting(&all, &d, Some(&c)).is_ok());
        assert!(check_nesting(&all, &c, None).is_ok());
    }

    #[test]
    fn only_a_page_or_card_goes_in_and_only_a_page_holds() {
        let page_a = page("library/a.md", "A", None);
        let journal = meta_for("journal/2026/2026-09-23.md", "", 0);
        let card = meta_for("inbox/c.md", "", 0);
        let all = [page_a.clone(), journal.clone(), card.clone()];
        assert!(check_nesting(&all, &journal, Some(&page_a)).is_err());
        assert!(check_nesting(&all, &journal, None).is_err());
        assert!(check_nesting(&all, &card, Some(&page_a)).is_ok());
        assert!(check_nesting(&all, &page_a, Some(&card)).is_err());
        assert!(check_nesting(&all, &page_a, Some(&journal)).is_err());
    }
}
