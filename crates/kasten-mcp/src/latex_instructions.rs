//! What agents are told about LaTeX documents: how to read, change and check
//! one. The same text is in the `kasten` skill; a test keeps the two equal and
//! keeps every tool it names a real one.

/// The paragraph, as the server tells it and the skill carries it.
pub const LATEX: &str = "## LaTeX documents

When the LaTeX plugin is on, a LaTeX document is a folder with a root `.tex` file, and `latex_list` shows them. Read a file with `latex_read` (the root file when you name none): it gives the text and its `hash`. Change it with `latex_edit`: the `search` text must be in the file once, and `base_hash` must be the hash you read. If you are told the file changed since you read it, nothing was written: read it again and redo the change. A locked document is read-only, and a change that takes out much of a file waits for the user's review. New files and settings are the user's to make in the app.

`latex_build` does not run TeX. It tells you what the app's last build said, with the file and line of each error, and says when a file changed after that build. To fix errors: read the build, read the file, make small `latex_edit` changes, then read the build again. Leave the user's wording, commands and packages alone unless a fix needs them changed, and say what you changed.";

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::LATEX;
    use crate::tools::specs;

    /// Backticked words that are fields or values, not tools.
    const FIELDS: [&str; 4] = ["hash", "search", "base_hash", "tex"];

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
    fn the_latex_paragraph_names_only_real_tools_and_all_four() {
        assert_eq!(unknown_names(LATEX), BTreeSet::new());
        assert_eq!(
            unknown_names("Use `latex_reed` and `latex_edit`.")
                .into_iter()
                .collect::<Vec<_>>(),
            ["latex_reed"]
        );
        for tool in ["latex_list", "latex_read", "latex_edit", "latex_build"] {
            assert!(LATEX.contains(&format!("`{tool}`")), "{tool}");
        }
    }

    #[test]
    fn the_latex_paragraph_is_short_and_plain() {
        let words = LATEX.split_whitespace().count();
        assert!(words < 250, "{words} words");
        for jargon in ["commit", "sidecar", "SaveSource", "ADR", "dev/"] {
            assert!(!LATEX.contains(jargon), "{jargon}");
        }
        assert!(LATEX.contains("changed since"), "the hash rule");
        assert!(LATEX.contains("does not run TeX"));
    }

    #[test]
    fn the_latex_paragraph_is_in_what_the_server_tells_agents_and_in_the_skill() {
        assert!(crate::server::instructions().contains(LATEX));
        let skill = include_str!("../../../skills/kasten/SKILL.md").replace("\r\n", "\n");
        assert!(skill.contains(LATEX));
    }
}
