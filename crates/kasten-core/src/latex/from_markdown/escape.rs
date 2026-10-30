//! Writing text so LaTeX prints it as it is: the characters TeX reads as
//! commands are escaped, and what is passed through (math, links) is checked
//! first so it cannot reach outside its own place.

/// Appends `c` so that LaTeX prints it. Control characters become a space.
pub(super) fn push_escaped(out: &mut String, c: char) {
    match c {
        '&' | '%' | '$' | '#' | '_' | '{' | '}' => {
            out.push('\\');
            out.push(c);
        }
        '~' => out.push_str("\\textasciitilde{}"),
        '^' => out.push_str("\\textasciicircum{}"),
        '\\' => out.push_str("\\textbackslash{}"),
        // In the default font these print as other marks.
        '<' => out.push_str("\\textless{}"),
        '>' => out.push_str("\\textgreater{}"),
        '|' => out.push_str("\\textbar{}"),
        '\t' => out.push(' '),
        '\n' | '\r' => out.push(' '),
        c if c.is_control() => out.push(' '),
        c => out.push(c),
    }
}

/// `text` written so that LaTeX prints it as it is.
pub fn escape_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 8);
    for c in text.chars() {
        push_escaped(&mut out, c);
    }
    out
}

/// A URL for the first argument of `\href`: `%` and `#` are escaped, and
/// anything that could close or open a group, or end the line, is written as
/// a percent code.
pub(super) fn url_argument(url: &str) -> String {
    let mut out = String::with_capacity(url.len() + 8);
    for c in url.chars() {
        match c {
            '%' => out.push_str("\\%"),
            '#' => out.push_str("\\#"),
            '\\' => out.push_str("\\%5C"),
            '{' => out.push_str("\\%7B"),
            '}' => out.push_str("\\%7D"),
            c if c.is_whitespace() || c.is_control() => out.push_str("\\%20"),
            c => out.push(c),
        }
    }
    out
}

/// The scheme of `url` in lower case (`https`), when it starts with one.
pub(super) fn scheme_of(url: &str) -> Option<String> {
    let (scheme, _) = url.split_once(':')?;
    let mut chars = scheme.chars();
    let first = chars.next()?;
    if !first.is_ascii_alphabetic()
        || !chars.all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
    {
        return None;
    }
    Some(scheme.to_ascii_lowercase())
}

/// Whether a link to `url` is kept in the PDF: web and mail links only.
pub(super) fn link_allowed(url: &str) -> bool {
    matches!(
        scheme_of(url).as_deref(),
        Some("http" | "https" | "mailto" | "ftp")
    )
}

/// A line of free text for a `%` comment: one line, no control characters,
/// not too long.
pub(super) fn comment_text(text: &str) -> String {
    let mut out: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(200)
        .collect();
    out.truncate(out.trim_end().len());
    out.trim_start().to_owned()
}

/// Control sequences that do not belong in a formula pasted from a page: they
/// read or write files, change how TeX reads the rest, or end the document.
const DENIED: [&str; 32] = [
    "par",
    "input",
    "include",
    "includeonly",
    "openin",
    "openout",
    "closein",
    "closeout",
    "write",
    "read",
    "readline",
    "immediate",
    "newwrite",
    "newread",
    "usepackage",
    "RequirePackage",
    "documentclass",
    "catcode",
    "def",
    "edef",
    "gdef",
    "xdef",
    "let",
    "csname",
    "scantokens",
    "verb",
    "special",
    "directlua",
    "pdfshellescape",
    "ShellEscape",
    "href",
    "url",
];

/// More names, beyond `DENIED`: definitions, ways to build a name, and the
/// commands that read a file.
const ALSO_DENIED: [&str; 40] = [
    "newcommand",
    "renewcommand",
    "providecommand",
    "makeatletter",
    "makeatother",
    "expandafter",
    "futurelet",
    "afterassignment",
    "aftergroup",
    "string",
    "detokenize",
    "unexpanded",
    "noexpand",
    "endinput",
    "endcsname",
    "lccode",
    "uccode",
    "mathcode",
    "uppercase",
    "lowercase",
    "lstinputlisting",
    "verbatiminput",
    "VerbatimInput",
    "inputminted",
    "includegraphics",
    "includepdf",
    "import",
    "subfile",
    "bibliography",
    "bibliographystyle",
    "addbibresource",
    "fi",
    "else",
    "or",
    "loop",
    "repeat",
    "begingroup",
    "endgroup",
    "bgroup",
    "egroup",
];

/// Whether the control sequence `\name` stays out of a formula.
fn name_is_denied(name: &str) -> bool {
    if name == "iff" {
        return false;
    }
    DENIED.contains(&name)
        || ALSO_DENIED.contains(&name)
        || name.starts_with("if")
        || [
            "pdf",
            "lua",
            "late",
            "XeTeX",
            "protected",
            "Declare",
            "New",
            "Renew",
            "Provide",
            "Input",
            "If",
        ]
        .iter()
        .any(|prefix| name.starts_with(prefix))
}

/// Whether the `{name}` at `from` (after `\begin` or `\end`) is a math
/// environment; anything else (`verbatim`, `comment`, ...) could swallow the
/// rest of the document.
fn environment_is_math(chars: &[char], from: usize) -> bool {
    if chars.get(from) != Some(&'{') {
        return false;
    }
    let name: String = chars[from + 1..]
        .iter()
        .take(40)
        .take_while(|c| **c != '}')
        .collect();
    let name = name.trim_end_matches('*');
    name.ends_with("matrix")
        || [
            "aligned",
            "alignedat",
            "array",
            "cases",
            "dcases",
            "rcases",
            "split",
            "gathered",
            "align",
            "alignat",
            "gather",
            "equation",
            "multline",
            "subarray",
            "flalign",
            "eqnarray",
        ]
        .contains(&name)
}

/// Whether `math` can be put between `$ $` or `\[ \]` without leaving them:
/// groups balance, no comment starts, no further `$`, and none of the
/// commands in `DENIED`.
pub(super) fn math_is_safe(math: &str) -> bool {
    if math.trim().is_empty() || math.len() > 20_000 {
        return false;
    }
    if math.contains("{document}") || math.contains("{filecontents") {
        return false;
    }
    // `^^69` is a way to write `i`: it could spell a denied command.
    if math.contains("^^") {
        return false;
    }
    // A blank line ends a paragraph, and a formula cannot.
    if math.lines().any(|line| line.trim().is_empty()) && math.trim().contains('\n') {
        return false;
    }
    let chars: Vec<char> = math.chars().collect();
    let mut depth = 0i32;
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '\\' => {
                let name: String = chars[i + 1..]
                    .iter()
                    .take_while(|c| c.is_ascii_alphabetic())
                    .collect();
                if name_is_denied(&name) {
                    return false;
                }
                match chars.get(i + 1) {
                    // `\@input` and friends, and a way out of the formula (`\]`, `\)`).
                    Some('@' | '[' | ']' | '(' | ')') if name.is_empty() => return false,
                    _ => {}
                }
                if (name == "begin" || name == "end")
                    && !environment_is_math(&chars, i + 1 + name.len())
                {
                    return false;
                }
                // `\\`, `\{`, `\%` and the like: the next character is not read again.
                i += 1 + name.chars().count().max(1);
                continue;
            }
            '%' | '$' => return false,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            c if c.is_control() && c != '\n' && c != '\t' => return false,
            _ => {}
        }
        i += 1;
    }
    depth == 0
}

/// A key that is safe to write in `\cite{}`.
pub(super) fn cite_key_ok(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 120
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_:.-+/".contains(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_special_is_escaped() {
        assert_eq!(
            escape_text("& % $ # _ { } ~ ^ \\"),
            "\\& \\% \\$ \\# \\_ \\{ \\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}"
        );
        assert_eq!(escape_text("a\u{0}b\nc"), "a b c");
    }

    #[test]
    fn urls_cannot_break_out_of_their_argument() {
        assert_eq!(
            url_argument("http://x/a b%c#d{e}"),
            "http://x/a\\%20b\\%c\\#d\\%7Be\\%7D"
        );
        assert!(link_allowed("https://x.org"));
        assert!(link_allowed("MAILTO:a@b.c"));
        assert!(!link_allowed("javascript:alert(1)"));
        assert!(!link_allowed("file:///etc/passwd"));
        assert!(!link_allowed("notes/page.md"));
    }

    #[test]
    fn math_is_checked_before_it_is_passed_through() {
        for ok in [
            "x^2 + y_1",
            "\\frac{a}{b}",
            "50\\%",
            "\\{a\\}",
            "a \\\\ b",
            "\\partial x",
            "a\nb",
        ] {
            assert!(math_is_safe(ok), "{ok}");
        }
        for bad in [
            "50%",
            "\\input{evil}",
            "\\write18{x}",
            "a}b",
            "{a",
            "a$b",
            "\\end{document}",
            "\\verb|x|",
            "a\n\nb",
            "",
            "  ",
        ] {
            assert!(!math_is_safe(bad), "{bad}");
        }
    }

    #[test]
    fn math_that_reads_files_or_hides_a_command_is_refused() {
        for bad in [
            "\\^^69nput{/etc/passwd}",
            "\\@input{x}",
            "\\makeatletter x",
            "\\pdffiledump file {x}",
            "\\InputIfFileExists{x}{}{}",
            "\\newcommand{\\a}{b}",
            "\\begin{verbatim} x",
            "x \\] \\input{y}",
            "\\iffalse x",
            "\\immediate\\write18{ls}",
            "\\lstinputlisting{x}",
        ] {
            assert!(!math_is_safe(bad), "{bad}");
        }
    }

    #[test]
    fn ordinary_formulas_still_pass() {
        for ok in [
            "a \\iff b \\infty \\iint f",
            "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
            "\\begin{aligned} x &= 1 \\end{aligned}",
        ] {
            assert!(math_is_safe(ok), "{ok}");
        }
    }

    #[test]
    fn citation_keys_are_plain() {
        assert!(cite_key_ok("knuth84"));
        assert!(cite_key_ok("a:b.c-d_e+f/g"));
        assert!(!cite_key_ok("bad%key"));
        assert!(!cite_key_ok(""));
        assert!(!cite_key_ok("a b"));
        assert!(!cite_key_ok("é"));
    }

    #[test]
    fn comments_stay_on_one_line() {
        assert_eq!(comment_text("a\nb\r\nc"), "a b  c");
        assert_eq!(comment_text(&"x".repeat(500)).len(), 200);
    }
}
