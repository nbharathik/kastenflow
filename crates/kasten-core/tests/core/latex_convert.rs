//! Markdown to LaTeX: the golden pairs in `fixtures/latex/from-markdown`,
//! escaping, and hostile text (the converter reads text nobody has looked at:
//! it must not panic, take long, or write anything that leaves its place).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use kasten_core::latex::{Mode, markdown_to_latex, page_to_latex};

fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/latex/from-markdown")
}

/// Every `name.md` with its `name.tex`.
fn goldens() -> Vec<(String, String, String)> {
    let mut found = Vec::new();
    for entry in fs::read_dir(golden_dir()).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "md") {
            let name = path.file_stem().unwrap().to_string_lossy().into_owned();
            let md = fs::read_to_string(&path).unwrap();
            let tex = fs::read_to_string(path.with_extension("tex"))
                .unwrap_or_else(|_| panic!("{name} has no .tex beside it"));
            found.push((name, md, tex));
        }
    }
    found.sort();
    found
}

const DENIED: [&str; 24] = [
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
    "verb",
];

/// What the converted text must hold whatever went in: groups balance, no
/// comment starts mid-line, dollar signs pair up, no command that reads or
/// writes files or ends the document, every verbatim ends where it should.
fn assert_safe(tex: &str, input: &str) {
    let shown = || format!("{:?}", input.chars().take(200).collect::<String>());
    let mut inside = false;
    let (mut begins, mut ends) = (0, 0);
    let mut rest = String::new();
    for line in tex.lines() {
        if inside {
            if line == "\\end{verbatim}" {
                inside = false;
                ends += 1;
            } else {
                assert!(!line.contains("\\end{verbatim}"), "{} -> {tex}", shown());
            }
            continue;
        }
        if line == "\\begin{verbatim}" {
            inside = true;
            begins += 1;
        } else if line.starts_with('%') {
            assert!(line.starts_with("% "), "{} -> {line}", shown());
        } else {
            rest.push_str(line);
            rest.push('\n');
        }
    }
    assert!(!inside && begins == ends, "{} -> {tex}", shown());
    assert!(
        !rest.contains("\\end{document}") && !rest.contains("\\begin{document}"),
        "{}",
        shown()
    );
    let chars: Vec<char> = rest.chars().collect();
    let (mut depth, mut dollars, mut i) = (0i64, 0usize, 0usize);
    while i < chars.len() {
        match chars[i] {
            '\\' => {
                let name: String = chars[i + 1..]
                    .iter()
                    .take_while(|c| c.is_ascii_alphabetic())
                    .collect();
                assert!(
                    !DENIED.contains(&name.as_str()),
                    "\\{name}: {} -> {tex}",
                    shown()
                );
                i += 1 + name.len().max(1);
                continue;
            }
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                assert!(depth >= 0, "{} -> {tex}", shown());
            }
            '%' => panic!("a comment starts mid-line: {} -> {tex}", shown()),
            '$' => dollars += 1,
            _ => {}
        }
        i += 1;
    }
    assert_eq!(depth, 0, "{} -> {tex}", shown());
    assert_eq!(dollars % 2, 0, "{} -> {tex}", shown());
    for env in [
        "itemize",
        "enumerate",
        "quote",
        "center",
        "tabular",
        "frame",
    ] {
        assert_eq!(
            rest.matches(&format!("\\begin{{{env}}}")).count(),
            rest.matches(&format!("\\end{{{env}}}")).count(),
            "{env}: {} -> {tex}",
            shown()
        );
    }
}

#[test]
fn the_goldens_match_byte_for_byte() {
    let all = goldens();
    assert!(all.len() >= 10, "{} pairs", all.len());
    for (name, md, tex) in &all {
        let got = page_to_latex(md, Mode::Sections);
        assert_eq!(&got.tex, tex, "{name}");
        assert_safe(&got.tex, md);
    }
}

#[test]
fn the_goldens_match_with_windows_line_ends() {
    for (name, md, tex) in goldens() {
        let crlf = md.replace('\n', "\r\n");
        assert_eq!(page_to_latex(&crlf, Mode::Sections).tex, tex, "{name}");
    }
}

#[test]
fn citations_are_listed_once_each_in_order() {
    let md = fs::read_to_string(golden_dir().join("08-citations.md")).unwrap();
    let got = page_to_latex(&md, Mode::Sections);
    assert_eq!(got.cites, ["knuth84", "lamport94", "turing36"]);
    assert_eq!(got.todos, 1);
    assert!(!got.hyperref);
    let links = markdown_to_latex("[a](https://x.org)", Mode::Sections);
    assert!(links.hyperref);
}

#[test]
fn every_special_character_is_escaped_in_text() {
    for (c, want) in [
        ('&', "\\&"),
        ('%', "\\%"),
        ('#', "\\#"),
        ('_', "\\_"),
        ('{', "\\{"),
        ('}', "\\}"),
        ('~', "\\textasciitilde{}"),
        ('^', "\\textasciicircum{}"),
    ] {
        let got = markdown_to_latex(&format!("a {c} b"), Mode::Sections);
        assert_eq!(got.tex, format!("a {want} b\n"), "{c}");
    }
    assert_eq!(markdown_to_latex("a $ b", Mode::Sections).tex, "a \\$ b\n");
    assert_eq!(
        markdown_to_latex("a \\ b", Mode::Sections).tex,
        "a \\textbackslash{} b\n"
    );
    // Inside code the same characters are escaped for \texttt, and in a fence they are left alone.
    assert_eq!(
        markdown_to_latex("`a_b`", Mode::Sections).tex,
        "\\texttt{a\\_b}\n"
    );
    assert_eq!(
        markdown_to_latex("```\na_b & %\n```", Mode::Sections).tex,
        "\\begin{verbatim}\na_b & %\n\\end{verbatim}\n"
    );
}

#[test]
fn text_that_looks_like_a_command_is_only_text() {
    let md = "\\input{secrets} and \\write18{x} and \\end{document} and $\\input{a}$ and $$\\openout1=a$$\n";
    let got = markdown_to_latex(md, Mode::Sections);
    assert_safe(&got.tex, md);
    assert!(
        got.tex.contains("\\textbackslash{}input\\{secrets\\}"),
        "{}",
        got.tex
    );
    assert!(got.todos >= 1);
}

#[test]
fn a_link_cannot_break_out_of_its_argument() {
    let md = "[x](https://a.org/}{\\input{b}%#) [y](https://c.org/a b)\n";
    let got = markdown_to_latex(md, Mode::Sections);
    assert_safe(&got.tex, md);
    let md = "<https://a.org/%7D}\\write18>\n";
    assert_safe(&markdown_to_latex(md, Mode::Sections).tex, md);
}

#[test]
fn a_formula_with_a_comment_or_unbalanced_groups_is_text() {
    for md in ["$a%$", "$a}$ b", "$$ {a $$", "$a$$b$ $c", "$x\\verb|y|$"] {
        let got = markdown_to_latex(md, Mode::Sections);
        assert_safe(&got.tex, md);
    }
}

fn pieces() -> Vec<&'static str> {
    vec![
        "*",
        "**",
        "***",
        "_",
        "__",
        "`",
        "``",
        "$",
        "$$",
        "[",
        "]",
        "(",
        ")",
        "![",
        "[@",
        "@",
        "\\",
        "\n",
        "\n\n",
        "> ",
        ">",
        "- ",
        "1. ",
        "| a | b |\n|---|---|\n",
        "# ",
        "## ",
        "```\n",
        "~~~\n",
        "~~",
        "<",
        ">",
        "&",
        "&amp;",
        "%",
        "{",
        "}",
        "<br>",
        "    ",
        "\t",
        "---\n",
        "***\n",
        "[^1]",
        "[^1]: ",
        "[[",
        "]]",
        "[ ] ",
        "[x] ",
        "word",
        " ",
        "  ",
        "é",
        "日本",
        "😀",
        "\u{0}",
        "\r\n",
        "<!--",
        "-->",
        "<div>",
        "</div>",
        "<details>\n<summary>",
        "</summary>",
        "</details>",
        "<!-- columns -->",
        "<!-- column -->",
        "<!-- /columns -->",
        "![[",
        "http://x.org/a_b",
        "[@k1]",
        "[@a; @b, p. 3]",
        "$x^2$",
        "\\end{verbatim}",
        "\\end{document}",
        "\\input{x}",
        "=",
        "|",
        "\\\n",
        ":",
        "+",
        "9.",
    ]
}

struct Lcg(u64);

impl Lcg {
    fn next(&mut self, below: usize) -> usize {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        ((self.0 >> 33) as usize) % below
    }
}

#[test]
fn random_markdown_never_panics_and_always_comes_out_safe() {
    let pieces = pieces();
    let mut rng = Lcg(0x5eed);
    for round in 0..4_000 {
        let count = 1 + rng.next(60);
        let md: String = (0..count).map(|_| pieces[rng.next(pieces.len())]).collect();
        for mode in [Mode::Sections, Mode::Chapters, Mode::Frames] {
            if round % 3 != 0 && mode != Mode::Sections {
                continue;
            }
            let got = markdown_to_latex(&md, mode);
            assert_safe(&got.tex, &md);
        }
    }
}

#[test]
fn every_prefix_and_suffix_of_every_golden_is_safe() {
    for (_, md, _) in goldens() {
        let mut cuts: Vec<usize> = md.char_indices().map(|(at, _)| at).collect();
        cuts.push(md.len());
        for at in cuts {
            for part in [&md[..at], &md[at..]] {
                let got = markdown_to_latex(part, Mode::Sections);
                assert_safe(&got.tex, part);
            }
        }
    }
}

#[test]
fn long_and_deep_texts_take_time_in_proportion_to_their_length() {
    let started = Instant::now();
    let deep_quote = format!("{} x\n", ">".repeat(10_000));
    let deep_list: String = (0..300)
        .map(|d| format!("{}- l{d}\n", "  ".repeat(d)))
        .collect();
    let cases = [
        "*a ".repeat(30_000),
        "_a ".repeat(30_000),
        "**a ".repeat(20_000),
        "[a](".repeat(20_000),
        "[a".repeat(30_000),
        "![a](".repeat(20_000),
        "`a".repeat(30_000),
        "$a ".repeat(30_000),
        "$$a ".repeat(20_000),
        "<a ".repeat(30_000),
        "&a".repeat(30_000),
        "[@a".repeat(20_000),
        "~~a ".repeat(20_000),
        "\\".repeat(30_000),
        "*".repeat(100_000),
        "[".repeat(50_000),
        "(".repeat(50_000),
        "[a]".repeat(30_000),
        "*[`$".repeat(10_000),
        "<details>\n".repeat(3_000),
        "| a |\n|---|\n".repeat(2_000),
        "- a\n".repeat(30_000),
        "1. a\n".repeat(30_000),
        deep_quote,
        deep_list,
        "word ".repeat(100_000),
        "# h\n\n".repeat(20_000),
    ];
    for md in &cases {
        let got = markdown_to_latex(md, Mode::Sections);
        assert_safe(&got.tex, md);
        let frames = markdown_to_latex(md, Mode::Frames);
        assert_safe(&frames.tex, md);
    }
    // Generous: a slip to quadratic time takes minutes, not seconds.
    assert!(started.elapsed().as_secs() < 120, "{:?}", started.elapsed());
}

#[test]
fn a_five_megabyte_paragraph_of_unclosed_markers_ends_in_time() {
    let started = Instant::now();
    for unit in ["*a ", "[a](", "$a ", "`a"] {
        let md = unit.repeat(5_000_000 / unit.len());
        let got = markdown_to_latex(&md, Mode::Sections);
        assert_safe(&got.tex, &md);
    }
    assert!(started.elapsed().as_secs() < 120, "{:?}", started.elapsed());
}

#[test]
fn formulas_that_read_files_stay_text() {
    for md in [
        "$\\input{/etc/passwd}$",
        "$\\write18{ls}$",
        "$\\^^69nput{x}$",
        "$$\n\\immediate\\openout3=x\n$$",
        "$x \\] \\input{y}$",
        "$\\begin{verbatim}$",
    ] {
        let got = markdown_to_latex(md, Mode::Sections);
        assert!(!got.tex.contains("$\\input"), "{md}: {}", got.tex);
        assert!(!got.tex.contains("\\[\n\\"), "{md}: {}", got.tex);
        assert!(!got.tex.contains("\\input{"), "{md}: {}", got.tex);
        assert!(!got.tex.contains("\\write18"), "{md}: {}", got.tex);
        assert!(!got.tex.contains("\\openout"), "{md}: {}", got.tex);
        assert!(!got.tex.contains("\\^^"), "{md}: {}", got.tex);
        assert!(!got.tex.contains("\\begin{verbatim}"), "{md}: {}", got.tex);
    }
}
