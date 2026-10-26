//! Export PDF: the built PDF is saved beside the document's root file, in
//! its LaTeX folder, as one commit. It is the only binary the vault takes
//! from the LaTeX side, and only in a LaTeX folder; builds themselves live in
//! the cache and are never committed.

use super::docs::LatexDoc;
use crate::error::{Error, Result};

/// The largest PDF an export keeps.
pub const MAX_PDF_BYTES: usize = 64 * 1024 * 1024;

/// Where the export of `doc` goes: the root file's name with `.pdf`.
pub fn pdf_path(doc: &LatexDoc) -> String {
    let stem = doc.main_path.strip_suffix(".tex").unwrap_or(&doc.main_path);
    format!("{stem}.pdf")
}

/// Refuses bytes that are not a PDF or are too big to keep.
pub(crate) fn check_pdf(bytes: &[u8]) -> Result<()> {
    if !bytes.starts_with(b"%PDF-") {
        return Err(Error::Invalid(
            "That is not a PDF, so it was not saved".to_owned(),
        ));
    }
    if bytes.len() > MAX_PDF_BYTES {
        return Err(Error::Invalid(format!(
            "A PDF may be at most {} MB; this one is {} MB",
            MAX_PDF_BYTES / 1024 / 1024,
            bytes.len() / 1024 / 1024
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(main_path: &str) -> LatexDoc {
        LatexDoc {
            folder: "p/latex/a".into(),
            main: "main.tex".into(),
            main_path: main_path.into(),
            title: "a".into(),
            engine: "tectonic".into(),
            bibliography: "local".into(),
            locked: false,
            has_config: false,
        }
    }

    #[test]
    fn the_pdf_sits_beside_the_root_file() {
        assert_eq!(pdf_path(&doc("p/latex/a/main.tex")), "p/latex/a/main.pdf");
        assert_eq!(
            pdf_path(&doc("p/latex/a/src/paper.tex")),
            "p/latex/a/src/paper.pdf"
        );
    }

    #[test]
    fn only_pdfs_of_a_sensible_size() {
        assert!(check_pdf(b"%PDF-1.7\n...").is_ok());
        assert!(check_pdf(b"<html>").is_err());
        assert!(check_pdf(b"").is_err());
    }
}
