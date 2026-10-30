//! The TeX context an error keeps: the lines TeX prints after `! message`
//! (`l.12 \sectoin` and the rest of the line), which show where it stopped.

use super::log::{Severity, parse_log};

const UNDEFINED: &str =
    include_str!("../../../../fixtures/latex/logs/undefined-control-sequence.log");
const NESTED: &str = include_str!("../../../../fixtures/latex/logs/nested-includes.log");

#[test]
fn an_error_keeps_its_context_lines_as_tex_printed_them() {
    let found = parse_log(UNDEFINED);
    assert_eq!(found.len(), 2, "{found:?}");
    assert_eq!(
        found[0].context.as_deref(),
        Some("l.12 \\sectoin\n             {Introduction}")
    );
    // an `<argument>`-style line before `l.n` is part of the context, and the
    // empty line between them is not
    assert_eq!(
        found[1].context.as_deref(),
        Some(
            "<recently read> \\textbff\nl.20 This is \\textbff\n                     {bold} text."
        )
    );
}

#[test]
fn only_errors_carry_a_context_and_the_message_is_unchanged() {
    for d in parse_log(NESTED) {
        if d.severity != Severity::Error {
            assert_eq!(d.context, None, "{d:?}");
        }
    }
    let found = parse_log(UNDEFINED);
    assert_eq!(found[0].message, "Undefined control sequence.");
    assert_eq!(found[0].line, Some(12));
}

#[test]
fn the_help_text_and_the_prompt_are_not_context() {
    let log = "(./main.tex\n! LaTeX Error: Environment foo undefined.\n\nSee the LaTeX manual or LaTeX Companion for explanation.\n\
Type  H <return>  for immediate help.\n ...                                              \n\nl.15 \\begin{foo}\n                \n?\n";
    let found = parse_log(log);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(found[0].context.as_deref(), Some("l.15 \\begin{foo}"));
}

#[test]
fn an_emergency_stop_hands_its_context_to_the_error_before() {
    let log = "(./main.tex\n! LaTeX Error: File `x.sty' not found.\n\n\
Type X to quit or <RETURN> to proceed,\nor enter new name. (Default extension: sty)\n\n\
Enter file name: \n! Emergency stop.\n<read *> \n\nl.3 \\usepackage{x}\n\n\
*** (job aborted, file error in nonstop mode)\n";
    let found = parse_log(log);
    assert_eq!(found.len(), 1, "{found:?}");
    assert_eq!(
        found[0].context.as_deref(),
        Some("<read *>\nl.3 \\usepackage{x}")
    );
}

#[test]
fn file_line_error_style_keeps_the_context_too() {
    let log = "(./main.tex\n./main.tex:12: Undefined control sequence.\nl.12 \\foo\n         \n";
    let found = parse_log(log);
    assert_eq!(found[0].context.as_deref(), Some("l.12 \\foo"));
}

#[test]
fn a_context_is_short_and_a_missing_one_is_none() {
    let long = format!(
        "(./a.tex\n! Undefined control sequence.\nl.4 {}\n",
        "x".repeat(100_000)
    );
    let found = parse_log(&long);
    assert!(found[0].context.as_deref().unwrap().chars().count() <= 400);
    let none = parse_log("(./a.tex\n! Undefined control sequence.\n");
    assert_eq!(none[0].context, None);
}
