//! Adding text to a source file: at its end, or right after a piece of text
//! that is in the file exactly once. Every other byte stays as it was, and a
//! file written with Windows line breaks keeps them.

use crate::error::{Error, Result};

/// What adding text to a file makes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Appended {
    /// The whole file with the text in it.
    pub text: String,
    /// Where the added text begins (a byte offset in `text`).
    pub at: usize,
    /// How many bytes were added.
    pub added: usize,
}

/// Whether the file ends its lines with CRLF (and not, for the most part, LF).
fn uses_crlf(text: &str) -> bool {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count() - crlf;
    crlf > 0 && crlf >= lf
}

/// `text` with its line breaks as a file with Windows line breaks has them.
pub(super) fn with_crlf(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\n', "\r\n")
}

/// Where `marker` stands in `text`, and how many times it does (a second
/// place counts even when it overlaps the first).
pub(super) fn places(text: &str, marker: &str) -> (Option<usize>, usize) {
    let Some(first) = text.find(marker) else {
        return (None, 0);
    };
    let mut count = 1;
    let mut from = first + text[first..].chars().next().map_or(1, char::len_utf8);
    while let Some(next) = text[from..].find(marker) {
        count += 1;
        from += next + text[from + next..].chars().next().map_or(1, char::len_utf8);
    }
    (Some(first), count)
}

/// `current` with `add` put at its end, or right after `after` when that is
/// given. `after` must be in the file once; `name` is the file's name for
/// the sentences that say why not.
pub fn appended(current: &str, add: &str, after: Option<&str>, name: &str) -> Result<Appended> {
    if add.is_empty() {
        return Err(Error::Invalid("There is no text to add".to_owned()));
    }
    let crlf = uses_crlf(current);
    let added = if crlf { with_crlf(add) } else { add.to_owned() };
    let Some(marker) = after else {
        return finish(current, &added, current.len(), 1, name);
    };
    if marker.is_empty() {
        return Err(Error::Invalid(
            "after is empty: give the text to add after, exactly as it is in the file, or leave it out to add at the end".to_owned(),
        ));
    }
    // A marker copied from a file with Windows line breaks may have been sent with plain ones.
    let mut wanted = marker.to_owned();
    let mut found = places(current, &wanted);
    if found.0.is_none() && crlf {
        wanted = with_crlf(marker);
        found = places(current, &wanted);
    }
    let Some(start) = found.0 else {
        return Err(Error::Invalid(format!(
            "The text to add after is not in {name}. Read the file again and copy the text exactly, spaces and line breaks included"
        )));
    };
    finish(current, &added, start + wanted.len(), found.1, name)
}

/// The file with `added` put in at `at`, if its marker was in the file once.
fn finish(current: &str, added: &str, at: usize, count: usize, name: &str) -> Result<Appended> {
    if count > 1 {
        return Err(Error::Invalid(format!(
            "The text to add after is in {name} {count} times. Add some of the lines around it so it matches once"
        )));
    }
    let mut text = String::with_capacity(current.len() + added.len());
    text.push_str(&current[..at]);
    text.push_str(added);
    text.push_str(&current[at..]);
    Ok(Appended {
        text,
        at,
        added: added.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_of(current: &str, add: &str, after: Option<&str>) -> Result<String> {
        appended(current, add, after, "main.tex").map(|a| a.text)
    }

    #[test]
    fn text_goes_to_the_end_byte_for_byte() {
        assert_eq!(text_of("a\nb", "\nc", None).unwrap(), "a\nb\nc");
        assert_eq!(text_of("", "x\n", None).unwrap(), "x\n");
        let done = appended("é\n", "ü", None, "m").unwrap();
        assert_eq!((done.at, done.added), (3, 2));
    }

    #[test]
    fn text_goes_right_after_a_marker_that_is_there_once() {
        let file = "\\section{A}\nOne\n\\section{B}\nTwo\n";
        assert_eq!(
            text_of(file, "New\n", Some("\\section{A}\n")).unwrap(),
            "\\section{A}\nNew\nOne\n\\section{B}\nTwo\n"
        );
        // The marker may end mid-line: the text follows it at once.
        assert_eq!(text_of("ab", "X", Some("a")).unwrap(), "aXb");
    }

    #[test]
    fn a_marker_that_is_missing_or_twice_or_empty_is_refused() {
        let why = text_of("abc", "x", Some("zzz")).unwrap_err().to_string();
        assert!(why.contains("is not in main.tex"), "{why}");
        let why = text_of("a b a", "x", Some("a")).unwrap_err().to_string();
        assert!(
            why.contains("2 times") && why.contains("matches once"),
            "{why}"
        );
        // Overlapping places count.
        let why = text_of("aaa", "x", Some("aa")).unwrap_err().to_string();
        assert!(why.contains("times"), "{why}");
        let why = text_of("abc", "x", Some("")).unwrap_err().to_string();
        assert!(why.contains("after is empty"), "{why}");
        let why = text_of("abc", "", None).unwrap_err().to_string();
        assert!(why.contains("no text to add"), "{why}");
    }

    #[test]
    fn a_file_with_windows_line_breaks_keeps_them() {
        let file = "one\r\ntwo\r\nthree\r\n";
        assert_eq!(
            text_of(file, "new\nlines\n", Some("two\r\n")).unwrap(),
            "one\r\ntwo\r\nnew\r\nlines\r\nthree\r\n"
        );
        // A marker sent with plain line breaks finds the lines it means.
        assert_eq!(
            text_of(file, "X", Some("one\ntwo")).unwrap(),
            "one\r\ntwoX\r\nthree\r\n"
        );
        assert_eq!(
            text_of(file, "end\n", None).unwrap(),
            "one\r\ntwo\r\nthree\r\nend\r\n"
        );
        // Text that already has them is not doubled.
        assert_eq!(
            text_of(file, "a\r\nb", None).unwrap(),
            "one\r\ntwo\r\nthree\r\na\r\nb"
        );
        // A file of plain line breaks gets the text as it is, even with a stray CRLF in it.
        assert_eq!(text_of("a\nb\n", "x\r\n", None).unwrap(), "a\nb\nx\r\n");
    }
}
