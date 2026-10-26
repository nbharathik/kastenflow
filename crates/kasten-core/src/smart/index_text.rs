//! The words a smart page's `index.html` shows, for search: tags, scripts,
//! styles, comments and the head are taken out, entities are read, and the
//! rest is the text a person would see. Light work on purpose: a scan over
//! the text, no HTML parser.

/// Elements whose whole content is code or hidden, never words to find.
const SKIPPED: [&str; 4] = ["script", "style", "template", "noscript"];

/// `html` as the plain words it shows, one space between them.
pub fn visible_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    // Lower-casing ASCII keeps every index, so one copy serves all the searches.
    let lower = html.to_ascii_lowercase();
    let mut at = 0;
    while at < html.len() {
        let Some(open) = html[at..].find('<').map(|p| at + p) else {
            out.push_str(&html[at..]);
            break;
        };
        out.push_str(&html[at..open]);
        let rest = &html[open + 1..];
        if rest.starts_with("!--") {
            at = html[open + 4..]
                .find("-->")
                .map_or(html.len(), |p| open + 4 + p + 3);
            out.push(' ');
            continue;
        }
        let closing = rest.starts_with('/');
        let name = tag_name(if closing { &rest[1..] } else { rest });
        if name.is_empty() && !rest.starts_with(['!', '?']) {
            // A lone `<` is text.
            out.push('<');
            at = open + 1;
            continue;
        }
        let after = tag_end(html, open);
        out.push(' ');
        if !closing && SKIPPED.contains(&name.as_str()) {
            at = after_element(html, &lower, after, &name);
        } else if !closing && name == "head" {
            at = after_head(html, &lower, after);
        } else {
            at = after;
        }
    }
    collapse(&decode(&out))
}

/// The lower-case name of the tag that starts `text`.
fn tag_name(text: &str) -> String {
    text.chars()
        .take_while(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_ascii_lowercase()
}

/// The index just past the `>` that ends the tag opened at `open`; quotes
/// after an `=` hide a `>` inside an attribute.
fn tag_end(html: &str, open: usize) -> usize {
    let bytes = html.as_bytes();
    let mut quote: Option<u8> = None;
    let mut last = 0u8;
    for (i, &b) in bytes.iter().enumerate().skip(open + 1) {
        match quote {
            Some(q) if b == q => quote = None,
            Some(_) => {}
            None if (b == b'"' || b == b'\'') && last == b'=' => quote = Some(b),
            None if b == b'>' => return i + 1,
            None => {}
        }
        if quote.is_none() && !b.is_ascii_whitespace() {
            last = b;
        }
    }
    html.len()
}

/// Where the text goes on after the element `name` whose start tag ended at
/// `from`: just past its end tag, or the end of the page when it never ends.
fn after_element(html: &str, lower: &str, from: usize, name: &str) -> usize {
    let needle = format!("</{name}");
    match lower[from..].find(&needle) {
        Some(p) => tag_end(html, from + p),
        None => html.len(),
    }
}

/// Where the text goes on after a `<head>` that started at `from`: past
/// `</head>`, or at `<body` when the head is never closed.
fn after_head(html: &str, lower: &str, from: usize) -> usize {
    let end = lower[from..].find("</head").map(|p| from + p);
    let body = lower[from..].find("<body").map(|p| from + p);
    match (end, body) {
        (Some(e), Some(b)) if b < e => b,
        (Some(e), _) => tag_end(html, e),
        (None, Some(b)) => b,
        (None, None) => html.len(),
    }
}

/// Reads the entities a page is likely to use.
fn decode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        // Only the next few bytes can end an entity: looking further would make
        // a long run of `&` cost time by the square of its length.
        let Some(end) = rest.as_bytes()[1..]
            .iter()
            .take(11)
            .position(|&b| b == b';')
        else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..1 + end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => entity.strip_prefix('#').and_then(|number| {
                let code = match number.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok(),
                    None => number.parse().ok(),
                };
                code.and_then(char::from_u32)
            }),
        };
        match decoded {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 2..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_words_a_person_sees() {
        let html = "<!doctype html><html><head><title>Hidden title</title><style>.x{color:red}</style></head>\
            <body><h1 class=\"big\">Pelican   deadlines</h1><p>Paper <b>due</b> on 3 May &amp; poster &lt;soon&gt; &#233;&#x41;</p></body></html>";
        assert_eq!(
            visible_text(html),
            "Pelican deadlines Paper due on 3 May & poster <soon> éA"
        );
    }

    #[test]
    fn leaves_out_scripts_styles_comments_and_templates() {
        let html = "<p>seen</p><script>var walrus = '<b>x</b>';</script>\
            <style>.walrus{}</style><!-- walrus in a comment --><template><p>walrus</p></template>\
            <noscript>walrus</noscript><SCRIPT type=text/javascript>walrus()</SCRIPT><p>also seen</p>";
        assert_eq!(visible_text(html), "seen also seen");
    }

    #[test]
    fn a_tag_with_a_greater_than_in_an_attribute_is_one_tag() {
        assert_eq!(
            visible_text("<a title=\"a > b\" href='x>y'>link</a> text"),
            "link text"
        );
    }

    #[test]
    fn broken_html_never_loses_the_rest_or_loops() {
        assert_eq!(visible_text("a < b and c"), "a < b and c");
        assert_eq!(visible_text("text <p never closed"), "text");
        assert_eq!(visible_text("seen<script>never closed walrus"), "seen");
        assert_eq!(visible_text("x<!-- never closed walrus"), "x");
        assert_eq!(
            visible_text("<head><title>t</title><body>kept</body>"),
            "kept"
        );
        assert_eq!(
            visible_text("fish &amp chips &bogus; &#xZZ; &#99999999;"),
            "fish &amp chips &bogus; &#xZZ; &#99999999;"
        );
        assert_eq!(visible_text(""), "");
    }

    /// A file at the size limit made of the worst cases for a scanner finishes
    /// at once and never panics.
    #[test]
    fn hostile_files_of_the_biggest_size_take_linear_time() {
        let limit = crate::smart::MAX_FILE_BYTES as usize;
        let started = std::time::Instant::now();
        for piece in [
            "&",
            "&a",
            "<head>",
            "<p ",
            "<a b=\"",
            "<a b='>",
            "<!-",
            "<script>",
            "<![CDATA[",
            "é<",
            "</",
            "<!-->",
        ] {
            let html = piece.repeat(limit / piece.len());
            let text = visible_text(&html);
            assert!(text.len() <= html.len(), "{piece:?}");
        }
        let mixed = format!("{}<body>kept", "<head>".repeat(limit / 12));
        assert_eq!(visible_text(&mixed), "kept");
        assert!(
            started.elapsed() < std::time::Duration::from_secs(60),
            "took {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn plain_text_and_non_ascii_survive() {
        assert_eq!(
            visible_text("Zürich — 東京 <i>café</i>"),
            "Zürich — 東京 café"
        );
    }
}
