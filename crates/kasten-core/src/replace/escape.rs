//! Writing a replacement into a page so that it reads back as typed: in
//! prose its Markdown marks are escaped, in HTML its tags and entities are.

/// Whether `chars[at]`, an `&`, starts an entity such as `&amp;` or `&#35;`.
fn entity_at(chars: &[char], at: usize) -> bool {
    let name = chars[at + 1..]
        .iter()
        .take_while(|c| c.is_alphanumeric() || **c == '#')
        .count();
    name > 0 && chars.get(at + 1 + name) == Some(&';')
}

/// Where the `.` or `)` of a list number such as `12.` sits at the start of
/// `chars`, if it starts with one.
fn number_marker(chars: &[char]) -> Option<usize> {
    let digits = chars.iter().take_while(|c| c.is_ascii_digit()).count();
    ((1..=9).contains(&digits) && matches!(chars.get(digits), Some('.' | ')'))).then_some(digits)
}

/// `with` as Markdown prose. Marks that would format are escaped with a
/// backslash; an underscore inside a word is not one. At the start of a
/// line (`line_start`), what would make a heading, a list or a rule is
/// escaped too.
pub(super) fn prose(with: &str, line_start: bool) -> String {
    let chars: Vec<char> = with.chars().collect();
    let list_number = if line_start {
        number_marker(&chars)
    } else {
        None
    };
    let mut out = String::with_capacity(with.len() + 8);
    for (i, &c) in chars.iter().enumerate() {
        let inside_word = i > 0
            && chars[i - 1].is_alphanumeric()
            && chars.get(i + 1).is_some_and(|n| n.is_alphanumeric());
        let escape = match c {
            '\\' | '`' | '*' | '[' | ']' | '<' | '>' | '|' | '~' | '$' => true,
            '_' => !inside_word,
            '&' => entity_at(&chars, i),
            '#' | '-' | '+' | '=' => line_start && i == 0,
            '.' | ')' => list_number == Some(i),
            _ => false,
        };
        if escape {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// `with` as text inside HTML: tags and entities are escaped, Markdown
/// marks are left as they are.
pub(super) fn html(with: &str) -> String {
    let chars: Vec<char> = with.chars().collect();
    let mut out = String::with_capacity(with.len() + 8);
    for (i, &c) in chars.iter().enumerate() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' if entity_at(&chars, i) => out.push_str("&amp;"),
            _ => out.push(c),
        }
    }
    out
}
