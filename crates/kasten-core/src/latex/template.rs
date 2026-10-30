//! The documents a new LaTeX document can start from: an article, a report
//! and a beamer presentation. Each is a short, plain starting point written
//! for KastenFlow (`templates/*.tex`), with the title and the first text
//! put in where `@@TITLE@@` and `@@BODY@@` stand.

use super::from_markdown::{Mode, escape_text};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Template {
    #[default]
    Article,
    Report,
    Beamer,
}

impl Template {
    pub const ALL: [Template; 3] = [Template::Article, Template::Report, Template::Beamer];

    /// The template called `name` (`article`, `report`, `beamer`).
    pub fn from_name(name: &str) -> Option<Template> {
        Template::ALL
            .into_iter()
            .find(|t| t.name() == name.trim().to_ascii_lowercase())
    }

    pub fn name(self) -> &'static str {
        match self {
            Template::Article => "article",
            Template::Report => "report",
            Template::Beamer => "beamer",
        }
    }

    fn source(self) -> &'static str {
        match self {
            Template::Article => include_str!("templates/article.tex"),
            Template::Report => include_str!("templates/report.tex"),
            Template::Beamer => include_str!("templates/beamer.tex"),
        }
    }

    /// What text converted from Markdown is laid out like for this template.
    pub fn mode(self) -> Mode {
        match self {
            Template::Article => Mode::Sections,
            Template::Report => Mode::Chapters,
            Template::Beamer => Mode::Frames,
        }
    }

    /// What the document holds when no text was given.
    fn starter(self) -> &'static str {
        match self {
            Template::Article => "\\section{Introduction}",
            Template::Report => "\\chapter{Introduction}",
            Template::Beamer => "\\begin{frame}{Introduction}\n  Your first slide.\n\\end{frame}",
        }
    }

    /// The root file of a document titled `title` (written as it is, escaped),
    /// holding `body` or, with none, a first heading.
    pub fn render(self, title: &str, body: Option<&str>) -> String {
        let title = match title.trim() {
            "" => "Untitled".to_owned(),
            t => escape_text(t),
        };
        let body = body.map(|b| b.trim_end_matches(['\n', '\r', ' ']));
        let body = body
            .filter(|b| !b.trim().is_empty())
            .unwrap_or_else(|| self.starter());
        let source = self.source();
        let (head, rest) = source.split_once("@@TITLE@@").unwrap_or((source, ""));
        let (middle, tail) = rest.split_once("@@BODY@@").unwrap_or((rest, ""));
        format!("{head}{title}{middle}{body}{tail}")
    }
}

/// How text going into an existing document is laid out: by the class it names.
pub fn mode_of_document(tex: &str) -> Mode {
    let class = tex
        .lines()
        .map(str::trim_start)
        .find_map(|l| l.strip_prefix("\\documentclass"))
        .and_then(|rest| rest.split_once('{'))
        .and_then(|(_, name)| name.split_once('}'))
        .map_or("", |(name, _)| name.trim());
    match class {
        "report" | "book" | "scrreprt" | "scrbook" => Mode::Chapters,
        "beamer" => Mode::Frames,
        _ => Mode::Sections,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_template_is_a_complete_document() {
        for t in Template::ALL {
            let tex = t.render("Fish & Chips", None);
            assert!(tex.starts_with("\\documentclass"), "{}", t.name());
            assert!(tex.contains("\\title{Fish \\& Chips}"), "{}", t.name());
            assert!(tex.contains("\\begin{document}") && tex.ends_with("\\end{document}\n"));
            assert!(!tex.contains("@@"), "{}", t.name());
            assert!(tex.contains("Introduction"), "{}", t.name());
            assert_eq!(Template::from_name(t.name()), Some(t));
        }
        assert_eq!(Template::from_name(" Beamer "), Some(Template::Beamer));
        assert_eq!(Template::from_name("letter"), None);
    }

    #[test]
    fn a_body_replaces_the_first_heading() {
        let tex = Template::Article.render("T", Some("Hello\n\n"));
        assert!(
            tex.contains("\\maketitle\n\nHello\n\\end{document}\n"),
            "{tex}"
        );
        assert!(!tex.contains("Introduction"));
    }

    #[test]
    fn a_title_cannot_reach_the_document() {
        let tex = Template::Article.render("@@BODY@@ \\end{document} 100%", None);
        assert_eq!(tex.matches("\\end{document}").count(), 1, "{tex}");
        assert!(tex.contains("\\textbackslash{}end\\{document\\} 100\\%"));
    }

    #[test]
    fn the_class_says_how_headings_are_laid_out() {
        assert_eq!(
            mode_of_document("\\documentclass[a4paper]{report}\n"),
            Mode::Chapters
        );
        assert_eq!(
            mode_of_document("% x\n\\documentclass{beamer}\n"),
            Mode::Frames
        );
        assert_eq!(mode_of_document("\\documentclass{article}"), Mode::Sections);
        assert_eq!(mode_of_document("no class"), Mode::Sections);
    }
}
