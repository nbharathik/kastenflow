//! The log reader against hand-written logs (`fixtures/latex/logs/`), a few
//! small cases of its own, and a walk over every cut of every log for panics.

use crate::plugins::latex::log::{Diagnostic, Severity, parse_log, parse_log_bytes};

macro_rules! fixture {
    ($name:literal) => {
        include_str!(concat!(
            "../../../../../../fixtures/latex/logs/",
            $name,
            ".log"
        ))
    };
}

fn d(severity: Severity, file: Option<&str>, line: Option<u32>, message: &str) -> Diagnostic {
    Diagnostic {
        file: file.map(str::to_owned),
        line,
        severity,
        message: message.to_owned(),
        context: None,
    }
}

/// `parse_log` without the context lines (those have their own tests), so
/// the cases below compare the file, line and message only.
fn parse_bare(text: &str) -> Vec<Diagnostic> {
    let mut found = parse_log(text);
    for d in &mut found {
        d.context = None;
    }
    found
}

fn err(file: Option<&str>, line: Option<u32>, message: &str) -> Diagnostic {
    d(Severity::Error, file, line, message)
}

fn warn(file: Option<&str>, line: Option<u32>, message: &str) -> Diagnostic {
    d(Severity::Warning, file, line, message)
}

fn info(file: Option<&str>, line: Option<u32>, message: &str) -> Diagnostic {
    d(Severity::Info, file, line, message)
}

const MAIN: Option<&str> = Some("main.tex");

struct Case {
    name: &'static str,
    log: &'static str,
    want: Vec<Diagnostic>,
}

fn cases() -> Vec<Case> {
    let notes = Some("chapters/my notes.tex");
    vec![
        Case {
            name: "undefined-control-sequence",
            log: fixture!("undefined-control-sequence"),
            want: vec![
                err(MAIN, Some(12), "Undefined control sequence."),
                err(MAIN, Some(20), "Undefined control sequence."),
            ],
        },
        Case {
            name: "missing-dollar",
            log: fixture!("missing-dollar"),
            want: vec![
                err(MAIN, Some(14), "Missing $ inserted."),
                err(MAIN, Some(14), "Missing $ inserted."),
                err(MAIN, Some(22), "Extra }, or forgotten $."),
            ],
        },
        Case {
            name: "missing-file",
            log: fixture!("missing-file"),
            want: vec![
                err(MAIN, Some(9), "File `figure1.png' not found."),
                err(MAIN, Some(15), "I can't find file `chapter2'."),
            ],
        },
        Case {
            name: "undefined-citation",
            log: fixture!("undefined-citation"),
            want: vec![
                warn(
                    MAIN,
                    Some(8),
                    "hyperref: Token not allowed in a PDF string (Unicode): removing `math shift'",
                ),
                warn(
                    MAIN,
                    Some(15),
                    "natbib: Citation `knuth' on page 1 undefined",
                ),
                warn(MAIN, Some(18), "Reference `sec:method' on page 1 undefined"),
                warn(
                    MAIN,
                    Some(21),
                    "natbib: Citation `ctan' on page 1 undefined",
                ),
                warn(MAIN, None, "natbib: There were undefined citations."),
                warn(MAIN, None, "There were undefined references."),
                warn(
                    MAIN,
                    None,
                    "Label(s) may have changed. Rerun to get cross-references right.",
                ),
            ],
        },
        Case {
            name: "overfull-box",
            log: fixture!("overfull-box"),
            want: vec![
                info(
                    MAIN,
                    Some(20),
                    "Overfull \\hbox (23.55038pt too wide) in paragraph at lines 20--22",
                ),
                info(
                    MAIN,
                    Some(31),
                    "Underfull \\hbox (badness 10000) in paragraph at lines 31--33",
                ),
                info(
                    MAIN,
                    None,
                    "Overfull \\vbox (12.0pt too high) has occurred while \\output is active []",
                ),
                info(
                    MAIN,
                    Some(40),
                    "Underfull \\vbox (badness 1234) detected at line 40",
                ),
                info(
                    MAIN,
                    Some(44),
                    "Overfull \\hbox (4.3pt too wide) in alignment at lines 44--50",
                ),
                warn(
                    MAIN,
                    None,
                    "Missing character: There is no é in font cmr10!",
                ),
            ],
        },
        Case {
            name: "runaway-argument",
            log: fixture!("runaway-argument"),
            want: vec![
                err(
                    MAIN,
                    Some(9),
                    "Paragraph ended before \\section was complete.",
                ),
                err(MAIN, None, "File ended while scanning use of \\textbf."),
            ],
        },
        Case {
            name: "tectonic",
            log: fixture!("tectonic"),
            want: vec![
                info(
                    MAIN,
                    Some(10),
                    "Overfull \\hbox (12.4pt too wide) in paragraph at lines 10--11",
                ),
                warn(MAIN, Some(14), "Reference `fig:a' on page 1 undefined"),
                err(MAIN, Some(16), "Undefined control sequence"),
                err(
                    None,
                    None,
                    "halted on potentially-recoverable error as specified",
                ),
            ],
        },
        Case {
            name: "latexmk-multipass",
            log: fixture!("latexmk-multipass"),
            want: vec![
                warn(None, None, "I didn't find a database entry for \"ctan\""),
                info(
                    MAIN,
                    Some(20),
                    "Overfull \\hbox (7.2pt too wide) in paragraph at lines 20--21",
                ),
                warn(MAIN, Some(16), "Citation `ctan' on page 1 undefined"),
                warn(MAIN, None, "There were undefined references."),
            ],
        },
        Case {
            name: "nested-includes",
            log: fixture!("nested-includes"),
            want: vec![
                warn(notes, Some(5), "Reference `eq:main' on page 3 undefined"),
                err(notes, Some(9), "Undefined control sequence."),
                info(
                    Some("chapters/final.tex"),
                    Some(3),
                    "Underfull \\hbox (badness 5000) in paragraph at lines 3--4",
                ),
            ],
        },
    ]
}

#[test]
fn every_fixture_log_gives_its_diagnostics() {
    let cases = cases();
    assert!(cases.len() >= 8, "at least eight logs");
    for case in cases {
        assert_eq!(parse_bare(case.log), case.want, "log {}", case.name);
    }
}

#[test]
fn only_the_nested_log_has_a_line_wrapped_at_79_columns() {
    for case in cases() {
        let wrapped = case.log.lines().filter(|l| l.len() == 79).count();
        let expected = usize::from(case.name == "nested-includes");
        assert_eq!(wrapped, expected, "log {}", case.name);
    }
}

#[test]
fn windows_line_endings_read_the_same() {
    for case in cases() {
        let crlf = case.log.replace('\n', "\r\n");
        assert_eq!(parse_bare(&crlf), case.want, "log {}", case.name);
    }
}

#[test]
fn a_file_name_wrapped_at_79_columns_is_joined() {
    let name = format!("./{}.tex", "d".repeat(80));
    let full = format!("({name}");
    let (head, tail) = full.split_at(79);
    let log = format!("{head}\n{tail}\n! Undefined control sequence.\nl.4 \\x\n          \n");
    let want = format!("{}.tex", "d".repeat(80));
    assert_eq!(
        parse_bare(&log),
        vec![err(Some(&want), Some(4), "Undefined control sequence.")]
    );
}

#[test]
fn a_file_name_with_a_drive_letter_is_the_file() {
    let log = "(C:\\tex\\main.tex\n! Undefined control sequence.\nl.1 \\x\n";
    assert_eq!(
        parse_bare(log),
        vec![err(
            Some("C:\\tex\\main.tex"),
            Some(1),
            "Undefined control sequence."
        )]
    );
}

#[test]
fn an_error_that_names_its_line_only_after_emergency_stop_gets_it() {
    let log = "(./main.tex\n! LaTeX Error: File `x.sty' not found.\n\n\
Type X to quit or <RETURN> to proceed,\nor enter new name. (Default extension: sty)\n\n\
Enter file name: \n! Emergency stop.\n<read *> \n\nl.3 \\usepackage{x}\n\n\
*** (job aborted, file error in nonstop mode)\n";
    assert_eq!(
        parse_bare(log),
        vec![err(MAIN, Some(3), "File `x.sty' not found.")]
    );
}

#[test]
fn parentheses_in_messages_do_not_close_files() {
    let log = "(./a.tex\nLaTeX Warning: Reference `x' (see below) on page 1 undefined on input line 3.\n\
(./b.tex) (and then some) ) (./c.tex\nOverfull \\hbox (1.0pt too wide) in paragraph at lines 7--8\n";
    assert_eq!(
        parse_bare(log),
        vec![
            warn(
                Some("a.tex"),
                Some(3),
                "Reference `x' (see below) on page 1 undefined"
            ),
            info(
                Some("c.tex"),
                Some(7),
                "Overfull \\hbox (1.0pt too wide) in paragraph at lines 7--8",
            ),
        ]
    );
}

#[test]
fn a_new_tex_run_drops_the_diagnostics_of_the_one_before() {
    let log = "This is pdfTeX, Version 3.1\n(./a.tex\n! Undefined control sequence.\nl.1 \\x\n\
This is XeTeX, Version 3.1\n(./a.tex\nOverfull \\hbox (1.0pt too wide) detected at line 2\n";
    assert_eq!(
        parse_bare(log),
        vec![info(
            Some("a.tex"),
            Some(2),
            "Overfull \\hbox (1.0pt too wide) detected at line 2"
        )]
    );
}

#[test]
fn nothing_in_nothing_out() {
    assert!(parse_log("").is_empty());
    assert!(parse_log("\n\n   \n").is_empty());
    assert!(parse_log("Just some text.\n(and a paren)\n").is_empty());
}

#[test]
fn odd_input_never_panics() {
    let mut cases: Vec<String> = vec![
        "(((((((((((".into(),
        ")))))))))))".into(),
        "{{{{ <<<<< \"\"\"\" ((\"".into(),
        "!\n!\n! \n!!!!".into(),
        "l.\nl.x\nl.99999999999999999999 foo".into(),
        ":::::: 1: 2: x.tex:99999999999999999999: boom".into(),
        "x.tex:12: ".into(),
        "Overfull \\hbox lines 99999999999999999999--3".into(),
        "(é\nδ(\"é.tex\"é)\n".into(),
        "error: \nwarning: \nnote: ".into(),
        "Package Warning: \nPackage x Warning: ".into(),
        "(hyperref)   x\n(natbib)\n(".into(),
    ];
    cases.push("(".repeat(20_000));
    cases.push("(./a.tex\n".repeat(5_000));
    cases.push(format!("{}\n", "é".repeat(60)).repeat(50));
    for text in &cases {
        let _ = parse_log(text);
    }
    let _ = parse_log_bytes(&[0xff, 0xfe, b'(', 0x80, b')', b'\n', b'!', 0xc3]);
}

/// A small, repeatable noise source (no random-number dependency).
fn next(state: &mut u64) -> u64 {
    *state = state
        .wrapping_mul(6_364_136_223_846_793_005)
        .wrapping_add(1_442_695_040_888_963_407);
    *state >> 33
}

#[test]
fn every_cut_and_every_scramble_of_every_log_is_read_without_panicking() {
    let mut state = 7_u64;
    for case in cases() {
        let bytes = case.log.as_bytes();
        for cut in 0..=bytes.len() {
            let _ = parse_log_bytes(&bytes[..cut]);
        }
        for _ in 0..40 {
            let mut copy = bytes.to_vec();
            for _ in 0..8 {
                let at = next(&mut state) as usize % copy.len();
                copy[at] = (next(&mut state) & 0xff) as u8;
            }
            let _ = parse_log_bytes(&copy);
            let from = next(&mut state) as usize % copy.len();
            let _ = parse_log_bytes(&copy[from..]);
        }
        let lines: Vec<&str> = case.log.lines().collect();
        for skip in 1..6 {
            let kept: Vec<&str> = lines
                .iter()
                .enumerate()
                .filter(|(i, _)| i % skip != 0)
                .map(|(_, l)| *l)
                .collect();
            let _ = parse_log(&kept.join("\n"));
        }
    }
}
