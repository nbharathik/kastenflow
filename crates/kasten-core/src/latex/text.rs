//! The words of a `.tex` file for search: comments and commands taken out
//! lightly, the text inside commands' braces kept.

/// `text` as words to search: `% comments` dropped (`\%` kept as a percent
/// sign), `\command` names replaced by a space, braces and brackets by
/// spaces, and an escaped character (`\&`, `\_`) by the character.
pub fn searchable(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '%' => {
                // A comment runs to the end of the line, which is kept.
                for rest in chars.by_ref() {
                    if rest == '\n' {
                        out.push('\n');
                        break;
                    }
                }
            }
            '\\' => match chars.peek().copied() {
                Some(next) if next.is_ascii_alphabetic() || next == '@' => {
                    while chars
                        .peek()
                        .is_some_and(|n| n.is_ascii_alphabetic() || *n == '@')
                    {
                        chars.next();
                    }
                    out.push(' ');
                }
                Some('\\') => {
                    chars.next();
                    out.push('\n');
                }
                Some(next) => {
                    chars.next();
                    out.push(next);
                }
                None => {}
            },
            '{' | '}' | '[' | ']' | '$' | '~' => out.push(' '),
            other => out.push(other),
        }
    }
    out
}

/// About `width` characters of `text` around the first line that holds
/// `word` (case does not matter), on one line; empty when it is not there.
pub fn snippet_around(text: &str, word: &str, width: usize) -> String {
    let lower_word = word.to_lowercase();
    let Some(line) = text
        .lines()
        .find(|l| l.to_lowercase().contains(&lower_word))
    else {
        return String::new();
    };
    let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
    let chars: Vec<char> = line.chars().collect();
    if chars.len() <= width {
        return line;
    }
    let at = line
        .to_lowercase()
        .find(&lower_word)
        .map_or(0, |byte| line.get(..byte).map_or(0, |s| s.chars().count()));
    let start = at.saturating_sub(width / 4).min(chars.len() - width);
    let mut out: String = chars[start..start + width].iter().collect();
    if start > 0 {
        out.insert(0, '…');
    }
    if start + width < chars.len() {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_comments_and_command_names_out_and_keeps_the_words() {
        let words =
            searchable("\\section{Intro} Gaussian \\textbf{noise}. % pelican\nRaised 50\\% & more");
        assert!(words.contains("Intro"), "{words}");
        assert!(words.contains("Gaussian"), "{words}");
        assert!(words.contains("noise"), "{words}");
        assert!(words.contains("50% &"), "{words}");
        assert!(!words.contains("pelican"), "{words}");
        assert!(!words.contains("textbf"), "{words}");
        assert!(!words.contains("section"), "{words}");
    }

    #[test]
    fn a_line_break_command_starts_a_new_line() {
        assert_eq!(searchable("a\\\\b"), "a\nb");
    }

    #[test]
    fn shows_the_line_with_the_word_cut_to_size() {
        assert_eq!(
            snippet_around("one\ntwo Cat three\nfour", "cat", 40),
            "two Cat three"
        );
        let long = format!("{} needle {}", "a".repeat(80), "b".repeat(80));
        let snip = snippet_around(&long, "needle", 30);
        assert!(snip.contains("needle"), "{snip}");
        assert!(snip.starts_with('…') && snip.ends_with('…'), "{snip}");
        assert_eq!(snippet_around("nothing", "cat", 30), "");
    }
}
