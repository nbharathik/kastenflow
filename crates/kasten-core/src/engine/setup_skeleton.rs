//! A page as a setup keeps it: the page's own text, byte for byte, but for the
//! lines that name this one page and no other. Its `id` becomes a placeholder
//! (`{{id:p1}}`, a fresh id for each new project), its `parent` the placeholder
//! of the page it sits under when that page is kept too (else it goes), its
//! `created`, `updated`, `locked` and `children_order` go, and the project's
//! name in the body becomes `{{project}}`. The rest of the header, comments
//! and key order included, and the body as it is stay.

use crate::error::{Error, Result};
use crate::frontmatter::{join, set_key_raw, split, yaml_ok};
use crate::ops::eol_of;

/// The shortest project name that stands in for itself in a body: a shorter one
/// would be found inside other words.
const SHORTEST_NAME: usize = 3;

/// The beginnings of what a setup fills in when it is applied.
const FILLED: [&str; 5] = ["{{project}}", "{{slug}}", "{{date}}", "{{id:", "{{id8:"];

/// A placeholder as a quoted header value: `"{{id:p1}}"`.
fn quoted(name: &str) -> String {
    format!("\"{{{{id:{name}}}}}\"")
}

/// `text` as the skeleton of a page: `id` names its placeholder, `parent`
/// the placeholder of the page it sits under, and `project` the title of the
/// project it comes from. Refuses a page whose header cannot be read, since
/// a setup made of it would not be readable either.
pub(super) fn skeleton(
    text: &str,
    title: &str,
    id: &str,
    parent: Option<&str>,
    project: &str,
) -> Result<String> {
    // A setup fills these in when it is used and has no way to write one as
    // plain text, so a page that already has one would come out changed (a
    // `{{id:p1}}` in its text would turn into another page's id).
    if let Some(token) = FILLED.iter().find(|token| text.contains(**token)) {
        let token = if token.ends_with(':') {
            format!("{token}…}}}}")
        } else {
            (*token).to_owned()
        };
        return Err(Error::Invalid(format!(
            "“{title}” has the text {token} in it, which a setup fills in when it is used, so it cannot be kept in one as it is. Change that text or leave the page out"
        )));
    }
    let parts = split(text);
    if !yaml_ok(parts.prefix) {
        return Err(Error::Invalid(format!(
            "The header of “{title}” cannot be read, so it cannot be kept in a setup"
        )));
    }
    let eol = eol_of(text);
    let mut prefix = set_key_raw(parts.prefix, "id", Some(&quoted(id)), eol);
    prefix = match parent {
        Some(parent) => set_key_raw(&prefix, "parent", Some(&quoted(parent)), eol),
        None => set_key_raw(&prefix, "parent", None, eol),
    };
    for key in ["created", "updated", "locked", "children_order"] {
        prefix = set_key_raw(&prefix, key, None, eol);
    }
    let body = if project.chars().count() >= SHORTEST_NAME {
        parts.body.replace(project, "{{project}}")
    } else {
        parts.body.to_owned()
    };
    Ok(join(&prefix, &body, eol))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAGE: &str = "---\nid: 01ABC\ntitle: Intro # keep\ncreated: 2026-01-01T00:00:00Z\nupdated: 2026-01-02T00:00:00Z\nparent: 01DEF\nlocked: true\nchildren_order: [a, b]\nowner: me\n---\nAbout Thesis.\n";

    #[test]
    fn only_the_lines_that_name_the_page_change() {
        let out = skeleton(PAGE, "Intro", "p1", Some("p2"), "Thesis").unwrap();
        assert_eq!(
            out,
            "---\nid: \"{{id:p1}}\"\ntitle: Intro # keep\nparent: \"{{id:p2}}\"\nowner: me\n---\nAbout {{project}}.\n"
        );
        let out = skeleton(PAGE, "Intro", "p1", None, "Thesis").unwrap();
        assert!(!out.contains("parent"), "{out}");
    }

    #[test]
    fn line_ends_stay_and_a_page_with_no_header_gets_an_id() {
        let crlf = PAGE.replace('\n', "\r\n");
        let out = skeleton(&crlf, "Intro", "p1", None, "Thesis").unwrap();
        assert_eq!(
            out.matches("\r\n").count(),
            out.matches('\n').count(),
            "{out:?}"
        );
        assert!(out.ends_with("About {{project}}.\r\n"));
        let bare = skeleton("Just text.\n", "Bare", "p3", Some("p1"), "Thesis").unwrap();
        assert_eq!(
            bare,
            "---\nid: \"{{id:p3}}\"\nparent: \"{{id:p1}}\"\n---\nJust text.\n"
        );
    }

    #[test]
    fn a_page_that_already_has_a_placeholder_is_refused_by_name() {
        for token in [
            "{{project}}",
            "{{slug}}",
            "{{date}}",
            "{{id:p1}}",
            "{{id8:x}}",
        ] {
            let page = format!("---\ntitle: T\n---\nUse {token} here.\n");
            let err = skeleton(&page, "Notes", "p1", None, "Thesis")
                .unwrap_err()
                .to_string();
            assert!(
                err.contains("Notes") && err.contains("leave the page out"),
                "{err}"
            );
            // The header counts too.
            let page = format!("---\ntitle: \"{token}\"\n---\nbody\n");
            assert!(
                skeleton(&page, "Notes", "p1", None, "Thesis").is_err(),
                "{token}"
            );
        }
        // Braces that are not a placeholder are plain text.
        let ok = skeleton(
            "---\ntitle: T\n---\n{{ not one }} {id} {{other}}\n",
            "T",
            "p1",
            None,
            "Thesis",
        );
        assert!(ok.is_ok());
    }

    #[test]
    fn a_short_name_is_left_alone_and_a_broken_header_is_refused() {
        let out = skeleton("---\ntitle: T\n---\nIn Q3 we go.\n", "T", "p1", None, "Q3").unwrap();
        assert!(out.ends_with("In Q3 we go.\n"), "{out}");
        let err = skeleton(
            "---\ntitle: [oops\n---\nx\n",
            "Broken",
            "p1",
            None,
            "Thesis",
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("Broken"), "{err}");
    }
}
