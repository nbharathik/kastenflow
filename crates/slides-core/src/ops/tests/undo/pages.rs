//! The page actions of the property test: what a page says put on a slide, made again when the page changes, a page cut into
//! slides, a storyboard made into slides, and a slide kept as it is when its page moved on. Each means something on whatever deck
//! the run has reached; a slide made from a page is "the first element on any slide that has a source".

use serde_json::{Value, json};

use super::actions::Action;
use crate::model::Deck;
use crate::page::{StorySource, draft};

/// What a page may say: words and lists, a picture and a table, code with a formula and a callout, and almost nothing.
const PAGES: [&str; 5] = [
    "## Plan\n\nOne **idea** per card.\n\n- first\n  - nested\n- second\n",
    "# Title\n\nWords.\n\n![A cat](assets/cat.png)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## Next\n\nMore.\n",
    "```rust\nfn main() {}\n```\n\n$$\nx^2\n$$\n\n> [!tip] Careful\n> Mind the gap.\n",
    "Just words.",
    "- [ ] one\n- [x] two\n",
];

/// The pages as a storyboard drafts them, one of them with a picture from the web.
fn storyboard(n: u8) -> Value {
    let markdown = if n % 5 == 4 {
        "## Web\n\nSee this.\n\n![far](https://example.com/a.png)\n\n## Home\n\n![near](assets/a.png)\n"
    } else {
        PAGES[usize::from(n) % PAGES.len()]
    };
    let source = StorySource {
        page: "library/plan.md".to_owned(),
        id: None,
        title: Some("Plan".to_owned()),
        section: None,
        markdown: markdown.to_owned(),
    };
    let mut entries = draft(&source, if n.is_multiple_of(3) { 2 } else { 0 });
    // Every other storyboard is rewritten a little, which is no longer kept in step with its page.
    if n % 2 == 1
        && let Some(first) = entries.first_mut()
    {
        first.evidence.push("- added in the storyboard".to_owned());
    }
    json!(entries)
}

/// The first element on any slide that came from a page.
fn from_a_page(deck: &Deck) -> Option<(String, String)> {
    deck.slides.iter().find_map(|sl| {
        sl.elements
            .iter()
            .find(|e| e.base().source.is_some())
            .map(|e| (sl.id.clone(), e.id().to_owned()))
    })
}

/// The operation a page action stands for on this deck, if it names things that exist.
pub(super) fn plan(deck: &Deck, action: &Action) -> Option<(&'static str, Value)> {
    let slide = |i: usize| deck.slides.get(i % deck.slides.len().max(1));
    Some(match action {
        Action::PageContents { slide: s, n } => {
            let section = *n == 0;
            let source = if section {
                json!({ "page": "library/plan.md", "kind": "section", "section": "Plan", "sync": true })
            } else {
                json!({ "page": "library/plan.md", "kind": "contents" })
            };
            (
                "add_page_contents",
                json!({ "slide": slide(*s)?.id, "markdown": PAGES[usize::from(*n) % PAGES.len()], "source": source }),
            )
        }
        Action::PageUpdate { n } => {
            let (sl, e) = from_a_page(deck)?;
            (
                "update_page_contents",
                json!({ "slide": sl, "id": e, "markdown": PAGES[usize::from(*n) % PAGES.len()], "title": "Plan", "keepEdits": n % 2 == 0 }),
            )
        }
        Action::PageSlides { n } => (
            "add_page_slides",
            json!({ "markdown": PAGES[usize::from(*n) % PAGES.len()], "title": "A page", "split": if n % 2 == 0 { 0 } else { 2 } }),
        ),
        Action::Storyboard { n, after } => {
            let after = after
                .then(|| {
                    deck.slides
                        .get(usize::from(*n) % deck.slides.len().max(1))
                        .map(|s| s.id.clone())
                })
                .flatten();
            (
                "add_storyboard_slides",
                json!({ "entries": storyboard(*n), "after": after }),
            )
        }
        Action::Acknowledge { n } => {
            let (sl, e) = from_a_page(deck)?;
            (
                "acknowledge_source",
                json!({ "slide": sl, "id": e, "markdown": PAGES[usize::from(*n) % PAGES.len()] }),
            )
        }
        _ => return None,
    })
}
