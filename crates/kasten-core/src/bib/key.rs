//! A key for a work, made from who wrote it, when, and what it is called:
//! `vaswani2017attention`. Lower-case ASCII, so it can be typed anywhere; a
//! numbered ending (`-2`) when the key is taken. The same code serves the Add
//! form and the agents, so a key is the same whoever asks.

use super::model::KeyHints;

/// Words a title starts with that say nothing about the work.
const SKIPPED: [&str; 14] = [
    "a", "an", "the", "on", "of", "in", "for", "to", "and", "with", "by", "from", "at", "as",
];

/// The longest piece of a key taken from a name or a title.
const MOST_PART: usize = 24;

/// A letter written without accents, or nothing for what has no plain form.
fn plain(c: char) -> &'static str {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => "a",
        'æ' => "ae",
        'ç' | 'ć' | 'č' => "c",
        'ď' | 'đ' => "d",
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' => "e",
        'ğ' => "g",
        'ì' | 'í' | 'î' | 'ï' | 'ī' | 'ı' => "i",
        'ł' => "l",
        'ñ' | 'ń' | 'ň' => "n",
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => "o",
        'œ' => "oe",
        'ř' => "r",
        'ś' | 'š' | 'ş' => "s",
        'ß' => "ss",
        'ť' => "t",
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' => "u",
        'ý' | 'ÿ' => "y",
        'ź' | 'ż' | 'ž' => "z",
        _ => "",
    }
}

/// `text` as lower-case ASCII letters and digits: LaTeX accents and braces removed,
/// accented letters written plain, everything else dropped.
fn ascii(text: &str) -> String {
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            // `\"o`, `\'e`: the accent goes, the letter stays; `\L` is the letter.
            if chars.peek().is_some_and(|n| !n.is_alphabetic()) {
                chars.next();
            }
            continue;
        }
        let lower = c.to_lowercase().next().unwrap_or(c);
        if lower.is_ascii_alphanumeric() {
            out.push(lower);
        } else {
            out.push_str(plain(lower));
        }
    }
    out
}

/// The first author's family name, whichever way the names are written.
fn family(authors: &str) -> String {
    let mut depth = 0usize;
    let mut first_end = authors.len();
    let bytes = authors.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        match b {
            b'{' => depth += 1,
            b'}' => depth = depth.saturating_sub(1),
            b' ' if depth == 0 && authors[i..].to_ascii_lowercase().starts_with(" and ") => {
                first_end = i;
                break;
            }
            _ => {}
        }
    }
    let first = authors[..first_end].trim();
    if first.is_empty() || first.eq_ignore_ascii_case("others") {
        return String::new();
    }
    let name = if let Some((last, _)) = first.split_once(',') {
        last.trim()
    } else if first.starts_with('{') && first.ends_with('}') {
        // A name in braces is one name (an organisation): its first word.
        first
            .trim_matches(['{', '}'])
            .split_whitespace()
            .next()
            .unwrap_or("")
    } else {
        first.split_whitespace().next_back().unwrap_or("")
    };
    ascii(name).chars().take(MOST_PART).collect()
}

/// The first word of a title that says something.
fn first_word(title: &str) -> String {
    for word in
        title.split(|c: char| !(c.is_alphanumeric() || matches!(c, '\\' | '{' | '}' | '\'')))
    {
        let word = ascii(word);
        if !word.is_empty() && !SKIPPED.contains(&word.as_str()) {
            return word.chars().take(MOST_PART).collect();
        }
    }
    String::new()
}

/// The first four-digit year in `text`.
fn year(text: &str) -> String {
    let mut digits = String::new();
    for c in text.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
            if digits.len() == 4 {
                return digits;
            }
        } else {
            digits.clear();
        }
    }
    String::new()
}

/// A key for the work the hints describe that `taken` does not refuse. Without
/// an author the key starts `ref`.
pub fn suggest(hints: &KeyHints, taken: &dyn Fn(&str) -> bool) -> String {
    let who = hints.author.as_deref().map(family).unwrap_or_default();
    let when = hints.year.as_deref().map(year).unwrap_or_default();
    let what = hints.title.as_deref().map(first_word).unwrap_or_default();
    let who = if who.is_empty() {
        "ref".to_owned()
    } else {
        who
    };
    let base = format!("{who}{when}{what}");
    if !taken(&base) {
        return base;
    }
    (2..)
        .map(|n| format!("{base}-{n}"))
        .find(|candidate| !taken(candidate))
        .unwrap_or(base)
}
