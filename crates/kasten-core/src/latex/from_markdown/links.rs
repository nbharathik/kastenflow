//! The inline constructs written in brackets and angle brackets: links,
//! images, wiki links, citations, footnote marks, autolinks, line-break and
//! comment tags. Part of `Inline`.

use super::escape::{
    cite_key_ok, comment_text, escape_text, link_allowed, scheme_of, url_argument,
};
use super::inline::{FOOTNOTE_NOTE, Inline, hard_break};
use super::spans::{close_bracket, parse_dest};

impl Inline {
    pub(super) fn image(&mut self, c: &[char], i: usize, out: &mut String) -> usize {
        // `![[embed]]`
        if c.get(i + 2) == Some(&'[')
            && self.afford()
            && let Some(end) = find_str(c, i + 3, "]]", 300)
        {
            let target: String = c[i + 3..end].iter().collect();
            self.note(format!(
                "% TODO: embed not converted: {}",
                comment_text(&target)
            ));
            return end + 2;
        }
        let image = close_bracket(c, i + 1, &mut self.budget)
            .filter(|&close| c.get(close + 1) == Some(&'('));
        let image = image
            .filter(|_| self.afford())
            .and_then(|close| parse_dest(c, close + 1).map(|(url, after)| (close, url, after)));
        match image {
            Some((close, url, after)) => {
                let alt: String = c[i + 2..close].iter().collect();
                self.note(format!(
                    "% image: {} ({})",
                    comment_text(&alt),
                    comment_text(&url)
                ));
                // The words around it keep a single space.
                if out.ends_with(' ') && c.get(after) == Some(&' ') {
                    return after + 1;
                }
                after
            }
            None => {
                out.push('!');
                i + 1
            }
        }
    }

    /// A `[` at `i`: a link, a reference link, a wiki link, a citation, a
    /// footnote mark, or just a bracket.
    pub(super) fn bracket(&mut self, c: &[char], i: usize, depth: usize) -> (String, usize) {
        let plain = ("[".to_owned(), i + 1);
        if c.get(i + 1) == Some(&'[') {
            let end = if self.afford() {
                find_str(c, i + 2, "]]", 300)
            } else {
                None
            };
            return match end {
                Some(end) => {
                    let inner: String = c[i + 2..end].iter().collect();
                    let shown = match inner.split_once('|') {
                        Some((_, alias)) => alias,
                        None => inner.split('#').next().unwrap_or(""),
                    };
                    (escape_text(shown.trim()), end + 2)
                }
                None => plain,
            };
        }
        let Some(close) = close_bracket(c, i, &mut self.budget) else {
            return plain;
        };
        match c.get(close + 1) {
            Some('(') => {
                if self.afford()
                    && let Some((url, after)) = parse_dest(c, close + 1)
                {
                    return (self.link(&c[i + 1..close], &url, depth), after);
                }
            }
            Some('[') => {
                if self.afford()
                    && let Some(end) = find_str(c, close + 2, "]", 200)
                {
                    return (self.run(&c[i + 1..close], depth + 1), end + 1);
                }
            }
            _ => {}
        }
        let group = &c[i + 1..close];
        if group.contains(&'@')
            && let Some(text) = self.citation(group)
        {
            return (text, close + 1);
        }
        if group.first() == Some(&'^')
            && (1..=30).contains(&(group.len() - 1))
            && !group.iter().any(|x| x.is_whitespace())
        {
            self.note(FOOTNOTE_NOTE);
            let id: String = group[1..].iter().collect();
            // A definition (`[^1]: text`) at the start of a block loses its colon.
            let next = if i == 0 && c.get(close + 1) == Some(&':') {
                close + 2
            } else {
                close + 1
            };
            return (format!("\\textsuperscript{{{}}}", escape_text(&id)), next);
        }
        plain
    }

    fn link(&mut self, text: &[char], url: &str, depth: usize) -> String {
        let shown = self.run(text, depth + 1);
        if !link_allowed(url) {
            // A link to another page or file means nothing in a PDF.
            if scheme_of(url).is_some() {
                self.note(format!(
                    "% TODO: link target not kept: {}",
                    comment_text(url)
                ));
            }
            return shown;
        }
        self.links = true;
        let shown = if shown.trim().is_empty() {
            escape_text(url)
        } else {
            shown
        };
        format!("\\href{{{}}}{{{shown}}}", url_argument(url))
    }

    /// The citation in `group` (the text between `[` and `]`), if it is one.
    fn citation(&mut self, group: &[char]) -> Option<String> {
        let items = cite_items(group);
        if items.is_empty() {
            return None;
        }
        if let Some((bad, _)) = items.iter().find(|(key, _)| !cite_key_ok(key)) {
            self.note(format!(
                "% TODO: citation key not usable in LaTeX: {}",
                comment_text(bad)
            ));
            return None;
        }
        for (key, _) in &items {
            if !self.cites.contains(key) {
                self.cites.push(key.clone());
            }
        }
        let one = |key: &str, locator: &str| {
            if locator.is_empty() {
                format!("\\cite{{{key}}}")
            } else {
                format!("\\cite[{}]{{{key}}}", escape_text(locator))
            }
        };
        if items.iter().all(|(_, locator)| locator.is_empty()) {
            let keys: Vec<&str> = items.iter().map(|(key, _)| key.as_str()).collect();
            return Some(format!("\\cite{{{}}}", keys.join(",")));
        }
        let parts: Vec<String> = items
            .iter()
            .map(|(key, locator)| one(key, locator))
            .collect();
        Some(parts.join(", "))
    }

    /// A `<` at `i`: an autolink, a line break, a tag or comment to leave out, or a less-than sign.
    pub(super) fn angle(&mut self, c: &[char], i: usize, out: &mut String) -> usize {
        if !self.afford() {
            out.push_str("\\textless{}");
            return i + 1;
        }
        if c[i..].starts_with(&['<', '!', '-', '-']) {
            if let Some(end) = find_str(c, i + 4, "-->", 2_000) {
                return end + 3;
            }
        } else if let Some(end) = c[i + 1..]
            .iter()
            .take(300)
            .position(|&x| x == '>' || x == '<')
            && c[i + 1 + end] == '>'
        {
            let end = i + 1 + end;
            let inner: String = c[i + 1..end].iter().collect();
            if scheme_of(&inner).is_some() && !inner.contains(char::is_whitespace) {
                if link_allowed(&inner) {
                    self.links = true;
                    out.push_str(&format!(
                        "\\href{{{}}}{{{}}}",
                        url_argument(&inner),
                        escape_text(&inner)
                    ));
                } else {
                    out.push_str(&escape_text(&inner));
                }
                return end + 1;
            }
            let name: String = inner
                .trim_start_matches('/')
                .chars()
                .take_while(|x| x.is_ascii_alphanumeric())
                .collect();
            if !name.is_empty() && name.starts_with(|x: char| x.is_ascii_alphabetic()) {
                if name.eq_ignore_ascii_case("br") {
                    hard_break(out, c.get(end + 1).copied());
                    out.push('\n');
                }
                return end + 1;
            }
        }
        out.push_str("\\textless{}");
        i + 1
    }
}

/// The citations in `group`: each key with the note that follows it.
fn cite_items(group: &[char]) -> Vec<(String, String)> {
    let mut items: Vec<(String, String)> = Vec::new();
    let mut at = 0;
    while at < group.len() {
        if group[at] != '@' {
            at += 1;
            continue;
        }
        let before = at.checked_sub(1).map(|p| group[p]);
        let dashed = before == Some('-') && (at < 2 || matches!(group[at - 2], ' ' | ';'));
        if !(before.is_none() || matches!(before, Some(' ' | ';')) || dashed) {
            at += 1;
            continue;
        }
        let Some(end) = key_end(group, at + 1) else {
            at += 1;
            continue;
        };
        let key: String = group[at + 1..end].iter().collect();
        let stop = group[end..]
            .iter()
            .position(|&x| x == ';')
            .map_or(group.len(), |p| end + p);
        let rest: String = group[end..stop].iter().collect();
        let locator = rest.trim().trim_start_matches(',').trim();
        // Words that follow without a comma are part of the sentence, not a note.
        let locator = if rest.trim_start().starts_with(',') {
            locator
        } else {
            ""
        };
        items.push((key, locator.replace('@', "")));
        at = stop;
    }
    items
}

fn key_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Just after the key that starts at `at`, if one does (punctuation counts only inside it).
fn key_end(group: &[char], at: usize) -> Option<usize> {
    if !group.get(at).copied().is_some_and(key_char) {
        return None;
    }
    let mut end = at + 1;
    while end < group.len() {
        let x = group[end];
        let inner =
            ":.#$%&-+?<>~/".contains(x) && group.get(end + 1).copied().is_some_and(key_char);
        if key_char(x) || inner {
            end += 1;
        } else {
            break;
        }
    }
    Some(end)
}

/// Where `needle` starts in `c` from `from`, looking at most `limit` characters on.
fn find_str(c: &[char], from: usize, needle: &str, limit: usize) -> Option<usize> {
    let n: Vec<char> = needle.chars().collect();
    let end = c.len().min(from.saturating_add(limit));
    (from..end).find(|&j| c[j..].starts_with(&n))
}
