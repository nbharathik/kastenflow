//! The log reader against the other formats TeX and its friends print, and
//! against hostile input: huge lines, deep nesting, floods, NUL bytes.

use crate::plugins::latex::log::{Diagnostic, Severity, parse_log, parse_log_bytes};

fn d(severity: Severity, file: Option<&str>, line: Option<u32>, message: &str) -> Diagnostic {
    Diagnostic {
        file: file.map(str::to_owned),
        line,
        severity,
        message: message.to_owned(),
        context: None,
    }
}

/// `parse_log` without the context lines (those have their own tests).
fn parse_bare(text: &str) -> Vec<Diagnostic> {
    let mut found = parse_log(text);
    for d in &mut found {
        d.context = None;
    }
    found
}

const MAIN: Option<&str> = Some("main.tex");

#[test]
fn file_line_error_style_gives_the_file_and_line_of_the_line() {
    let log = "(./main.tex\n./main.tex:12: Undefined control sequence.\nl.12 \\foo\n         \n\
./main.tex:15: LaTeX Error: Environment foo undefined.\n\nSee the LaTeX manual.\n\nl.15 \\begin{foo}\n";
    assert_eq!(
        parse_bare(log),
        vec![
            d(
                Severity::Error,
                MAIN,
                Some(12),
                "Undefined control sequence."
            ),
            d(
                Severity::Error,
                MAIN,
                Some(15),
                "Environment foo undefined."
            ),
        ]
    );
}

#[test]
fn file_line_error_style_with_a_windows_path() {
    let log = "(C:/Users/u/book/main.tex\nC:/Users/u/book/chapters/one.tex:7: Undefined control sequence.\nl.7 \\x\n";
    assert_eq!(
        parse_bare(log),
        vec![d(
            Severity::Error,
            Some("C:/Users/u/book/chapters/one.tex"),
            Some(7),
            "Undefined control sequence."
        )]
    );
}

#[test]
fn a_package_error_continues_on_package_lines() {
    let log = "(./main.tex\n! Package hyperref Error: Wrong DVI mode driver option `dvips',\n\
(hyperref)                because pdfTeX is running.\n\n\
See the hyperref package documentation for explanation.\nType  H <return>  for immediate help.\n \
...                                              \n\nl.7 \\begin{document}\n";
    assert_eq!(
        parse_bare(log),
        vec![d(
            Severity::Error,
            MAIN,
            Some(7),
            "hyperref: Wrong DVI mode driver option `dvips', because pdfTeX is running."
        )]
    );
}

#[test]
fn a_missing_style_file_with_straight_quotes_gets_its_line() {
    let log = "(./main.tex\n! LaTeX Error: File 'x.sty' not found.\n\n\
Type X to quit or <RETURN> to proceed,\nor enter new name. (Default extension: sty)\n\n\
Enter file name: \n! Emergency stop.\n<read *> \n\nl.3 \\usepackage{x}\n\n\
*** (job aborted, file error in nonstop mode)\n";
    assert_eq!(
        parse_bare(log),
        vec![d(Severity::Error, MAIN, Some(3), "File 'x.sty' not found.")]
    );
}

#[test]
fn undefined_citations_and_references_with_straight_quotes() {
    let log = "(./main.tex\nLaTeX Warning: Citation 'k' on page 1 undefined on input line 15.\n\n\
LaTeX Warning: Reference 'sec:a' on page 2 undefined on input line 18.\n)\n";
    assert_eq!(
        parse_bare(log),
        vec![
            d(
                Severity::Warning,
                MAIN,
                Some(15),
                "Citation 'k' on page 1 undefined"
            ),
            d(
                Severity::Warning,
                MAIN,
                Some(18),
                "Reference 'sec:a' on page 2 undefined"
            ),
        ]
    );
}

#[test]
fn a_pdftex_warning_and_its_context_do_not_unbalance_the_files() {
    // the context line holds a "(" that never closes: it must not make the
    // next warning, after a.tex has closed, belong to a.tex
    let log = "(./main.tex\n(./a.tex\npdfTeX warning (ext4): destination with the same identifier has been already used\n\
<to be read again> \n                   \\relax \nl.12 \\foo (bar\n\n)\nLaTeX Warning: Label `x' multiply defined.\n";
    assert_eq!(
        parse_bare(log),
        vec![
            d(
                Severity::Warning,
                Some("a.tex"),
                None,
                "pdfTeX warning (ext4): destination with the same identifier has been already used"
            ),
            d(Severity::Warning, MAIN, None, "Label `x' multiply defined."),
        ]
    );
}

#[test]
fn a_line_that_only_looks_like_a_banner_does_not_drop_the_errors() {
    let log =
        "(./a.tex\n! Undefined control sequence.\nl.1 \\x\nThis is a test of TeX typesetting\n";
    assert_eq!(parse_log(log).len(), 1);
}

#[test]
fn a_flood_of_box_complaints_does_not_push_out_the_error_after_it() {
    let mut log = String::from("(./main.tex\n");
    for i in 0..5000 {
        log += &format!(
            "Overfull \\hbox (1.0pt too wide) in paragraph at lines {i}--{}\n\n",
            i + 1
        );
    }
    log += "! Undefined control sequence.\nl.9 \\x\n";
    let found = parse_bare(&log);
    assert_eq!(
        found
            .iter()
            .filter(|x| x.severity == Severity::Info)
            .count(),
        2000
    );
    assert_eq!(
        found.last(),
        Some(&d(
            Severity::Error,
            MAIN,
            Some(9),
            "Undefined control sequence."
        ))
    );
}

#[test]
fn a_10_mb_line_gives_a_short_message() {
    let log = format!("(./main.tex\nLaTeX Warning: {}\n", "x".repeat(10_000_000));
    let found = parse_log(&log);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].message.chars().count(), 1000);
    // the same line as an error, and as plain text
    let log = format!("(./main.tex\n! {}\nl.1 \\x\n", "y".repeat(10_000_000));
    assert_eq!(parse_log(&log)[0].message.chars().count(), 1000);
    assert!(parse_log(&"z".repeat(10_000_000)).is_empty());
    // 10 MB of parentheses, braces and quotes on one line
    for unit in ["(", ")", "{", "<", "\"", "(\"", "(a.tex ", "{(<"] {
        let _ = parse_log(&unit.repeat(10_000_000 / unit.len()));
    }
}

#[test]
fn a_million_wrapped_lines_join_into_one_and_are_read() {
    let log = format!("{}\n", "a".repeat(79)).repeat(100_000);
    assert!(parse_log(&log).is_empty());
    let log = format!("LaTeX Warning: {}\n", "(a".repeat(30))
        + &format!("{}\n", "b".repeat(79)).repeat(50_000);
    assert_eq!(parse_log(&log).len(), 1);
}

#[test]
fn deeply_nested_parentheses_do_not_break_the_file_stack() {
    let mut log = "(./a.tex ".repeat(100_000);
    log.push_str("\n! Undefined control sequence.\nl.4 \\x\n");
    let found = parse_log(&log);
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].file.as_deref(), Some("a.tex"));
    assert_eq!(found[0].line, Some(4));
    // opened over many lines, then closed all at once
    let mut log = "(./a.tex\n".repeat(5_000);
    log.push_str(&")".repeat(5_000));
    log.push_str("\n(./z.tex\n! Undefined control sequence.\nl.4 \\x\n");
    assert_eq!(parse_log(&log)[0].file.as_deref(), Some("z.tex"));
}

#[test]
fn nul_bytes_and_bad_utf8_are_read_without_trouble() {
    let log = b"(./a.tex\n! Undefined\0 control.\nl.4 \0\n(./b\xff.tex\nLaTeX Warning: x\xc3 on input line 9.\n";
    let found = parse_log_bytes(log);
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].line, Some(4));
    assert_eq!(found[1].line, Some(9));
    let _ = parse_log_bytes(&[0; 100_000]);
    let _ = parse_log_bytes(&[0xff; 100_000]);
    let _ = parse_log_bytes(&b"(\0\n)\0\n!\0\nl.\0".repeat(10_000));
}

#[test]
fn many_tex_runs_with_bibtex_between_are_cheap_and_keep_the_last() {
    let mut log = String::new();
    for i in 0..5_000 {
        log += &format!(
            "This is pdfTeX, Version 3.1\n(./a.tex\nOverfull \\hbox (1.0pt too wide) detected at line {i}\n\
This is BibTeX, Version 0.99d\nWarning--entry {i}\n"
        );
    }
    let found = parse_log(&log);
    // BibTeX's stay (to the cap), only the last run's box is kept
    assert_eq!(
        found
            .iter()
            .filter(|x| x.severity == Severity::Info)
            .count(),
        1
    );
    assert_eq!(
        found
            .iter()
            .filter(|x| x.severity == Severity::Warning)
            .count(),
        2000
    );
}

#[test]
fn numbers_in_the_log_that_overflow_give_no_line() {
    let log = "(./a.tex\n! Undefined control sequence.\nl.99999999999999999999 \\x\n\
./a.tex:99999999999999999999: boom\nOverfull \\hbox in paragraph at lines 99999999999999999999--3\n";
    for found in parse_log(log) {
        assert_eq!(found.line, None, "{found:?}");
    }
}
