//! The words of a setup being saved: its icon, its one-line summary and the
//! manifest file that lists what it keeps (setup_save_plan.rs works out which).

use serde_json::{Map, Value};

use crate::error::{Error, Result};
use crate::frontmatter::yaml_scalar;
use crate::note::NoteMeta;

/// The most properties are kept, in bytes of JSON.
const MAX_PROPS_BYTES: usize = 10 * 1024;

fn plural(n: usize, one: &str, many: &str) -> String {
    format!("{n} {}", if n == 1 { one } else { many })
}

/// The emoji a setup shows: the project's, if it has one.
pub(super) fn icon_of(page: &NoteMeta) -> String {
    match page.icon.as_deref() {
        Some(icon)
            if !icon.is_empty()
                && icon.chars().count() <= 8
                && !icon.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') =>
        {
            icon.to_owned()
        }
        _ => "🗂️".to_owned(),
    }
}

pub(super) fn summary_of(pages: usize, tags: usize) -> String {
    match (pages, tags) {
        (0, 0) => "A project to start from, kept as it is.".to_owned(),
        (p, 0) => format!(
            "{} saved from one of your projects.",
            plural(p, "page", "pages")
        ),
        (0, t) => format!(
            "{} saved from one of your projects.",
            plural(t, "tag database", "tag databases")
        ),
        (p, t) => format!(
            "{} and {} saved from one of your projects.",
            plural(p, "page", "pages"),
            plural(t, "tag database", "tag databases")
        ),
    }
}

/// The manifest, written so a person can read and change it.
pub(super) fn manifest_text(
    title: &str,
    icon: &str,
    summary: &str,
    home: &str,
    props: &Map<String, Value>,
    pages: &[String],
    tags: &[String],
) -> Result<String> {
    let mut out = format!(
        "name: {}\nicon: {}\nsummary: {}\nhome: {}\n",
        yaml_scalar(title),
        yaml_scalar(icon),
        yaml_scalar(summary),
        yaml_scalar(home)
    );
    if !props.is_empty() {
        let json = serde_json::to_string(props).map_err(|e| Error::Invalid(e.to_string()))?;
        if json.len() > MAX_PROPS_BYTES {
            return Err(Error::Invalid(
                "The project's properties are too large to keep in a setup".to_owned(),
            ));
        }
        out.push_str(&format!("props: {json}\n"));
    }
    for (key, list) in [("pages", pages), ("tags", tags)] {
        if !list.is_empty() {
            out.push_str(&format!("{key}:\n"));
            for item in list {
                out.push_str(&format!("  - {}\n", yaml_scalar(item)));
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_icon_is_an_emoji_or_the_default() {
        let mut page = crate::note::meta_for("projects/a/_project.md", "---\ntitle: A\n---\n", 0);
        page.icon = Some("🎓".to_owned());
        assert_eq!(icon_of(&page), "🎓");
        page.icon = Some("folder".to_owned());
        assert_eq!(icon_of(&page), "🗂️");
        page.icon = None;
        assert_eq!(icon_of(&page), "🗂️");
    }

    #[test]
    fn the_manifest_lists_what_is_kept_and_refuses_huge_props() {
        let none = Map::new();
        let text = manifest_text(
            "Kit",
            "🗂️",
            &summary_of(1, 0),
            "pages/a.md",
            &none,
            &["pages/a.md".into()],
            &[],
        )
        .unwrap();
        assert!(
            text.starts_with("name: Kit\n") && text.contains("pages:\n  - pages/a.md\n"),
            "{text}"
        );
        assert!(
            !text.contains("tags:") && !text.contains("props:"),
            "{text}"
        );
        let mut big = Map::new();
        big.insert("k".into(), Value::String("x".repeat(MAX_PROPS_BYTES)));
        assert!(manifest_text("Kit", "🗂️", "s", "h", &big, &[], &[]).is_err());
    }
}
