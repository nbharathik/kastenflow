//! What agents are told about LaTeX documents: how to read, change and check
//! one. The same text is in the `kasten` skill; a test keeps the two equal and
//! keeps every tool it names a real one.

/// The paragraph, as the server tells it and the skill carries it.
pub const LATEX: &str = "## LaTeX documents

When the LaTeX plugin is on, a LaTeX document is a folder with a root `.tex` file, and `latex_list` shows them. Start one with `latex_create_document`, or from a page with `latex_send_page` (all of it or one section). Read a file with `latex_read`: it gives the text and its `hash`. Change a small part with `latex_edit`: the `search` text must be in the file once, and `base_hash` must be the hash you read. Write a whole file with `latex_write_file` (leave out `base_hash` for a new file), add text with `latex_append` (at the end, or after a piece of the file you give as `after`: use it in the root file, whose end is past `\\end{document}`), and take a file out with `latex_delete_file` (it goes to the trash). If you are told the file changed since you read it, nothing was written: read it again and redo the change. A locked document is read-only. Taking out much of a file, a root file, and anything in a project set to review waits for the user's review.

Figures are PNG (or JPG or PDF), never SVG. Kasten never runs Python or any program: make a chart on your side and send the PNG with `latex_add_asset`, which gives back the path for `\\includegraphics`. Cite a reference from the user's References with `latex_cite` and its key from `list_references`: it writes `\\cite{key}` and keeps the entry in `references.bib` once. A citation or a sent page waits where the user reviews changes; a picture does not.

`latex_build` does not run TeX itself: it tells you what the app's last build said, with the file and line of each error, and when a file changed after it. To build now, call it with `wait` set to true: the app builds and gives the errors and warnings, the page count and the PDF's size. Building needs the app open, and you are told if it is closed or the build is too slow. To fix errors, make small `latex_edit` steps, then build again. When the build is clean, `latex_export_pdf` keeps the PDF in the document's folder; it waits for review where the user reviews changes. Leave the user's wording, commands and packages alone unless a fix needs them changed, and say what you changed.";

/// Told only while the Diagrams and the LaTeX plugins are both on (the tool needs both).
pub const FIGURE: &str = "A diagram becomes a figure with `diagram_to_latex_figure`: the KastenFlow app draws it as a PNG, the call keeps it in the document's figures folder and gives back the `\\includegraphics` line, with the width you ask for. It needs the app open and both the Diagrams and the LaTeX plugins. `diagram_export` with format png keeps the same kind of picture in assets/.";

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::{FIGURE, LATEX};
    use crate::tools::specs;

    /// Backticked words that are fields or values, not tools.
    const FIELDS: [&str; 6] = ["hash", "search", "base_hash", "tex", "after", "wait"];

    fn unknown_names(text: &str) -> BTreeSet<String> {
        let tools: BTreeSet<String> = specs().into_iter().map(|s| s.name).collect();
        text.split('`')
            .skip(1)
            .step_by(2)
            .filter(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_lowercase() || c == '_'))
            .filter(|w| !tools.contains(*w) && !FIELDS.contains(w))
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn the_latex_paragraph_names_only_real_tools_and_all_of_them() {
        assert_eq!(unknown_names(LATEX), BTreeSet::new());
        assert_eq!(unknown_names(FIGURE), BTreeSet::new());
        assert_eq!(
            unknown_names("Use `latex_reed` and `latex_edit`.")
                .into_iter()
                .collect::<Vec<_>>(),
            ["latex_reed"]
        );
        // Every tool is told of: the one that needs a second plugin in its own paragraph.
        for tool in crate::latex_words::TOOLS {
            let said = format!("`{tool}`");
            assert!(LATEX.contains(&said) || FIGURE.contains(&said), "{tool}");
        }
        assert!(!LATEX.contains("diagram_to_latex_figure"));
        // Nothing here says a person has to make the files.
        assert!(!LATEX.contains("in the app to make"), "{LATEX}");
        assert!(!LATEX.contains("New files"), "{LATEX}");
    }

    #[test]
    fn the_latex_paragraph_is_short_and_plain() {
        let words = LATEX.split_whitespace().count();
        assert!(words < 380, "{words} words");
        // What a client that makes charts must be told.
        for needle in ["never runs Python or any program", "PNG", "latex_add_asset"] {
            assert!(LATEX.contains(needle), "{needle}");
        }
        for jargon in ["commit", "sidecar", "SaveSource", "ADR", "dev/"] {
            assert!(!LATEX.contains(jargon), "{jargon}");
        }
        assert!(LATEX.contains("changed since"), "the hash rule");
        assert!(LATEX.contains("does not run TeX"));
    }

    #[test]
    fn the_latex_paragraph_is_in_what_the_server_tells_agents_and_in_the_skill() {
        assert!(crate::server::instructions().contains(LATEX));
        assert!(crate::server::instructions().contains(FIGURE));
        let skill = include_str!("../../../skills/kasten/SKILL.md").replace("\r\n", "\n");
        assert!(skill.contains(LATEX));
        assert!(skill.contains(FIGURE));
    }

    #[test]
    fn the_figure_paragraph_is_told_only_when_both_plugins_are_on() {
        use crate::server::instructions_for;
        let mut config = kasten_core::Config::default();
        for (diagrams, latex) in [(true, false), (false, true), (false, false)] {
            config.set_plugin_enabled("diagrams", diagrams);
            config.set_plugin_enabled("latex", latex);
            let told = instructions_for(&config);
            assert!(
                !told.contains("diagram_to_latex_figure"),
                "{diagrams} {latex}"
            );
        }
        config.set_plugin_enabled("diagrams", true);
        config.set_plugin_enabled("latex", true);
        assert!(instructions_for(&config).contains(FIGURE));
        let words = FIGURE.split_whitespace().count();
        assert!(words < 90, "{words} words");
        for jargon in ["commit", "sidecar", "mailbox", "bridge", "ADR", "dev/"] {
            assert!(!FIGURE.contains(jargon), "{jargon}");
        }
    }
}
