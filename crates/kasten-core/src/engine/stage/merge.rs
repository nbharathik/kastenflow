//! Putting a staged note together with the same note changed since: the
//! frontmatter and the body are merged apart, so a person's edit to one
//! section and a staged edit to another both land, and `updated`, which every
//! edit moves, is never a clash.

use crate::frontmatter::{join, set_key, split};
use crate::merge::merge3;
use crate::ops::eol_of;

/// `staged` and `current`, both changed from `base`, as one text; None when
/// they changed the same lines differently. `stamp` is the time the result
/// is written, which becomes its `updated` when the frontmatter was merged.
pub(super) fn merge_note(base: &str, staged: &str, current: &str, stamp: &str) -> Option<String> {
    let (b, s, c) = (split(base), split(staged), split(current));
    let eol = eol_of(current);
    let body = pick(b.body, s.body, c.body, merge3)?;
    let prefix = pick(b.prefix, s.prefix, c.prefix, |base, staged, current| {
        merge_front(base, staged, current, stamp, eol)
    })?;
    Some(join(&prefix, &body, eol))
}

/// Which side's text a part is, when only one changed it; else `merge`.
fn pick(
    base: &str,
    staged: &str,
    current: &str,
    merge: impl FnOnce(&str, &str, &str) -> Option<String>,
) -> Option<String> {
    if staged == base {
        return Some(current.to_owned());
    }
    if current == base || current == staged {
        return Some(staged.to_owned());
    }
    merge(base, staged, current)
}

/// Frontmatter merged without its `updated` line, which then says `stamp`.
fn merge_front(base: &str, staged: &str, current: &str, stamp: &str, eol: &str) -> Option<String> {
    let bare = |front: &str| set_key(front, "updated", None, eol);
    let merged = merge3(&bare(base), &bare(staged), &bare(current))?;
    Some(set_key(&merged, "updated", Some(stamp), eol))
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str =
        "---\ntitle: A\nupdated: 2026-10-01T00:00:00Z\n---\n## One\n\nx\n\n## Two\n\ny\n";

    #[test]
    fn edits_to_different_sections_both_land() {
        let staged = BASE
            .replace("x\n", "x\nstaged\n")
            .replace("00:00:00Z", "00:00:05Z");
        let current = BASE
            .replace("y\n", "y\ntheirs\n")
            .replace("00:00:00Z", "00:00:09Z");
        let merged = merge_note(BASE, &staged, &current, "2026-10-02T00:00:00Z").unwrap();
        assert!(merged.contains("x\nstaged\n") && merged.contains("y\ntheirs\n"));
        assert!(merged.contains("updated: 2026-10-02T00:00:00Z"), "{merged}");
    }

    #[test]
    fn the_same_lines_changed_differently_do_not_merge() {
        let staged = BASE.replace("x\n", "ours\n");
        let current = BASE.replace("x\n", "theirs\n");
        assert_eq!(merge_note(BASE, &staged, &current, "t"), None);
    }

    #[test]
    fn a_staged_tag_survives_a_body_edit_made_meanwhile() {
        let staged = BASE.replace("title: A\n", "title: A\ntags: [t]\n");
        let current = BASE
            .replace("y\n", "y\nmore\n")
            .replace("00:00:00Z", "00:00:09Z");
        let merged = merge_note(BASE, &staged, &current, "2026-10-02T00:00:00Z").unwrap();
        assert!(
            merged.contains("tags: [t]") && merged.contains("y\nmore\n"),
            "{merged}"
        );
    }
}
