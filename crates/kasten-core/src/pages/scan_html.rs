//! HTML blocks, by the seven start conditions of CommonMark: where one
//! starts and where it ends. Comments and `<details>` lines are these.

use super::lines::{Line, indent, is_blank, trim_indent};

/// Tags that start an HTML block of the sixth kind.
const BLOCK_TAGS: &[&str] = &[
    "address",
    "article",
    "aside",
    "base",
    "basefont",
    "blockquote",
    "body",
    "caption",
    "center",
    "col",
    "colgroup",
    "dd",
    "details",
    "dialog",
    "dir",
    "div",
    "dl",
    "dt",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "frame",
    "frameset",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hr",
    "html",
    "iframe",
    "legend",
    "li",
    "link",
    "main",
    "menu",
    "menuitem",
    "nav",
    "noframes",
    "ol",
    "optgroup",
    "option",
    "p",
    "param",
    "search",
    "section",
    "summary",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "title",
    "tr",
    "track",
    "ul",
];

/// Which kind (1 to 7) of HTML block `text` starts, if any. The seventh kind
/// (a lone tag) cannot interrupt a paragraph.
pub(crate) fn html_start(text: &str, interrupting: bool) -> Option<u8> {
    if indent(text) > 3 {
        return None;
    }
    let t = trim_indent(text);
    if !t.starts_with('<') {
        return None;
    }
    let lower = t.to_ascii_lowercase();
    if lower.starts_with("<!--") {
        return Some(2);
    }
    if lower.starts_with("<?") {
        return Some(3);
    }
    if lower.starts_with("<![cdata[") {
        return Some(5);
    }
    if lower.starts_with("<!") {
        return lower
            .chars()
            .nth(2)
            .is_some_and(|c| c.is_ascii_alphabetic())
            .then_some(4);
    }
    let closing = lower.starts_with("</");
    let after = &lower[if closing { 2 } else { 1 }..];
    let name: String = after
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    if !name.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let rest = &after[name.len()..];
    let plain_end = rest.is_empty() || rest.starts_with([' ', '\t', '>']);
    if !closing && matches!(name.as_str(), "script" | "pre" | "style" | "textarea") && plain_end {
        return Some(1);
    }
    if BLOCK_TAGS.contains(&name.as_str()) && (plain_end || rest.starts_with("/>")) {
        return Some(6);
    }
    (!interrupting && complete_tag(t)).then_some(7)
}

fn is_space(b: u8) -> bool {
    matches!(b, b' ' | b'\t')
}

/// Whether `t` is one complete open or closing tag and nothing else.
fn complete_tag(t: &str) -> bool {
    let b = t.trim_end().as_bytes();
    let len = b.len();
    if len < 3 || b[0] != b'<' || b[len - 1] != b'>' {
        return false;
    }
    let mut i = 1;
    let closing = b[i] == b'/';
    if closing {
        i += 1;
    }
    if i >= len || !b[i].is_ascii_alphabetic() {
        return false;
    }
    while i < len && (b[i].is_ascii_alphanumeric() || b[i] == b'-') {
        i += 1;
    }
    if closing {
        while i < len && is_space(b[i]) {
            i += 1;
        }
        return i == len - 1;
    }
    loop {
        let before = i;
        while i < len && is_space(b[i]) {
            i += 1;
        }
        if i == len - 1 || (b[i] == b'/' && i + 1 == len - 1) {
            return true;
        }
        if i == before || i >= len {
            return false;
        }
        if !(b[i].is_ascii_alphabetic() || b[i] == b'_' || b[i] == b':') {
            return false;
        }
        while i < len && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'.' | b':' | b'-'))
        {
            i += 1;
        }
        let mut j = i;
        while j < len && is_space(b[j]) {
            j += 1;
        }
        if j < len && b[j] == b'=' {
            j += 1;
            while j < len && is_space(b[j]) {
                j += 1;
            }
            if j >= len {
                return false;
            }
            if b[j] == b'"' || b[j] == b'\'' {
                let quote = b[j];
                j += 1;
                while j < len && b[j] != quote {
                    j += 1;
                }
                if j >= len {
                    return false;
                }
                j += 1;
            } else {
                let from = j;
                while j < len
                    && !matches!(
                        b[j],
                        b' ' | b'\t' | b'"' | b'\'' | b'=' | b'<' | b'>' | b'`'
                    )
                {
                    j += 1;
                }
                if j == from {
                    return false;
                }
            }
            i = j;
        }
    }
}

/// The last line of the HTML block of `kind` that starts at line `i`.
pub(crate) fn html_end(lines: &[Line], i: usize, kind: u8) -> usize {
    if kind >= 6 {
        let mut last = i;
        for (k, line) in lines.iter().enumerate().skip(i + 1) {
            if is_blank(line.text) {
                break;
            }
            last = k;
        }
        return last;
    }
    for (k, line) in lines.iter().enumerate().skip(i) {
        let lower = line.text.to_ascii_lowercase();
        let from = if k == i {
            let lead = lower.len() - lower.trim_start_matches([' ', '\t']).len();
            lead + match kind {
                2 => 4,
                5 => 9,
                3 | 4 => 2,
                _ => 0,
            }
        } else {
            0
        };
        let tail = lower.get(from..).unwrap_or("");
        let ends = match kind {
            1 => ["</script>", "</pre>", "</style>", "</textarea>"]
                .iter()
                .any(|end| tail.contains(end)),
            2 => tail.contains("-->"),
            3 => tail.contains("?>"),
            4 => tail.contains('>'),
            _ => tail.contains("]]>"),
        };
        if ends {
            return k;
        }
    }
    // Unterminated: up to the last line with anything on it.
    (i..lines.len())
        .rev()
        .find(|&k| !is_blank(lines[k].text))
        .unwrap_or(i)
}

#[cfg(test)]
mod tests {
    use super::super::lines::split_lines;
    use super::*;

    #[test]
    fn the_kinds_start_where_commonmark_says() {
        assert_eq!(html_start("<!-- columns -->", false), Some(2));
        assert_eq!(html_start("<details>", true), Some(6));
        assert_eq!(html_start("</details>", true), Some(6));
        assert_eq!(html_start("<script src=x>", true), Some(1));
        assert_eq!(html_start("<span>", false), Some(7));
        assert_eq!(html_start("<span>", true), None);
        assert_eq!(html_start("<span>text</span>", false), None);
        assert_eq!(html_start("<a href=\"x y\" b>", false), Some(7));
        assert_eq!(html_start("<3", false), None);
        assert_eq!(html_start("    <div>", false), None);
        assert_eq!(html_start("<!DOCTYPE html>", false), Some(4));
    }

    #[test]
    fn blocks_end_where_commonmark_says() {
        let body = "<!-- a\nb -->\nafter\n\n<div>\nx\n\ny\n<pre>\n\nz\n</pre>\ntail\n";
        let lines = split_lines(body);
        assert_eq!(html_end(&lines, 0, 2), 1);
        assert_eq!(html_end(&lines, 4, 6), 5);
        assert_eq!(html_end(&lines, 8, 1), 11);
        let open = split_lines("<!-- never closed\n\ntext\n");
        assert_eq!(html_end(&open, 0, 2), 2);
    }
}
