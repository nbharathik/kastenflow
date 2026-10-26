//! LaTeX documents in the vault. A document is a folder holding a root
//! `.tex` file anywhere in the vault (new ones go to
//! `projects/<project>/latex/<name>/main.tex` or `library/latex/<name>/main.tex`),
//! with an optional `kasten-latex.yaml` beside it. The `.tex`, `.sty`, `.cls`
//! and `.bst` files in such a folder, and a `.bib` inside it, are editable
//! text saved through `Kasten::save_source`. Builds are made in
//! `.kasten/cache/latex/<hash>/` and never committed.

mod config;
mod docs;
mod export;
mod from_markdown;
mod last_build;
mod log;
mod log_text;
mod save;
mod sent;
mod template;
mod text;

pub use config::{BIBLIOGRAPHIES, DEFAULT_BIBLIOGRAPHY, DEFAULT_ENGINE, ENGINES, LatexConfig};
pub use docs::{LatexDoc, doc_containing};
pub(crate) use docs::{LatexFacts, dir_of, facts_of, find_docs, read_facts};
pub(crate) use export::check_pdf;
pub use export::{MAX_PDF_BYTES, pdf_path};
pub use from_markdown::{Converted, Mode, escape_text, markdown_to_latex, page_to_latex};
pub use last_build::{LastBuild, MAX_LOG_BYTES};
pub(crate) use last_build::{is_link, read as read_last_build};
pub use log::{Diagnostic, Severity, parse_log, parse_log_bytes};
pub(crate) use save::{Plan, conflict_path, plan};
pub use save::{SourceFile, SourceSaved};
pub use sent::{Material, Sent};
pub use template::{Template, mode_of_document};
pub use text::{searchable, snippet_around};

/// The settings file beside a document's root.
pub const CONFIG_FILE: &str = "kasten-latex.yaml";
/// The kinds of file a LaTeX folder holds as editable text.
pub const SOURCE_EXTENSIONS: [&str; 5] = [".tex", ".sty", ".cls", ".bst", ".bib"];
/// The largest source file saved (the size every single write is held to).
pub const MAX_SOURCE_BYTES: usize = 204_800;

/// Whether `path` names a kind of file a LaTeX folder holds as text.
pub fn is_source_path(path: &str) -> bool {
    SOURCE_EXTENSIONS.iter().any(|ext| path.ends_with(ext))
}

/// Where builds of the document in `folder` are made: in the cache, which
/// is never committed.
pub fn build_dir(folder: &str) -> String {
    format!(
        ".kasten/cache/latex/{}",
        crate::note::content_hash(folder.trim_end_matches('/'))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_source_files_by_their_ending() {
        for path in ["a/main.tex", "a/x.sty", "a/x.cls", "a/x.bst", "a/refs.bib"] {
            assert!(is_source_path(path), "{path}");
        }
        for path in ["a/x.pdf", "a/x.md", "a/x.texx", "a/kasten-latex.yaml"] {
            assert!(!is_source_path(path), "{path}");
        }
    }

    #[test]
    fn builds_stay_in_the_cache_whatever_the_folder_is_called() {
        let dir = build_dir("projects/p/latex/a");
        assert!(dir.starts_with(".kasten/cache/latex/"), "{dir}");
        assert_eq!(dir, build_dir("projects/p/latex/a/"));
        assert_ne!(dir, build_dir("projects/p/latex/b"));
    }
}
