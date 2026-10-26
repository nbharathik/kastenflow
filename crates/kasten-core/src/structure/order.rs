//! The order of a page's sub-pages. It is kept in the parent's frontmatter as
//! `children_order: [id, id, …]`, so it is one file that moves, syncs and is
//! undone with the page. A sub-page the list does not name comes after the
//! named ones, alphabetically; an id that is not a sub-page is ignored, so a
//! sub-page moved or trashed leaves nothing to clean up.

use std::cmp::Ordering;

use crate::error::Result;
use crate::frontmatter::{join, set_key_raw, split, still_readable, yaml_list};
use crate::note::NoteMeta;

/// The frontmatter key that holds the order.
pub const CHILDREN_ORDER: &str = "children_order";

/// Titles compared the way the sidebar lists them: ignoring case, then by path.
fn alphabetical(a: &NoteMeta, b: &NoteMeta) -> Ordering {
    a.title
        .to_lowercase()
        .cmp(&b.title.to_lowercase())
        .then_with(|| a.path.cmp(&b.path))
}

/// `children` as a reader shows them: those `stored` names, in that order
/// (an id twice counts once; an id that is none of them counts for nothing),
/// then the rest alphabetically.
pub fn arranged(stored: &[String], children: Vec<NoteMeta>) -> Vec<NoteMeta> {
    let mut rest = children;
    rest.sort_by(alphabetical);
    let mut out = Vec::with_capacity(rest.len());
    for id in stored {
        if let Some(at) = rest
            .iter()
            .position(|note| note.id.as_deref() == Some(id.as_str()))
        {
            out.push(rest.remove(at));
        }
    }
    out.extend(rest);
    out
}

/// The ids to store for a request to put `wanted` first: every sub-page that
/// has an id, in the order `arranged` shows them.
pub fn ordered_ids(wanted: &[String], children: Vec<NoteMeta>) -> Vec<String> {
    arranged(wanted, children)
        .into_iter()
        .filter_map(|note| note.id)
        .collect()
}

/// `text` with its `children_order` set to `ids` (the key is taken out for no
/// ids), touching only that key's lines; every other byte stays. None when the
/// file would not change.
pub fn order_text(text: &str, ids: &[String]) -> Result<Option<String>> {
    let parts = split(text);
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let list = (!ids.is_empty()).then(|| yaml_list(ids));
    let prefix = set_key_raw(parts.prefix, CHILDREN_ORDER, list.as_deref(), eol);
    if prefix == parts.prefix {
        return Ok(None);
    }
    still_readable(parts.prefix, &prefix)?;
    Ok(Some(join(&prefix, parts.body, eol)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::note::meta_for;

    fn kid(id: &str, title: &str) -> NoteMeta {
        meta_for(
            &format!("library/{id}.md"),
            &format!("---\nid: {id}\ntitle: {title}\n---\n"),
            0,
        )
    }

    fn titles(stored: &[&str], kids: &[NoteMeta]) -> Vec<String> {
        let stored: Vec<String> = stored.iter().map(|s| (*s).to_owned()).collect();
        arranged(&stored, kids.to_vec())
            .into_iter()
            .map(|n| n.title)
            .collect()
    }

    #[test]
    fn named_sub_pages_come_first_and_the_rest_alphabetically() {
        let kids = [kid("a", "Cherry"), kid("b", "banana"), kid("c", "Apple")];
        assert_eq!(titles(&[], &kids), ["Apple", "banana", "Cherry"]);
        assert_eq!(titles(&["a"], &kids), ["Cherry", "Apple", "banana"]);
        assert_eq!(
            titles(&["zz", "c", "c", "b"], &kids),
            ["Apple", "banana", "Cherry"]
        );
        assert_eq!(
            titles(&["b", "a", "c"], &kids),
            ["banana", "Cherry", "Apple"]
        );
    }

    #[test]
    fn a_sub_page_without_an_id_is_shown_but_cannot_be_stored() {
        let mut idless = kid("x", "Zed");
        idless.id = None;
        let kids = [kid("a", "Alpha"), idless];
        assert_eq!(titles(&[], &kids), ["Alpha", "Zed"]);
        assert_eq!(ordered_ids(&[], kids.to_vec()), ["a"]);
    }

    #[test]
    fn only_the_order_key_changes() {
        let text = "---\nid: P\n# c\nx: {a: 1}\n---\nBody\n";
        let ids = ["A".to_owned(), "B".to_owned()];
        let with = order_text(text, &ids).unwrap().unwrap();
        assert_eq!(
            with,
            "---\nid: P\n# c\nx: {a: 1}\nchildren_order: [A, B]\n---\nBody\n"
        );
        assert_eq!(order_text(&with, &ids).unwrap(), None);
        assert_eq!(order_text(&with, &[]).unwrap().unwrap(), text);
        assert_eq!(order_text(text, &[]).unwrap(), None);
    }
}
