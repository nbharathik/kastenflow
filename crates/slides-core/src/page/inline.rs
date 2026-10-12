//! The words inside a block: wiki links as links to `page:`, the HTML a page may hold taken off, and then the inline Markdown of the slides.

use crate::markdown::inline_runs;
use crate::model::Run;

fn encode_target(target: &str) -> String {
    let mut out = String::with_capacity(target.len());
    for c in target.chars() {
        match c {
            ' ' => out.push_str("%20"),
            '(' => out.push_str("%28"),
            ')' => out.push_str("%29"),
            '%' => out.push_str("%25"),
            '#' => out.push_str("%23"),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out
}

/// The address of a link to a page of the host: `page:` and the page's path (spaces and the marks of Markdown written as
/// `%20` and the like), then `#` and the heading when it points at a section.
pub fn page_link(path: &str, section: Option<&str>) -> String {
    match section.map(str::trim).filter(|s| !s.is_empty()) {
        Some(heading) => format!(
            "page:{}#{}",
            encode_target(path.trim()),
            encode_target(heading)
        ),
        None => format!("page:{}", encode_target(path.trim())),
    }
}

/// `[[Target]]`, `[[Target|words]]` or `[[Target#Heading]]` at `i`: the words, the target and where it ends.
fn wikilink(c: &[char], i: usize) -> Option<(String, String, usize)> {
    let mut j = i + 2;
    while j + 1 < c.len() {
        if c[j] == '[' && c[j + 1] == '[' {
            return None;
        }
        if c[j] == ']' && c[j + 1] == ']' {
            let inner: String = c[i + 2..j].iter().collect();
            if inner.trim().is_empty() {
                return None;
            }
            let (target, words) = match inner.split_once('|') {
                Some((target, words)) => (target.trim().to_owned(), words.trim().to_owned()),
                None => (
                    inner.trim().to_owned(),
                    inner.trim().replace('#', " \u{203a} "),
                ),
            };
            let words = if words.is_empty() {
                target.clone()
            } else {
                words
            };
            return Some((words, target, j + 2));
        }
        j += 1;
    }
    None
}

/// The end of the HTML tag at `i` and whether it is a line break, for the few tags that are dropped: `span`, `mark`, `font`, `br`.
fn dropped_tag(c: &[char], i: usize) -> Option<(usize, bool)> {
    let close = c[i..].iter().position(|&x| x == '>')? + i;
    let inner: String = c[i + 1..close].iter().collect();
    let name: String = inner
        .trim_start_matches('/')
        .chars()
        .take_while(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_ascii_lowercase();
    match name.as_str() {
        "span" | "mark" | "font" | "sup" | "sub" => Some((close + 1, false)),
        "br" => Some((close + 1, true)),
        _ => None,
    }
}

/// A line of the page made ready for the inline reader: wiki links as links to `page:`, and the HTML a page may hold taken off.
fn prepare(text: &str) -> String {
    let c: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < c.len() {
        match c[i] {
            '`' => {
                let n = c[i..].iter().take_while(|&&x| x == '`').count();
                let mut j = i + n;
                let mut end = None;
                while j < c.len() {
                    let run = c[j..].iter().take_while(|&&x| x == '`').count();
                    if run == n {
                        end = Some(j + n);
                        break;
                    }
                    j += run.max(1);
                }
                let stop = end.unwrap_or(i + n);
                out.extend(&c[i..stop]);
                i = stop;
            }
            '!' if c.get(i + 1) == Some(&'[') && c.get(i + 2) == Some(&'[') => i += 1,
            '[' if c.get(i + 1) == Some(&'[') => {
                if let Some((words, target, end)) = wikilink(&c, i) {
                    let words: String = words.chars().filter(|&x| x != '[' && x != ']').collect();
                    let (page, heading) = match target.split_once('#') {
                        Some((page, heading)) => (page, Some(heading)),
                        None => (target.as_str(), None),
                    };
                    out.push_str(&format!("[{words}]({})", page_link(page, heading)));
                    i = end;
                } else {
                    out.push('[');
                    i += 1;
                }
            }
            '<' => match dropped_tag(&c, i) {
                Some((end, line_break)) => {
                    if line_break {
                        out.push('\n');
                    }
                    i = end;
                }
                None => {
                    out.push('<');
                    i += 1;
                }
            },
            x => {
                out.push(x);
                i += 1;
            }
        }
    }
    out
}

/// The runs of a line of a page: its marks read, its wiki links made links, its stray HTML gone.
pub(super) fn runs(text: &str) -> Vec<Run> {
    inline_runs(&prepare(text))
}

/// The same, all of it bold.
pub(super) fn bold(text: &str) -> Vec<Run> {
    let mut found = runs(text);
    for run in &mut found {
        run.bold = true;
    }
    found
}
