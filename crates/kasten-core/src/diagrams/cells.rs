//! The elements of a diagram, by id, for telling how much a rewrite takes
//! out: an agent's change that drops a large part of what a person drew
//! waits for review. The ids are the `id` of every `mxCell`, `object` and
//! `UserObject` tag, so a diagram laid out again with the same ids is the same
//! diagram, and one written again with new ids has lost everything. The text
//! is already known to be well formed (`check_xml`); this reads tags only.

use std::collections::BTreeSet;

/// The ids of the cells of the diagram in `xml`, on every page.
pub fn cell_ids(xml: &str) -> BTreeSet<String> {
    let bytes = xml.as_bytes();
    let mut ids = BTreeSet::new();
    let mut at = 0;
    while let Some(open) = xml[at..].find('<') {
        let start = at + open;
        let name_end = xml[start + 1..]
            .find(|c: char| c.is_whitespace() || c == '>' || c == '/')
            .map_or(xml.len(), |n| start + 1 + n);
        let name = &xml[start + 1..name_end];
        // The tag ends at the first `>` outside quotes (an attribute may hold one).
        let mut end = name_end;
        let mut quote = 0u8;
        while end < bytes.len() {
            let b = bytes[end];
            if quote != 0 {
                if b == quote {
                    quote = 0;
                }
            } else if b == b'"' || b == b'\'' {
                quote = b;
            } else if b == b'>' {
                break;
            }
            end += 1;
        }
        if matches!(name, "mxCell" | "object" | "UserObject")
            && let Some(id) = attribute(&xml[name_end..end.min(xml.len())], "id")
        {
            ids.insert(id);
        }
        at = end.saturating_add(1).min(xml.len());
        if at >= xml.len() {
            break;
        }
    }
    ids
}

/// The value of attribute `name` in the text of a tag after its name.
fn attribute(tag: &str, name: &str) -> Option<String> {
    let mut rest = tag;
    while let Some(eq) = rest.find('=') {
        let key = rest[..eq].trim_end().rsplit(char::is_whitespace).next()?;
        let after = rest[eq + 1..].trim_start();
        let quote = after.chars().next().filter(|c| *c == '"' || *c == '\'')?;
        let value_end = after[1..].find(quote)?;
        if key == name {
            return Some(after[1..1 + value_end].to_owned());
        }
        rest = &after[value_end + 2..];
    }
    None
}

/// How many of the cells of `old` are gone from `new`, and how many `old` had.
pub fn removed_cells(old: &str, new: &str) -> (usize, usize) {
    let before = cell_ids(old);
    let after = cell_ids(new);
    (before.difference(&after).count(), before.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONE: &str = "<mxfile><diagram id=\"p1\" name=\"Page-1\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/><mxCell id=\"a\" value=\"A &gt; B\" vertex=\"1\" parent=\"1\"><mxGeometry x=\"1\" as=\"geometry\"/></mxCell></root></mxGraphModel></diagram></mxfile>";

    #[test]
    fn the_ids_of_cells_on_every_page_are_found_and_nothing_else() {
        let ids: Vec<String> = cell_ids(ONE).into_iter().collect();
        // The page's own id is not a cell.
        assert_eq!(ids, ["0", "1", "a"]);
        let two = "<mxfile><diagram id=\"p1\"><mxGraphModel><root><mxCell id=\"0\"/></root></mxGraphModel></diagram><diagram id=\"p2\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"x\"/></root></mxGraphModel></diagram></mxfile>";
        assert_eq!(cell_ids(two).len(), 2);
    }

    #[test]
    fn a_cell_in_a_wrapper_is_named_by_the_wrapper() {
        let xml = "<mxfile><diagram><mxGraphModel><root><mxCell id=\"0\"/><UserObject label=\"x\" link=\"https://a.example/?q=1&amp;r=2\" id=\"u1\"><mxCell style=\"s\" vertex=\"1\"/></UserObject><object id=\"o1\" label=\"y\"><mxCell vertex=\"1\"/></object></root></mxGraphModel></diagram></mxfile>";
        let ids: Vec<String> = cell_ids(xml).into_iter().collect();
        assert_eq!(ids, ["0", "o1", "u1"]);
    }

    #[test]
    fn quotes_and_spacing_do_not_matter_and_a_greater_than_sign_in_a_value_does_not_end_a_tag() {
        let xml = "<mxfile><diagram><mxGraphModel><root>\n<mxCell\n   value='a > b'\n   id = 'q1' />\n<mxCell value=\"x\" id=\"q2\"></mxCell></root></mxGraphModel></diagram></mxfile>";
        let ids: Vec<String> = cell_ids(xml).into_iter().collect();
        assert_eq!(ids, ["q1", "q2"]);
    }

    #[test]
    fn what_a_rewrite_took_out_is_counted_by_id_whatever_the_layout_of_the_text() {
        let smaller = "<mxfile><diagram><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/></root></mxGraphModel></diagram></mxfile>";
        assert_eq!(removed_cells(ONE, smaller), (1, 3));
        // The same cells, written on one line or many, with more added: nothing is gone.
        let more = format!(
            "{}\n",
            ONE.replace('>', ">\n")
                .replace("</root>", "<mxCell id=\"b\"/></root>")
        );
        assert_eq!(removed_cells(ONE, &more), (0, 3));
        // Written again under new ids: everything is gone.
        assert_eq!(
            removed_cells(
                ONE,
                &ONE.replace("id=\"a\"", "id=\"z\"")
                    .replace("id=\"1\"", "id=\"9\"")
                    .replace("id=\"0\"", "id=\"8\"")
            ),
            (3, 3)
        );
        assert_eq!(removed_cells("<mxfile/>", ONE), (0, 0));
    }
}
