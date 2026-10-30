//! Help with the choice of engine. pdfLaTeX cannot read Unicode text outside
//! the Latin set, and cannot load `fontspec`, `unicode-math` or
//! `polyglossia`; XeLaTeX and LuaLaTeX can, and so can Tectonic (which is
//! XeTeX underneath). A document built with pdfLaTeX that needs them is told
//! so in a sentence, for the person and for an assistant that is fixing its
//! errors, who would otherwise chase each character.

use super::log::{Diagnostic, Severity};

/// The engine that builds with pdfLaTeX (the id the settings file uses).
const PDF_ENGINE: &str = "latexmk-pdf";

/// Packages that only XeTeX and LuaTeX can load.
const NEEDS_UNICODE_ENGINE: [&str; 3] = ["fontspec", "unicode-math", "polyglossia"];

/// The words of a log that say pdfLaTeX met something it cannot do.
fn says_unicode(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("unicode character")
        || lower.contains("requires either xetex or luatex")
        || lower.contains("requires xetex or luatex")
        || lower.contains("use xelatex or lualatex")
}

/// Whether the source loads a package that needs XeLaTeX or LuaLaTeX.
fn loads_unicode_package(source: &str) -> bool {
    source.lines().any(|line| {
        let line = line.split('%').next().unwrap_or("");
        line.contains("\\usepackage")
            && NEEDS_UNICODE_ENGINE.iter().any(|p| {
                line.split(['{', '}', ',', ' ', '[', ']'])
                    .any(|part| part == *p)
            })
    }) || source.contains("\\setmainfont")
}

/// One sentence of advice for a document built with `engine` (the settings
/// file's id; none means the default), whose root file is `main_text` and
/// whose last build said `diagnostics`, or none when the engine is fine.
pub fn engine_advice(
    engine: &str,
    main_text: &str,
    diagnostics: &[Diagnostic],
) -> Option<&'static str> {
    if engine != PDF_ENGINE {
        return None;
    }
    let complained = diagnostics
        .iter()
        .any(|d| d.severity != Severity::Info && says_unicode(&d.message));
    if complained || loads_unicode_package(main_text) {
        Some(
            "This document uses Unicode text or fontspec, which pdfLaTeX cannot build. Switch its engine to XeLaTeX (or LuaLaTeX) in the document's settings, or use Tectonic, instead of changing each character.",
        )
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn error(message: &str) -> Diagnostic {
        Diagnostic {
            file: Some("main.tex".into()),
            line: Some(3),
            severity: Severity::Error,
            message: message.into(),
            context: None,
        }
    }

    #[test]
    fn a_unicode_error_under_pdflatex_suggests_xelatex() {
        let found = [error(
            "inputenc: Unicode character € (U+20AC) not set up for use with LaTeX.",
        )];
        let advice = engine_advice("latexmk-pdf", "\\documentclass{article}", &found).unwrap();
        assert!(advice.contains("XeLaTeX"), "{advice}");
        let fontspec = [error(
            "fontspec: The fontspec package requires either XeTeX or LuaTeX.",
        )];
        assert!(engine_advice("latexmk-pdf", "", &fontspec).is_some());
    }

    #[test]
    fn a_package_that_needs_xetex_suggests_it_before_the_build_fails() {
        for source in [
            "\\usepackage{fontspec}",
            "\\usepackage[no-math]{fontspec}\n",
            "\\usepackage{amsmath, unicode-math}",
            "\\usepackage{polyglossia}",
            "\\setmainfont{Libertinus Serif}",
        ] {
            assert!(
                engine_advice("latexmk-pdf", source, &[]).is_some(),
                "{source}"
            );
        }
        // A commented line, or a package of a similar name, is not it.
        for source in [
            "% \\usepackage{fontspec}",
            "\\usepackage{fontspecial}",
            "\\documentclass{article}\n\\usepackage{amsmath}",
        ] {
            assert_eq!(engine_advice("latexmk-pdf", source, &[]), None, "{source}");
        }
    }

    #[test]
    fn engines_that_read_unicode_are_left_alone() {
        let found = [error("Unicode character x not set up for use with LaTeX.")];
        for engine in ["tectonic", "latexmk-xe", "latexmk-lua", ""] {
            assert_eq!(
                engine_advice(engine, "\\usepackage{fontspec}", &found),
                None,
                "{engine}"
            );
        }
    }

    #[test]
    fn a_note_about_a_box_is_not_a_complaint() {
        let mut note = error("Unicode character in an overfull box");
        note.severity = Severity::Info;
        assert_eq!(engine_advice("latexmk-pdf", "", &[note]), None);
    }
}
