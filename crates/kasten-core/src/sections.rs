//! Sections of a note's body: the lines under a heading, up to the next
//! heading of the same or a higher level. Agents add to a section or
//! replace one instead of rewriting a whole note (the MCP tools
//! `append` and `replace_section`).

use crate::error::{Error, Result};
use crate::extract::{Heading, extract};

fn eol_of(body: &str) -> &'static str {
    if body.contains("\r\n") { "\r\n" } else { "\n" }
}

/// The heading named `heading` (any level, `#` marks and case ignored) and
/// the line where its section ends (the next heading at its level or above,
/// or the end of the body).
fn find(body: &str, heading: &str) -> Result<(Heading, Option<usize>)> {
    let headings = extract(body).headings;
    let wanted = heading.trim().trim_start_matches('#').trim().to_lowercase();
    let at = headings
        .iter()
        .position(|h| h.text.to_lowercase() == wanted)
        .ok_or_else(|| Error::Invalid(format!("No heading “{}” in this note", heading.trim())))?;
    let level = headings[at].level;
    let end = headings[at + 1..]
        .iter()
        .find(|h| h.level <= level)
        .map(|h| h.line);
    Ok((headings[at].clone(), end))
}

/// The text of the section under `heading`, without the heading line.
pub fn section_text(body: &str, heading: &str) -> Result<String> {
    let (found, end) = find(body, heading)?;
    let lines: Vec<&str> = body.split_inclusive('\n').collect();
    let end = end.unwrap_or(lines.len());
    Ok(lines[found.line + 1..end].concat())
}

/// The section under `heading` with its heading line, as it is in the body.
pub fn section_with_heading(body: &str, heading: &str) -> Result<String> {
    let (found, end) = find(body, heading)?;
    let lines: Vec<&str> = body.split_inclusive('\n').collect();
    let end = end.unwrap_or(lines.len());
    Ok(lines[found.line..end].concat())
}

/// Whether a line is an item of a bullet or numbered list (a to-do too).
fn list_item(line: &str) -> bool {
    let line = line.trim_start();
    if ["- ", "* ", "+ "].iter().any(|b| line.starts_with(b)) {
        return true;
    }
    let digits = line.bytes().take_while(u8::is_ascii_digit).count();
    (1..10).contains(&digits) && [". ", ") "].iter().any(|m| line[digits..].starts_with(m))
}

/// `body` with `text` added at its end, or at the end of the section under
/// `heading` (before the blank lines that close it). A list item added to a
/// body that ends in a list continues that list.
pub fn append_under(body: &str, text: &str, heading: Option<&str>) -> Result<String> {
    let eol = eol_of(body);
    let text = text.trim_end_matches(['\n', '\r']);
    let Some(heading) = heading else {
        let base = body.trim_end_matches(['\n', '\r']);
        if base.is_empty() {
            return Ok(format!("{}{eol}", text.trim_start_matches(['\n', '\r'])));
        }
        let last = base.rsplit('\n').next().unwrap_or_default();
        let same_list = list_item(last) && list_item(text.lines().next().unwrap_or_default());
        let gap = if same_list { "" } else { eol };
        return Ok(format!("{base}{eol}{gap}{text}{eol}"));
    };
    let (found, end) = find(body, heading)?;
    let lines: Vec<&str> = body.split_inclusive('\n').collect();
    let mut spot = end.unwrap_or(lines.len());
    while spot > found.line + 1 && lines[spot - 1].trim().is_empty() {
        spot -= 1;
    }
    let mut out: String = lines[..spot].concat();
    if spot > 0 && !lines[spot - 1].ends_with('\n') {
        out.push_str(eol);
    }
    out.push_str(text);
    out.push_str(eol);
    out.push_str(&lines[spot..].concat());
    Ok(out)
}

/// `body` with the section under `heading` replaced by `markdown`. The
/// heading line stays; one blank line follows it, and one separates the
/// section from the next heading. Every other line keeps its bytes.
pub fn replace_section(body: &str, heading: &str, markdown: &str) -> Result<String> {
    let eol = eol_of(body);
    let (found, end) = find(body, heading)?;
    let lines: Vec<&str> = body.split_inclusive('\n').collect();
    let mut out: String = lines[..=found.line].concat();
    if !out.ends_with('\n') {
        out.push_str(eol);
    }
    let text = markdown.trim_matches(['\n', '\r']);
    if !text.is_empty() {
        out.push_str(eol);
        out.push_str(&text.replace("\r\n", "\n").replace('\n', eol));
        out.push_str(eol);
    }
    if let Some(end) = end {
        out.push_str(eol);
        out.push_str(&lines[end..].concat());
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BODY: &str = "Intro\n\n## Morning\n\n- tea\n\n### Detail\n\nDeep\n\n## Notes\n\nText\n";

    #[test]
    fn appends_at_the_end_or_under_a_heading() {
        assert_eq!(append_under("Hi\n", "More", None).unwrap(), "Hi\n\nMore\n");
        assert_eq!(append_under("", "First", None).unwrap(), "First\n");
        // The body's own blank lines at the top stay.
        assert_eq!(
            append_under("\n\nHi\n", "More", None).unwrap(),
            "\n\nHi\n\nMore\n"
        );
        assert_eq!(append_under("\n", "\nFirst", None).unwrap(), "First\n");
        let body = "## Morning\n\n- tea\n\n## Notes\n\nText\n";
        assert_eq!(
            append_under(body, "- toast", Some("morning")).unwrap(),
            "## Morning\n\n- tea\n- toast\n\n## Notes\n\nText\n"
        );
        assert_eq!(
            append_under(body, "More", Some("## Notes")).unwrap(),
            "## Morning\n\n- tea\n\n## Notes\n\nText\nMore\n"
        );
        assert_eq!(append_under("## A", "x", Some("A")).unwrap(), "## A\nx\n");
        assert!(append_under(body, "x", Some("Evening")).is_err());
    }

    #[test]
    fn continues_a_list_that_ends_the_body() {
        let todo = "- [ ] Post the letter @2026-10-02";
        assert_eq!(
            append_under("A day.\n\n- [ ] Call the bank\n", todo, None).unwrap(),
            "A day.\n\n- [ ] Call the bank\n- [ ] Post the letter @2026-10-02\n"
        );
        assert_eq!(
            append_under("1. one\r\n\r\n", "2. two", None).unwrap(),
            "1. one\r\n2. two\r\n"
        );
        // Anything else after a list, or a list after anything else, is a
        // new block.
        assert_eq!(
            append_under("- tea\n", "Later", None).unwrap(),
            "- tea\n\nLater\n"
        );
        assert_eq!(
            append_under("Text\n", "- item", None).unwrap(),
            "Text\n\n- item\n"
        );
        assert_eq!(
            append_under("-- dashes\n", "- item", None).unwrap(),
            "-- dashes\n\n- item\n"
        );
    }

    #[test]
    fn replaces_a_section_with_its_subsections_and_keeps_the_rest() {
        assert_eq!(
            replace_section(BODY, "morning", "- coffee\n- toast\n").unwrap(),
            "Intro\n\n## Morning\n\n- coffee\n- toast\n\n## Notes\n\nText\n"
        );
        assert_eq!(
            replace_section(BODY, "Detail", "Shallow").unwrap(),
            "Intro\n\n## Morning\n\n- tea\n\n### Detail\n\nShallow\n\n## Notes\n\nText\n"
        );
        assert_eq!(
            replace_section(BODY, "Notes", "").unwrap(),
            "Intro\n\n## Morning\n\n- tea\n\n### Detail\n\nDeep\n\n## Notes\n"
        );
        assert!(replace_section(BODY, "Evening", "x").is_err());
    }

    #[test]
    fn keeps_windows_line_endings_and_reads_sections() {
        let body = "## A\r\n\r\nold\r\n\r\n## B\r\nb\r\n";
        assert_eq!(
            replace_section(body, "A", "new\nlines").unwrap(),
            "## A\r\n\r\nnew\r\nlines\r\n\r\n## B\r\nb\r\n"
        );
        assert_eq!(
            section_text(BODY, "Morning").unwrap(),
            "\n- tea\n\n### Detail\n\nDeep\n\n"
        );
        // A heading inside a code fence is not a section.
        assert!(section_text("```\n## Fake\n```\n", "Fake").is_err());
    }
}
