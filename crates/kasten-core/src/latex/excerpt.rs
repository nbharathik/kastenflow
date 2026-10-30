//! Numbered lines of a source file, for an assistant that must find an error
//! without reading the whole file: a window of lines around each line TeX
//! complained about, each with its number, and the windows of nearby errors
//! joined into one. The numbers are only a guide; they are not part of the
//! file, and a change is always made with the file's own text.

/// How many lines on each side of a line an excerpt takes.
pub const RADIUS: usize = 15;
/// The most characters of one line shown; the rest is cut (a minified line
/// would fill the budget alone).
const MAX_LINE_CHARS: usize = 240;

fn lines_of(text: &str) -> Vec<&str> {
    text.split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l))
        .collect()
}

fn cut(line: &str) -> String {
    match line.char_indices().nth(MAX_LINE_CHARS) {
        Some((end, _)) => format!("{}…", &line[..end]),
        None => line.to_owned(),
    }
}

/// How many lines `text` has (a last empty piece after a final line break is
/// not a line).
pub fn line_count(text: &str) -> usize {
    let pieces = text.split('\n').count();
    let lines = if text.ends_with('\n') {
        pieces - 1
    } else {
        pieces
    };
    lines.max(1)
}

/// Lines `from` to `to` (1-based, both included, clamped to the file) as
/// `  12 | text`.
pub fn numbered(text: &str, from: usize, to: usize) -> String {
    let lines = lines_of(text);
    let total = line_count(text);
    let (from, to) = (from.max(1), to.min(total));
    if from > to {
        return String::new();
    }
    let width = to.to_string().len();
    (from..=to)
        .map(|n| format!("{n:>width$} | {}", cut(lines[n - 1])))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The windows of `radius` lines around each of the lines in `centers`
/// (1-based; a line past the end counts as the last), windows that touch or
/// overlap joined, and a `…` line where lines were left out between two.
/// Empty when `centers` is empty.
pub fn around(text: &str, centers: &[u32], radius: usize) -> String {
    let total = line_count(text);
    let mut windows: Vec<(usize, usize)> = centers
        .iter()
        .map(|&c| {
            let c = (c as usize).clamp(1, total);
            (c.saturating_sub(radius).max(1), (c + radius).min(total))
        })
        .collect();
    windows.sort_unstable();
    let mut joined: Vec<(usize, usize)> = Vec::new();
    for (from, to) in windows {
        match joined.last_mut() {
            Some(last) if from <= last.1 + 1 => last.1 = last.1.max(to),
            _ => joined.push((from, to)),
        }
    }
    let width = joined.last().map_or(1, |w| w.1.to_string().len());
    let lines = lines_of(text);
    let mut out: Vec<String> = Vec::new();
    for (i, (from, to)) in joined.iter().enumerate() {
        if i > 0 {
            out.push("…".to_owned());
        }
        for n in *from..=*to {
            out.push(format!("{n:>width$} | {}", cut(lines[n - 1])));
        }
    }
    out.join("\n")
}

/// `"40-80"` (or `"40"`) as the lines it names. Why not, in a sentence.
pub fn parse_range(spec: &str) -> Result<(usize, usize), String> {
    let spec = spec.trim();
    let bad = || format!("“{spec}” is not a range of lines: write it like 40-80");
    let number = |s: &str| s.trim().parse::<usize>().ok().filter(|n| *n >= 1);
    let (from, to) = match spec.split_once('-') {
        Some((a, b)) => (number(a), number(b)),
        None => (number(spec), number(spec)),
    };
    match (from, to) {
        (Some(from), Some(to)) if from <= to => Ok((from, to)),
        _ => Err(bad()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(n: usize) -> String {
        (1..=n).map(|i| format!("line {i}\n")).collect()
    }

    #[test]
    fn a_window_is_numbered_and_clamped_to_the_file() {
        let text = file(40);
        let found = around(&text, &[20], 2);
        assert_eq!(
            found,
            "18 | line 18\n19 | line 19\n20 | line 20\n21 | line 21\n22 | line 22"
        );
        let top = around(&text, &[1], 2);
        assert!(
            top.starts_with("1 | line 1\n") && top.ends_with("3 | line 3"),
            "{top}"
        );
        let end = around(&text, &[999], 1);
        assert_eq!(end, "39 | line 39\n40 | line 40");
    }

    #[test]
    fn windows_that_touch_are_one_and_a_gap_is_marked() {
        let text = file(100);
        let joined = around(&text, &[10, 14, 12], 3);
        assert!(joined.contains(" 7 | line 7") && joined.contains("17 | line 17"));
        assert!(!joined.contains('…'), "{joined}");
        assert_eq!(joined.lines().count(), 11);
        let apart = around(&text, &[10, 60], 2);
        assert!(apart.contains("\n…\n"), "{apart}");
        assert_eq!(apart.lines().count(), 5 + 1 + 5);
        assert_eq!(around(&text, &[], 15), "");
    }

    #[test]
    fn the_radius_is_fifteen_by_default() {
        assert_eq!(RADIUS, 15);
        let found = around(&file(100), &[50], RADIUS);
        assert_eq!(found.lines().count(), 31);
    }

    #[test]
    fn a_range_is_numbered_and_a_long_line_is_cut() {
        let text = format!("a\n{}\nc\n", "x".repeat(1000));
        let found = numbered(&text, 2, 3);
        assert!(
            found.starts_with("2 | xxx") && found.contains("…\n3 | c"),
            "{found}"
        );
        assert_eq!(numbered(&text, 5, 9), "");
        assert_eq!(numbered(&text, 0, 1), "1 | a");
    }

    #[test]
    fn lines_are_counted_without_the_empty_piece_after_the_last_break() {
        assert_eq!(line_count("a\nb\n"), 2);
        assert_eq!(line_count("a\nb"), 2);
        assert_eq!(line_count(""), 1);
        assert_eq!(around("a\r\nb\r\n", &[2], 1), "1 | a\n2 | b");
    }

    #[test]
    fn a_range_reads_or_says_why_not() {
        assert_eq!(parse_range("40-80"), Ok((40, 80)));
        assert_eq!(parse_range(" 7 "), Ok((7, 7)));
        for bad in ["", "0-3", "5-2", "a-b", "1-", "-4", "1-2-3"] {
            assert!(parse_range(bad).is_err(), "{bad}");
        }
    }
}
