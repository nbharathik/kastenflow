//! Pages of the host: what the Markdown of a page holds, for the views that draw a page (an embedded page) and for a host
//! that lists the sections of a page. The Markdown comes from the host; nothing is read here.

use serde::Deserialize;
use slides_core::page;
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

use super::{fail, json};

/// The blocks of a page's Markdown as JSON (`Block[]`): headings, paragraphs, list items, quotes, code, formulas, pictures,
/// tables and rules. Frontmatter is left off.
#[wasm_bindgen(js_name = pageBlocks)]
pub fn page_blocks(markdown: &str) -> Result<String, JsValue> {
    json(&page::blocks(markdown))
}

/// The headings of a page as JSON (`Section[]`), each with the lines it runs over.
#[wasm_bindgen(js_name = pageSections)]
pub fn page_sections(markdown: &str) -> Result<String, JsValue> {
    json(&page::sections(markdown))
}

/// The Markdown of the section under `heading` (found without regard to case), or nothing when there is none.
#[wasm_bindgen(js_name = pageSection)]
pub fn page_section(markdown: &str, heading: &str) -> Option<String> {
    page::section_markdown(markdown, heading)
}

/// What tells whether a page's words changed: the same for the same words, however the lines end.
#[wasm_bindgen(js_name = pageFingerprint)]
pub fn page_fingerprint(markdown: &str) -> String {
    page::fingerprint(markdown)
}

/// The page's Markdown without the frontmatter block at its top.
#[wasm_bindgen(js_name = pageBody)]
pub fn page_body(markdown: &str) -> String {
    page::strip_frontmatter(markdown).to_owned()
}

/// The address of a link to a page: `page:` and its path, then `#` and the heading for a section.
#[wasm_bindgen(js_name = pageLink)]
pub fn page_link(path: &str, section: Option<String>) -> String {
    page::page_link(path, section.as_deref())
}

/// What a storyboard is asked to draft: the page as the host read it, and how to cut it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftRequest {
    /// The page: where it is, its stable name and title if the host has them, and its whole Markdown.
    page: page::StorySource,
    /// The heading level to cut at (1 to 6); 0 or left out for the level that suits the page.
    #[serde(default)]
    split: u8,
    /// A page that is already cut into parts (by dividers): one entry for each, instead of cutting at headings.
    #[serde(default)]
    chunks: Option<Vec<page::StoryChunk>>,
}

/// A page drafted as a storyboard, as JSON (`StoryEntry[]`). The request is JSON: `{page: {page, id?, title?, markdown}, split?, chunks?}`.
#[wasm_bindgen(js_name = draftStoryboard)]
pub fn draft_storyboard(request: &str) -> Result<String, JsValue> {
    let request: DraftRequest = serde_json::from_str(request).map_err(|e| {
        fail(slides_core::Error::bad_input(
            "draft_storyboard",
            e.to_string(),
        ))
    })?;
    let entries = match &request.chunks {
        Some(chunks) => page::draft_chunks(&request.page, chunks),
        None => page::draft(&request.page, request.split),
    };
    json(&entries)
}

/// What an element made from a page says, as a fingerprint (`PageSource.made`): the element is JSON.
#[wasm_bindgen(js_name = pageMadeOf)]
pub fn page_made_of(element: &str) -> Result<String, JsValue> {
    let element: slides_core::model::Element = serde_json::from_str(element)
        .map_err(|e| fail(slides_core::Error::bad_input("page_made_of", e.to_string())))?;
    Ok(page::made_of(&element))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_is_read_into_blocks_sections_and_a_fingerprint() {
        let page = "---\ntitle: T\n---\n## One\n\nWords.\n\n- a\n";
        let blocks: serde_json::Value = serde_json::from_str(&page_blocks(page).unwrap()).unwrap();
        assert_eq!(blocks[0]["type"], "heading");
        assert_eq!(blocks[2]["type"], "item");
        let sections: serde_json::Value =
            serde_json::from_str(&page_sections(page).unwrap()).unwrap();
        assert_eq!(sections[0]["title"], "One");
        assert_eq!(
            page_section(page, "one").as_deref(),
            Some("## One\n\nWords.\n\n- a")
        );
        assert_eq!(
            page_fingerprint(page),
            page_fingerprint(&page.replace('\n', "\r\n"))
        );
        assert_eq!(page_body(page), "## One\n\nWords.\n\n- a\n");
        assert_eq!(
            page_link("library/my page.md", Some("A heading".into())),
            "page:library/my%20page.md#A%20heading"
        );
    }

    #[test]
    fn a_page_is_drafted_as_a_storyboard_by_headings_or_by_chunks() {
        let markdown = "## One\n\nA point. More.\n\n- a\n\n## Two\n\n- b\n";
        let request = serde_json::json!({ "page": { "page": "library/p.md", "title": "P", "markdown": markdown } });
        let entries: serde_json::Value =
            serde_json::from_str(&draft_storyboard(&request.to_string()).unwrap()).unwrap();
        assert_eq!(entries[0]["title"], "One");
        assert_eq!(entries[0]["point"], "A point.");
        assert_eq!(entries[0]["evidence"][0], "- a");
        assert_eq!(entries[0]["sources"][0]["section"], "One");
        assert_eq!(entries[1]["title"], "Two");
        let request = serde_json::json!({
            "page": { "page": "library/p.md", "markdown": markdown },
            "chunks": [{ "title": "Only", "markdown": "Words here." }],
        });
        let entries: serde_json::Value =
            serde_json::from_str(&draft_storyboard(&request.to_string()).unwrap()).unwrap();
        assert_eq!(entries.as_array().map(Vec::len), Some(1));
        assert_eq!(entries[0]["point"], "Words here.");
    }

    #[test]
    fn what_an_element_says_ignores_where_it_stands() {
        let at = |x: f64| {
            serde_json::json!({ "type": "text", "id": "e-1", "x": x, "y": 0, "w": 10, "h": 10, "text": { "paragraphs": [{ "runs": [{ "t": "hi" }] }] } })
                .to_string()
        };
        assert_eq!(
            page_made_of(&at(1.0)).unwrap(),
            page_made_of(&at(200.0)).unwrap()
        );
    }
}
