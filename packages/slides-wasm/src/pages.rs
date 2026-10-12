//! Pages of the host: what the Markdown of a page holds, for the views that draw a page (an embedded page) and for a host
//! that lists the sections of a page. The Markdown comes from the host; nothing is read here.

use slides_core::page;
use wasm_bindgen::prelude::{JsValue, wasm_bindgen};

use super::json;

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
}
