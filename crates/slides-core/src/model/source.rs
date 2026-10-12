//! Where an element's content comes from: a page of the place the deck is edited in (a
//! Kasten page). The deck stays whole without it: what the page said when it was read is
//! kept (as the elements themselves, or as the Markdown an embedded page is drawn from), so
//! a deck opened somewhere that has no such page shows that, and exports without it.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Extra, is_false};

model! {
    /// What an element is of the page it came from.
    #[serde(rename_all = "camelCase")]
    pub enum SourceKind {
        /// A read-only view of the page, drawn from its Markdown (`markdown`).
        Embed,
        /// The words and pictures of the whole page, made into elements of the slide.
        Contents,
        /// The words and pictures of one section of the page (`section`), made into elements.
        Section,
        /// A link to the page, as words or as a card.
        Link,
    }

    /// A page of the host that an element was made from or points at.
    #[serde(rename_all = "camelCase")]
    pub struct PageSource {
        /// The page, as the host names pages (a vault path in Kasten, such as `projects/talk/plan.md`).
        pub page: String,
        /// How the page is told apart from others when the host has a stable name for it, so a moved page is found again.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub id: Option<String>,
        /// What the page was called when it was read.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub title: Option<String>,
        /// The page's icon (a glyph or an emoji) when it was read.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub icon: Option<String>,
        /// The heading whose section it is; the whole page when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub section: Option<String>,
        pub kind: SourceKind,
        /// Kept in step with the page: "Update from page" is on offer, and the host says when the page has changed.
        #[serde(default, skip_serializing_if = "is_false")]
        pub sync: bool,
        /// A fingerprint of the Markdown it was made from, to tell whether the page has changed since.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub hash: Option<String>,
        /// The Markdown of the page (or of the section) as it was read: what an embedded page is drawn from where the page cannot be read.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub markdown: Option<String>,
        #[serde(flatten, default, skip_serializing_if = "Extra::is_empty")]
        #[ts(skip)]
        #[schemars(skip)]
        pub extra: Extra,
    }
}

impl PageSource {
    /// A source for the page at `page`, made the way `kind` says, with nothing else known yet.
    pub fn new(page: impl Into<String>, kind: SourceKind) -> PageSource {
        PageSource {
            page: page.into(),
            id: None,
            title: None,
            icon: None,
            section: None,
            kind,
            sync: false,
            hash: None,
            markdown: None,
            extra: Extra::new(),
        }
    }

    /// What a person calls it: the title, else the file's name without its folder and its ending.
    pub fn name(&self) -> String {
        match self.title.as_deref().map(str::trim) {
            Some(title) if !title.is_empty() => title.to_owned(),
            _ => {
                let file = self.page.rsplit(['/', '\\']).next().unwrap_or(&self.page);
                file.strip_suffix(".md")
                    .unwrap_or(file)
                    .replace(['-', '_'], " ")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::model::{Base, Element};

    #[test]
    fn a_source_is_written_with_what_it_has_and_read_back() {
        let mut source = PageSource::new("library/plan.md", SourceKind::Section);
        source.section = Some("Risks".to_owned());
        source.sync = true;
        source.hash = Some("00ff".to_owned());
        let value = serde_json::to_value(&source).unwrap();
        assert_eq!(
            value,
            json!({"page": "library/plan.md", "section": "Risks", "kind": "section", "sync": true, "hash": "00ff"})
        );
        let back: PageSource = serde_json::from_value(value).unwrap();
        assert_eq!(back, source);
    }

    #[test]
    fn what_a_newer_build_wrote_in_a_source_survives() {
        let text = r#"{"page":"a.md","kind":"embed","pinned":{"at":3}}"#;
        let source: PageSource = serde_json::from_str(text).unwrap();
        assert_eq!(source.extra.get("pinned"), Some(&json!({"at": 3})));
        assert_eq!(serde_json::to_value(&source).unwrap()["pinned"]["at"], 3);
    }

    #[test]
    fn any_element_can_come_from_a_page_and_says_nothing_when_it_does_not() {
        let plain = Base::new("t-1");
        assert!(!serde_json::to_string(&plain).unwrap().contains("source"));
        let text = r#"{"type":"text","id":"t-1","x":0,"y":0,"w":10,"h":10,"text":{"paragraphs":[]},"source":{"page":"a.md","kind":"contents"}}"#;
        let element: Element = serde_json::from_str(text).unwrap();
        let source = element.base().source.as_ref().expect("a source");
        assert_eq!(
            (source.page.as_str(), source.kind.clone()),
            ("a.md", SourceKind::Contents)
        );
        assert_eq!(
            serde_json::to_value(&element).unwrap()["source"]["kind"],
            "contents"
        );
    }

    #[test]
    fn a_page_is_named_by_its_title_or_else_by_its_file() {
        let mut source = PageSource::new("projects/talk/q3-plan.md", SourceKind::Link);
        assert_eq!(source.name(), "q3 plan");
        source.title = Some("  Q3 plan ".to_owned());
        assert_eq!(source.name(), "Q3 plan");
        source.title = Some("   ".to_owned());
        assert_eq!(source.name(), "q3 plan");
    }
}
