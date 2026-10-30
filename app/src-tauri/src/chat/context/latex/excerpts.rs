//! The lines around each problem of the last build, in every file that has
//! one, not only the file that is open. An assistant that sees the numbered
//! lines near an error can fix it without reading the whole document; the
//! character budget goes to these excerpts first.

use kasten_core::Kasten;
use kasten_core::latex::{EXCERPT_RADIUS, excerpt_around};
use serde_json::Value;

use super::super::cut;

/// The least room for the start of the open file that is worth sending.
pub(super) const WORTH_A_HEAD: usize = 2_000;

/// Where a diagnostic is: its file (or the root file) and its line.
fn place<'a>(d: &'a Value, main: &'a str) -> Option<(&'a str, u32)> {
    let line = u32::try_from(d["line"].as_u64()?).ok()?;
    let file = d["file"]
        .as_str()
        .filter(|f| !f.trim().is_empty())
        .unwrap_or(main);
    Some((file, line))
}

/// The files with a problem of `severities`, in the order the build gave
/// them, each with the lines it names.
pub(super) fn centers(
    diagnostics: &[Value],
    main: &str,
    severities: &[&str],
) -> Vec<(String, Vec<u32>)> {
    let mut out: Vec<(String, Vec<u32>)> = Vec::new();
    for d in diagnostics {
        if !severities.iter().any(|s| d["severity"] == *s) {
            continue;
        }
        let Some((file, line)) = place(d, main) else {
            continue;
        };
        match out.iter_mut().find(|(f, _)| f == file) {
            Some((_, lines)) => lines.push(line),
            None => out.push((file.to_owned(), vec![line])),
        }
    }
    out
}

/// One file's excerpt under a heading, cut to `room` characters.
pub(super) fn block(file: &str, text: &str, lines: &[u32], room: usize) -> String {
    let heading =
        format!("== {file}: lines near the problems (the numbers are not part of the file) ==\n");
    if room <= heading.len() {
        return String::new();
    }
    let body = excerpt_around(text, lines, EXCERPT_RADIUS);
    let limit = room - heading.len();
    // `cut` ends at a line break near the limit, which would drop the last line of a body that fits.
    let shown = if body.chars().count() <= limit {
        body.as_str()
    } else {
        cut(&body, limit)
    };
    let more = if shown.len() < body.len() {
        "\n…"
    } else {
        ""
    };
    format!("{heading}{shown}{more}\n")
}

/// The excerpts of the files in `wanted` other than `skip`, read from the
/// document in `doc`, one after the other until `room` characters are used.
pub(super) fn others(
    kasten: &Kasten,
    doc: &str,
    skip: &str,
    wanted: &[(String, Vec<u32>)],
    room: usize,
) -> String {
    let mut out = String::new();
    for (file, lines) in wanted.iter().filter(|(f, _)| f != skip) {
        let left = room.saturating_sub(out.len());
        if left < 200 {
            break;
        }
        let Ok(source) = kasten.source(&format!("{doc}/{file}")) else {
            continue;
        };
        out.push_str(&block(file, &source.text, lines, left));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn d(severity: &str, file: Option<&str>, line: Option<u32>) -> Value {
        json!({"severity": severity, "file": file, "line": line, "message": "m"})
    }

    #[test]
    fn centers_group_by_file_and_a_missing_file_is_the_root() {
        let found = [
            d("error", Some("a.tex"), Some(4)),
            d("error", None, Some(9)),
            d("error", Some("a.tex"), Some(40)),
            d("warning", Some("b.tex"), Some(2)),
            d("error", Some("c.tex"), None),
            d("info", Some("a.tex"), Some(7)),
        ];
        assert_eq!(
            centers(&found, "main.tex", &["error"]),
            [
                ("a.tex".to_owned(), vec![4, 40]),
                ("main.tex".to_owned(), vec![9])
            ]
        );
        assert_eq!(
            centers(&found, "main.tex", &["warning"]),
            [("b.tex".to_owned(), vec![2])]
        );
    }

    #[test]
    fn a_block_is_headed_numbered_and_cut_to_its_room() {
        let text: String = (1..=100).map(|i| format!("line {i}\n")).collect();
        let found = block("a.tex", &text, &[50], 10_000);
        assert!(
            found.starts_with("== a.tex: lines near the problems"),
            "{found}"
        );
        assert!(
            found.contains("50 | line 50")
                && found.contains("35 | line 35")
                && found.contains("65 | line 65")
        );
        assert!(!found.contains("34 | line 34") && !found.contains("66 | line 66"));
        let small = block("a.tex", &text, &[50], 300);
        assert!(
            small.chars().count() <= 310 && small.contains('…'),
            "{small}"
        );
        assert_eq!(block("a.tex", &text, &[50], 20), "");
    }
}
