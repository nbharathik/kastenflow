//! Keeping text from the vault, or from a file the person attached, from
//! pretending to be the message: the tags the context block is built from
//! are made inert wherever they appear inside what it holds.

/// The tags this block is built from. Text from the vault may be written
/// by anyone (a clipped page, an import), so it never gets to close one and
/// go on as if the person were speaking.
pub const FRAMES: [&str; 13] = [
    "context",
    "note",
    "board",
    "tag",
    "search",
    "pdf",
    "deck",
    "slide",
    "diagram",
    "latex",
    "attachment",
    "selection",
    "selection-limit",
];

/// `text` with any opening or closing of the block's own tags made inert.
pub fn fence(text: &str) -> String {
    fence_tags(text, &FRAMES)
}

/// `text` with any opening or closing of the tags in `frames` made inert.
pub fn fence_tags(text: &str, frames: &[&str]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some((at, open)) = rest.char_indices().find(|(_, c)| opens_a_tag(*c)) {
        out.push_str(&rest[..at]);
        let after = &rest[at + open.len_utf8()..];
        // `</ context >` reads as a closing tag to a model too, and so does
        // one with an invisible character in it.
        let name = blank_start(after);
        let name = name.strip_prefix('/').unwrap_or(name);
        let name = blank_start(name);
        let framed = frames.iter().any(|frame| {
            name.get(..frame.len())
                .is_some_and(|word| word.eq_ignore_ascii_case(frame))
                && !name[frame.len()..]
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        });
        // A plain `<` stays as it is; a look-alike of it that spells one of the
        // block's tags is made inert like the real one.
        if framed {
            out.push_str("&lt;");
        } else {
            out.push(open);
        }
        rest = after;
    }
    out.push_str(rest);
    out
}

/// `<`, and the characters that look like it.
fn opens_a_tag(c: char) -> bool {
    matches!(
        c,
        '<' | '\u{FF1C}' | '\u{2039}' | '\u{3008}' | '\u{27E8}' | '\u{FE64}' | '\u{2329}'
    )
}

/// `text` without the spaces and invisible characters it starts with.
fn blank_start(text: &str) -> &str {
    text.trim_start_matches(|c: char| {
        c.is_whitespace()
            || matches!(c, '\u{00AD}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}' | '\u{FEFF}')
    })
}
