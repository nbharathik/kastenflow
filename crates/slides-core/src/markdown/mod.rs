//! Markdown to text runs and back: the small dialect that operations take
//! for the words on a slide, and that the outline is written in.
//!
//! **Lines.** Every non-blank line is a paragraph; blank lines separate
//! nothing.
//!
//! - `- x`, `* x` and `+ x` are bullets, `1. x` and `1) x` numbered items
//!   (an item that is written with a number it would not have had by counting
//!   on, such as the `3.` that begins a list or the `1.` that begins it again,
//!   keeps it as the number it starts at; the look of the marker is not kept).
//!   Two spaces, or a tab, of indent make one level, up to five. A marker needs
//!   a space after it, so `-x` and `*x*` are text.
//! - `# x` is a paragraph in the `title` style, `## x` in `subtitle`, `> x`
//!   in `quote`; `### x` and deeper is body text made bold.
//! - Three or more backticks or tildes open a fence, closed by the same
//!   character or by the end of the text. Each line inside is a `code`
//!   paragraph, kept as it is.
//! - Two spaces or a backslash at the end of a line keep the next line in the
//!   same paragraph, with a `\n` between the words.
//!
//! **Inside a line.** `**bold**`, `__bold__`, `*italic*`, `_italic_`,
//! `~~strike~~`, `<u>underline</u>`, `` `code` ``, `[text](url)`,
//! `<https://autolink>`, `$latex$` and `$$latex$$`. Emphasis nests, and is
//! paired the way CommonMark pairs it, so `snake_case` stays whole. A price
//! such as "$5 and $6" is not math. A backslash before one of
//! ``\ * _ ~ ` [ ] ( ) < > $ # - + .`` makes it plain text. A marker that
//! does not close is text. `<b>`, `<i>` and `<s>` are read too, so that the
//! serializer always has an exact form to fall back on.
//!
//! [`to_markdown`] undoes [`parse`]: reading what it wrote gives back the
//! same paragraphs. Colour, size and font are not Markdown and are left out.

mod blocks;
mod emphasis;
mod escape;
mod inline;
mod render;
mod scan;
mod spans;

#[cfg(test)]
mod tests;

pub use blocks::parse;
pub(crate) use blocks::{fence_closes, fence_open};
pub use render::to_markdown;

/// The runs of `line` read as inline Markdown: bold, italic, code, math and links, each as a run.
pub(crate) fn inline_runs(line: &str) -> Vec<crate::model::Run> {
    inline::inline(line)
}

/// The text of `line` read as inline Markdown, with the markers gone.
pub(crate) fn plain_inline(line: &str) -> String {
    inline::inline(line).iter().map(|r| r.t.as_str()).collect()
}

/// `text` written so that reading it as inline Markdown gives `text` back,
/// with as few backslashes as will do. `in_brackets` is for text that goes
/// between `[` and `]`. It never holds `<!--`, which an outline would take
/// for a comment.
pub(crate) fn escape_inline(text: &str, in_brackets: bool) -> String {
    let written = |full| {
        let esc = escape::Esc {
            full,
            in_link: in_brackets,
            line_start: false,
        };
        escape::escape(text, esc)
    };
    let short = written(false);
    if !short.contains("<!--") && plain_inline(&short) == text {
        short
    } else {
        written(true)
    }
}

/// `![alt](src)`. There is no image in a run, so reading it back gives a
/// `!` and a link; the outline uses it to show that a picture is there.
pub(crate) fn image_markdown(alt: &str, src: &str) -> String {
    let alt = alt.split_whitespace().collect::<Vec<_>>().join(" ");
    format!(
        "![{}]({})",
        escape_inline(&alt, true),
        escape::url_text(src)
    )
}
