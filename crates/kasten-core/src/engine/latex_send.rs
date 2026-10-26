//! Starting a LaTeX document from a template, and sending a page (or a part
//! of one) to LaTeX: converted from Markdown and either made into a new
//! document or added at the end of a document's root file. Each is one
//! `save_source`, so one commit.

use super::Kasten;
use crate::error::{Error, Result};
use crate::history::Actor;
use crate::latex::{Converted, LatexDoc, Material, Mode, Sent, Template, mode_of_document};
use crate::time::Instant;

fn nothing_to_send() -> Error {
    Error::Invalid("There is no text to send to LaTeX".to_owned())
}

/// Environments whose lines are not TeX: an `\end{document}` in one is text.
const VERBATIM: [&str; 5] = ["verbatim", "Verbatim", "lstlisting", "minted", "comment"];

/// A line without its comment (from the first `%` that is not escaped).
fn code_part(line: &str) -> &str {
    let mut escaped = false;
    for (at, c) in line.char_indices() {
        match c {
            '\\' => escaped = !escaped,
            '%' if !escaped => return &line[..at],
            _ => escaped = false,
        }
    }
    line
}

/// Whether the file loads `hyperref` in a line that is not a comment.
fn loads_hyperref(text: &str) -> bool {
    text.lines().any(|line| {
        let code = code_part(line);
        code.contains("{hyperref}") || code.contains(",hyperref") || code.contains("hyperref,")
    })
}

/// Where the last `\end{document}` that starts a line stands, outside any
/// verbatim-like environment and any comment.
fn document_end(text: &str) -> Option<usize> {
    let mut open: Option<&str> = None;
    let mut offset = 0;
    let mut found = None;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim_start();
        match open {
            Some(env) => {
                if trimmed.starts_with(&format!("\\end{{{env}}}")) {
                    open = None;
                }
            }
            None => {
                if let Some(env) = VERBATIM
                    .iter()
                    .find(|env| trimmed.starts_with(&format!("\\begin{{{env}}}")))
                {
                    open = Some(env);
                } else if trimmed.starts_with("\\end{document}") {
                    found = Some(offset + (line.len() - trimmed.len()));
                }
            }
        }
        offset += line.len();
    }
    found
}

/// `existing` (a root file) with the converted text added before `\end{document}`
/// (at the end when it has none), and `hyperref` loaded if the text needs it.
fn with_text_added(existing: &str, converted: &Converted, mode: Mode) -> String {
    let mut text = existing.to_owned();
    let loaded = loads_hyperref(existing);
    if converted.hyperref && !loaded && mode != Mode::Frames {
        let mut offset = 0;
        for line in existing.split_inclusive('\n') {
            if line.trim_start().starts_with("\\begin{document}") {
                text.insert_str(offset, "\\usepackage{hyperref}\n");
                break;
            }
            offset += line.len();
        }
    }
    let end = document_end(&text);
    let body = converted.tex.trim_end();
    match end {
        Some(at) => format!("{}\n\n{body}\n{}", text[..at].trim_end(), &text[at..]),
        None => format!("{}\n\n{body}\n", text.trim_end()),
    }
}

impl Kasten {
    /// Makes a document titled `title` in `project` or the library from
    /// `template`, holding `body` (LaTeX) or a first heading; a person's op.
    pub fn create_latex_doc_from(
        &self,
        actor: &Actor,
        title: &str,
        template: Template,
        project: Option<&str>,
        body: Option<&str>,
        now: Instant,
    ) -> Result<LatexDoc> {
        if actor.is_agent() {
            return Err(Error::Invalid(
                "Agents make a document by saving its first file through the guarded write"
                    .to_owned(),
            ));
        }
        let path = self.new_latex_path(title, project)?;
        self.write_source(actor, &path, "", &template.render(title, body), now)?;
        self.latex_doc_of(&path)?
            .ok_or_else(|| Error::Invalid("The new document could not be found".to_owned()))
    }

    /// Makes a new document from `template` holding `material` as LaTeX.
    pub fn send_to_new_latex_doc(
        &self,
        actor: &Actor,
        material: Material<'_>,
        title: &str,
        template: Template,
        project: Option<&str>,
        now: Instant,
    ) -> Result<Sent> {
        let converted = material.convert(template.mode());
        if converted.tex.is_empty() {
            return Err(nothing_to_send());
        }
        let doc =
            self.create_latex_doc_from(actor, title, template, project, Some(&converted.tex), now)?;
        Ok(Sent {
            path: doc.main_path.clone(),
            doc,
            appended: false,
            cites: converted.cites,
            todos: converted.todos,
        })
    }

    /// Adds `material`, as LaTeX, at the end of the root file `path` of a document.
    pub fn send_to_latex_doc(
        &self,
        actor: &Actor,
        material: Material<'_>,
        path: &str,
        now: Instant,
    ) -> Result<Sent> {
        let file = self.source(path)?;
        let mode = mode_of_document(&file.text);
        let converted = material.convert(mode);
        if converted.tex.is_empty() {
            return Err(nothing_to_send());
        }
        let text = with_text_added(&file.text, &converted, mode);
        self.save_source(actor, path, &file.hash, &text, now)?;
        let doc = self
            .latex_doc_of(path)?
            .ok_or_else(|| Error::Invalid("The document could not be found".to_owned()))?;
        Ok(Sent {
            doc,
            path: path.to_owned(),
            appended: true,
            cites: converted.cites,
            todos: converted.todos,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn converted(tex: &str, hyperref: bool) -> Converted {
        Converted {
            tex: tex.to_owned(),
            hyperref,
            ..Converted::default()
        }
    }

    #[test]
    fn text_goes_before_the_end_of_the_document() {
        let doc = "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}\n";
        let out = with_text_added(doc, &converted("New\n", false), Mode::Sections);
        assert_eq!(
            out,
            "\\documentclass{article}\n\\begin{document}\nHi\n\nNew\n\\end{document}\n"
        );
    }

    #[test]
    fn a_file_without_an_end_gets_the_text_at_its_end() {
        let out = with_text_added(
            "\\documentclass{article}\n",
            &converted("New\n", false),
            Mode::Sections,
        );
        assert_eq!(out, "\\documentclass{article}\n\nNew\n");
    }

    #[test]
    fn links_load_hyperref_once() {
        let doc = "\\documentclass{article}\n\\begin{document}\n\\end{document}\n";
        let out = with_text_added(doc, &converted("x\n", true), Mode::Sections);
        assert!(
            out.contains("\\usepackage{hyperref}\n\\begin{document}"),
            "{out}"
        );
        let again = with_text_added(&out, &converted("y\n", true), Mode::Sections);
        assert_eq!(again.matches("hyperref").count(), 1);
        let beamer = with_text_added(doc, &converted("x\n", true), Mode::Frames);
        assert!(!beamer.contains("hyperref"));
    }

    #[test]
    fn an_end_inside_a_verbatim_block_is_not_the_end() {
        let doc = "\\begin{document}\nHi\n\\begin{verbatim}\n\\end{document}\n\\end{verbatim}\n\\end{document}\n";
        let out = with_text_added(doc, &converted("N\n", false), Mode::Sections);
        assert!(
            out.ends_with("\\end{verbatim}\n\nN\n\\end{document}\n"),
            "{out}"
        );
        // Only a verbatim block that never closes would hide the real end: the text then goes at the file's end.
        let open = "\\begin{document}\n\\begin{lstlisting}\n\\end{document}\n";
        let out = with_text_added(open, &converted("N\n", false), Mode::Sections);
        assert!(out.ends_with("\\end{document}\n\nN\n"), "{out}");
    }

    #[test]
    fn a_hyperref_in_a_comment_is_not_loaded() {
        let doc = "\\documentclass{article}\n% \\usepackage{hyperref}\n\\begin{document}\n\\end{document}\n";
        let out = with_text_added(doc, &converted("x\n", true), Mode::Sections);
        assert!(
            out.contains("\n\\usepackage{hyperref}\n\\begin{document}"),
            "{out}"
        );
        // A real load, also among other packages or with a trailing comment, is seen.
        for loaded in [
            "\\usepackage{hyperref} % links\n",
            "\\usepackage[colorlinks]{hyperref}\n",
            "\\usepackage{url,hyperref}\n",
        ] {
            let doc = format!(
                "\\documentclass{{article}}\n{loaded}\\begin{{document}}\n\\end{{document}}\n"
            );
            let out = with_text_added(&doc, &converted("x\n", true), Mode::Sections);
            assert_eq!(out.matches("hyperref").count(), 1, "{loaded}: {out}");
        }
    }

    #[test]
    fn an_end_in_a_comment_or_a_line_is_not_the_end() {
        let doc = "\\begin{document}\n% \\end{document}\nHi \\end{document}\n";
        let out = with_text_added(doc, &converted("N\n", false), Mode::Sections);
        assert!(out.ends_with("\n\nN\n"), "{out}");
    }
}
