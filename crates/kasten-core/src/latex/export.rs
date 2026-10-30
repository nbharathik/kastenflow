//! Export PDF: the built PDF is saved beside the document's root file, in
//! its LaTeX folder, as one commit. It is the only binary the vault takes
//! from the LaTeX side, and only in a LaTeX folder; builds themselves live in
//! the cache and are never committed.

use std::fs::{self, File};
use std::io::Read;
use std::path::Path;
use std::time::SystemTime;

use super::docs::LatexDoc;
use super::last_build::plain_file;
use crate::error::{Error, Result};

/// The largest PDF an export keeps.
pub const MAX_PDF_BYTES: usize = 64 * 1024 * 1024;

/// The PDF the app's last build of `doc` left in the cache under `root`, with
/// when it was made. Read only from a plain file in a plain cache folder, and
/// only if it is a PDF of a size an export keeps. This is the one place the
/// bytes of an agent's export come from: never from the asker.
pub(crate) fn cached_pdf(root: &Path, doc: &LatexDoc) -> Result<(Vec<u8>, Option<SystemTime>)> {
    let stem = Path::new(&doc.main)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let rel = super::build_dir(&doc.folder);
    let name = format!("{stem}.pdf");
    let mut parts: Vec<&str> = rel.split('/').collect();
    parts.extend(["out", name.as_str()]);
    let none = || {
        Error::Invalid(format!(
            "There is no built PDF of “{}” yet: build it in the app first",
            doc.title
        ))
    };
    let path = plain_file(root, &parts).ok_or_else(none)?;
    let meta = fs::metadata(&path).map_err(|_| none())?;
    if meta.len() > MAX_PDF_BYTES as u64 {
        return Err(Error::Invalid(format!(
            "The built PDF of “{}” is too big to keep: a PDF may be at most {} MB",
            doc.title,
            MAX_PDF_BYTES / 1024 / 1024
        )));
    }
    let mut bytes = Vec::new();
    File::open(&path)
        .and_then(|file| file.take(MAX_PDF_BYTES as u64 + 1).read_to_end(&mut bytes))?;
    check_pdf(&bytes)?;
    Ok((bytes, meta.modified().ok()))
}

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
