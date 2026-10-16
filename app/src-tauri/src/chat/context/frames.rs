//! Keeping text from the vault, or from a file the person attached, from
//! pretending to be the message: the tags the context block is built from
//! are made inert wherever they appear inside what it holds.

/// The tags this block is built from. Text from the vault may be written
/// by anyone (a clipped page, an import), so it never gets to close one and
/// go on as if the person were speaking.
pub const FRAMES: [&str; 10] = [
    "context",
    "note",
    "board",
    "tag",
    "search",
    "pdf",
    "deck",
    "slide",
    "diagram",
    "attachment",
];

/// `text` with any opening or closing of the block's own tags made inert.
pub fn fence(text: &str) -> String {
    fence_tags(text, &FRAMES)
}

/// `text` with any opening or closing of the tags in `frames` made inert.
pub fn fence_tags(text: &str, frames: &[&str]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('<') {
        out.push_str(&rest[..at]);
        let after = &rest[at + 1..];
        // `</ context >` reads as a closing tag to a model too.
        let name = after.trim_start();
        let name = name.strip_prefix('/').unwrap_or(name).trim_start();
        let framed = frames.iter().any(|frame| {
            name.get(..frame.len())
                .is_some_and(|word| word.eq_ignore_ascii_case(frame))
                && !name[frame.len()..]
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        });
        out.push_str(if framed { "&lt;" } else { "<" });
        rest = after;
    }
    out.push_str(rest);
    out
}
