//! Markdown to LaTeX: a page, or a part of one, written as the body of a
//! document (no preamble). Blocks come from the page scanner (`pages`),
//! the text inside them from a small inline reader (`inline`). It is made for
//! text nobody has looked at: it never panics, the work it does is bounded
//! by the length of the text, the characters TeX reads as commands are
//! escaped outside code and math, math is passed through only when it is
//! plainly a formula, and what has no LaTeX form is written as plain text
//! or a comment with `% TODO` in front.

mod blocks;
mod escape;
mod inline;
mod links;
mod list;
mod spans;
mod table;

pub use escape::escape_text;

use blocks::Out;
use inline::Inline;

use crate::frontmatter::split;

/// How headings and the page as a whole are laid out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Mode {
    /// `#` is a `\section` (articles).
    #[default]
    Sections,
    /// `#` is a `\chapter` (reports and books).
    Chapters,
    /// `#` and `##` each start a frame (slides).
    Frames,
}

/// A converted text and what it needs from the document it goes into.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Converted {
    pub tex: String,
    /// Citation keys used, each once, in order.
    pub cites: Vec<String>,
    /// The text uses `\href`: the document needs the `hyperref` package.
    pub hyperref: bool,
    /// How many `% TODO` comments the text holds.
    pub todos: usize,
}

const SECTIONS: [&str; 6] = [
    "section",
    "subsection",
    "subsubsection",
    "paragraph",
    "subparagraph",
    "subparagraph",
];
const CHAPTERS: [&str; 6] = [
    "chapter",
    "section",
    "subsection",
    "subsubsection",
    "paragraph",
    "subparagraph",
];

fn heading_line(mode: Mode, level: u8, text: &str) -> String {
    let names = if mode == Mode::Chapters {
        CHAPTERS
    } else {
        SECTIONS
    };
    let name = names[usize::from(level.clamp(1, 6)) - 1];
    format!("\\{name}{{{text}}}")
}

fn with_notes(line: String, notes: Vec<String>) -> String {
    std::iter::once(line)
        .chain(notes)
        .collect::<Vec<_>>()
        .join("\n")
}

/// The pieces as slide frames: a heading of level 1 or 2 starts one.
fn frames(outs: Vec<Out>) -> Vec<String> {
    let mut frames: Vec<String> = Vec::new();
    let mut open: Option<(String, Vec<String>)> = None;
    let close = |open: &mut Option<(String, Vec<String>)>, frames: &mut Vec<String>| {
        if let Some((title, body)) = open.take() {
            let mut lines = vec![if title.is_empty() {
                "\\begin{frame}[fragile]".to_owned()
            } else {
                format!("\\begin{{frame}}[fragile]{{{title}}}")
            }];
            if !body.is_empty() {
                lines.push(body.join("\n\n"));
            }
            lines.push("\\end{frame}".to_owned());
            frames.push(lines.join("\n"));
        }
    };
    for out in outs {
        match out {
            Out::Heading { level, text, notes } if level <= 2 => {
                close(&mut open, &mut frames);
                open = Some((text, notes));
            }
            other => {
                let text = other.flattened();
                open.get_or_insert_with(|| (String::new(), Vec::new()))
                    .1
                    .push(text);
            }
        }
    }
    close(&mut open, &mut frames);
    frames
}

/// The Markdown in `markdown` (a page body or a selection) as LaTeX.
pub fn markdown_to_latex(markdown: &str, mode: Mode) -> Converted {
    let mut inline = Inline::default();
    let outs = blocks::convert(markdown, 0, &mut inline);
    let pieces: Vec<String> = if mode == Mode::Frames {
        frames(outs)
    } else {
        outs.into_iter()
            .map(|out| match out {
                Out::Text(text) => text,
                Out::Heading { level, text, notes } => {
                    with_notes(heading_line(mode, level, &text), notes)
                }
            })
            .collect()
    };
    let mut tex = pieces.join("\n\n");
    if !tex.is_empty() {
        tex.push('\n');
    }
    Converted {
        todos: tex.lines().filter(|l| l.starts_with("% TODO")).count(),
        tex,
        cites: inline.cites,
        hyperref: inline.links,
    }
}

/// A page's whole text (frontmatter left out) as LaTeX.
pub fn page_to_latex(text: &str, mode: Mode) -> Converted {
    markdown_to_latex(split(text).body, mode)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_is_empty_output() {
        assert_eq!(markdown_to_latex("", Mode::Sections), Converted::default());
        assert_eq!(markdown_to_latex("\n\n  \n", Mode::Sections).tex, "");
    }

    #[test]
    fn chapters_shift_the_headings_up() {
        let c = markdown_to_latex("# A\n\n## B\n", Mode::Chapters);
        assert_eq!(c.tex, "\\chapter{A}\n\n\\section{B}\n");
    }

    #[test]
    fn slides_get_a_frame_for_each_heading() {
        let c = markdown_to_latex(
            "Lead\n\n# One\n\n- a\n\n## Two\n\n### Three\n\ntext\n",
            Mode::Frames,
        );
        assert_eq!(
            c.tex,
            "\\begin{frame}[fragile]\nLead\n\\end{frame}\n\n\\begin{frame}[fragile]{One}\n\\begin{itemize}\n  \\item a\n\\end{itemize}\n\\end{frame}\n\n\\begin{frame}[fragile]{Two}\n\\textbf{Three}\n\ntext\n\\end{frame}\n"
        );
    }

    #[test]
    fn cites_links_and_todos_are_reported() {
        let c = markdown_to_latex(
            "See [@a] and [x](https://y.org).\n\n<div>x</div>\n",
            Mode::Sections,
        );
        assert_eq!(c.cites, ["a"]);
        assert!(c.hyperref);
        assert_eq!(c.todos, 1);
    }

    #[test]
    fn a_frontmatter_block_is_not_converted() {
        let c = page_to_latex("---\ntitle: T\n---\n\nBody\n", Mode::Sections);
        assert_eq!(c.tex, "Body\n");
    }
}
