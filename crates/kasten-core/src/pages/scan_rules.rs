//! The tests that tell what a line starts: a fence, a heading, a rule, a
//! quote, a callout header, an embed. The rules of CommonMark, read from
//! the line alone.

use super::lines::{indent, is_blank, trim_indent};

/// A code fence's opening line: its character and length.
pub(crate) fn fence_open(text: &str) -> Option<(char, usize)> {
    if indent(text) > 3 {
        return None;
    }
    let t = trim_indent(text);
    let c = t.chars().next()?;
    if c != '`' && c != '~' {
        return None;
    }
    let n = t.chars().take_while(|&x| x == c).count();
    if n < 3 || (c == '`' && t[n..].contains('`')) {
        return None;
    }
    Some((c, n))
}

/// Whether `text` closes the fence `(c, n)`.
pub(crate) fn fence_closes(text: &str, (c, n): (char, usize)) -> bool {
    if indent(text) > 3 {
        return false;
    }
    let t = trim_indent(text);
    let run = t.chars().take_while(|&x| x == c).count();
    run >= n && is_blank(&t[run..])
}

/// A `$$` math fence's opening line: how many dollar signs.
pub(crate) fn math_open(text: &str) -> Option<usize> {
    if indent(text) > 3 {
        return None;
    }
    let t = trim_indent(text);
    let n = t.chars().take_while(|&c| c == '$').count();
    (n >= 2 && !t[n..].contains('$')).then_some(n)
}

pub(crate) fn math_closes(text: &str, n: usize) -> bool {
    if indent(text) > 3 {
        return false;
    }
    let t = trim_indent(text).trim_end_matches([' ', '\t', '\r']);
    t.len() >= n && t.chars().all(|c| c == '$')
}

/// The level of an ATX heading line (`## Title`).
pub(crate) fn atx_level(text: &str) -> Option<u8> {
    if indent(text) > 3 {
        return None;
    }
    let t = trim_indent(text);
    let n = t.chars().take_while(|&c| c == '#').count();
    if !(1..=6).contains(&n) {
        return None;
    }
    match t[n..].chars().next() {
        None | Some(' ' | '\t') => u8::try_from(n).ok(),
        _ => None,
    }
}

/// An ATX heading's text without its marks.
pub(crate) fn atx_text(text: &str) -> String {
    let t = trim_indent(text).trim_start_matches('#').trim();
    // A closing run of marks, set off by a space.
    let closed = t.trim_end_matches('#');
    let t = if closed.is_empty() || closed.ends_with([' ', '\t']) {
        closed.trim()
    } else {
        t
    };
    t.to_owned()
}

/// A line of three or more `-`, `*` or `_` and white space.
pub(crate) fn is_thematic(text: &str) -> bool {
    if indent(text) > 3 {
        return false;
    }
    let mut mark = None;
    let mut count = 0;
    for c in text.chars() {
        match c {
            ' ' | '\t' | '\r' => {}
            '-' | '*' | '_' => {
                if *mark.get_or_insert(c) != c {
                    return false;
                }
                count += 1;
            }
            _ => return false,
        }
    }
    count >= 3
}

/// The level a line underlines (`===` is 1, `---` is 2) under paragraph text.
pub(crate) fn setext_level(text: &str) -> Option<u8> {
    if indent(text) > 3 {
        return None;
    }
    let t = trim_indent(text).trim_end_matches([' ', '\t', '\r']);
    if t.is_empty() {
        None
    } else if t.chars().all(|c| c == '=') {
        Some(1)
    } else if t.chars().all(|c| c == '-') {
        Some(2)
    } else {
        None
    }
}

pub(crate) fn is_quote_start(text: &str) -> bool {
    indent(text) <= 3 && trim_indent(text).starts_with('>')
}

/// A quote line without its first `>` and the space after it.
pub(crate) fn quote_inner_once(text: &str) -> &str {
    let t = trim_indent(text);
    let t = t.strip_prefix('>').unwrap_or(t);
    t.strip_prefix(' ')
        .or_else(|| t.strip_prefix('\t'))
        .unwrap_or(t)
}

/// A quote line without any of its `>` marks.
pub(crate) fn quote_inner_all(text: &str) -> &str {
    let mut t = text;
    while is_quote_start(t) {
        t = quote_inner_once(t);
    }
    t
}

/// What the first line of a callout says: `[!kind]`, a fold mark, a title.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CalloutHeader {
    pub kind: String,
    pub title: String,
}

/// The header a quote's first line makes it a callout with (the editor's rule:
/// `[!kind]`, an optional `+` or `-`, an optional title).
pub(crate) fn callout_header(inner: &str) -> Option<CalloutHeader> {
    let rest = inner.strip_prefix("[!")?;
    let end = rest.find(']')?;
    let kind = &rest[..end];
    let mut chars = kind.chars();
    if !chars.next()?.is_ascii_alphabetic()
        || !chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    let after = &rest[end + 1..];
    let after = after.strip_prefix(['+', '-']).unwrap_or(after);
    let title = if after.trim_matches([' ', '\t', '\r']).is_empty() {
        ""
    } else if after.starts_with([' ', '\t']) {
        after.trim_matches([' ', '\t', '\r'])
    } else {
        return None;
    };
    Some(CalloutHeader {
        kind: kind.to_owned(),
        title: title.to_owned(),
    })
}

/// Whether a line starts a footnote definition (`[^1]: text`), whose
/// indented paragraphs after it belong to it.
pub(crate) fn is_footnote_definition(text: &str) -> bool {
    if indent(text) > 3 {
        return false;
    }
    let Some(rest) = trim_indent(text).strip_prefix("[^") else {
        return false;
    };
    rest.find(']').is_some_and(|end| {
        let label = &rest[..end];
        !label.is_empty() && !label.contains([' ', '\t', '[']) && rest[end + 1..].starts_with(':')
    })
}

/// Whether a line is a link reference definition (`[label]: https://…`).
pub(crate) fn is_link_definition(text: &str) -> bool {
    if indent(text) > 3 {
        return false;
    }
    let Some(rest) = trim_indent(text).strip_prefix('[') else {
        return false;
    };
    rest.find(']').is_some_and(|end| {
        let label = &rest[..end];
        !label.trim().is_empty() && !label.starts_with('^') && rest[end + 1..].starts_with(':')
    })
}

/// The target of a line that is only an embed (`![[Page]]`, `![[x.drawio]]`).
pub(crate) fn embed_target(text: &str) -> Option<&str> {
    let inner = text.trim().strip_prefix("![[")?.strip_suffix("]]")?;
    (!inner.is_empty() && !inner.contains("[[") && !inner.contains("]]") && !inner.contains('\n'))
        .then_some(inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fences_headings_and_rules() {
        assert_eq!(fence_open("```rust"), Some(('`', 3)));
        assert_eq!(fence_open("  ~~~~"), Some(('~', 4)));
        assert_eq!(fence_open("    ```"), None);
        assert_eq!(fence_open("``` a`b"), None);
        assert!(fence_closes("````", ('`', 3)));
        assert!(!fence_closes("``", ('`', 3)));
        assert!(!fence_closes("``` x", ('`', 3)));
        assert_eq!(atx_level("### Hi"), Some(3));
        assert_eq!(atx_level("#"), Some(1));
        assert_eq!(atx_level("#Hi"), None);
        assert_eq!(atx_level("####### x"), None);
        assert_eq!(atx_text("## Title ##"), "Title");
        assert_eq!(atx_text("## C#"), "C#");
        assert!(is_thematic("* * *"));
        assert!(is_thematic("---"));
        assert!(!is_thematic("--"));
        assert!(!is_thematic("-*-"));
        assert_eq!(setext_level("==="), Some(1));
        assert_eq!(setext_level("--"), Some(2));
        assert_eq!(setext_level("-- x"), None);
    }

    #[test]
    fn callouts_and_embeds() {
        let header = callout_header("[!tip]- A title ").unwrap();
        assert_eq!(
            (header.kind.as_str(), header.title.as_str()),
            ("tip", "A title")
        );
        assert!(callout_header("[!note]").is_some());
        assert!(callout_header("[!note]x").is_none());
        assert!(callout_header("[note]").is_none());
        assert_eq!(embed_target("  ![[Page#Heading]]  "), Some("Page#Heading"));
        assert_eq!(embed_target("![[a]] and ![[b]]"), None);
        assert_eq!(quote_inner_all("> > x"), "x");
    }

    #[test]
    fn math_fences() {
        assert_eq!(math_open("$$"), Some(2));
        assert_eq!(math_open("$$ x $$"), None);
        assert!(math_closes("$$ ", 2));
        assert!(!math_closes("$ ", 2));
    }
}
