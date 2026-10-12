//! A small XML reader that only decides whether a text is well formed. A
//! diagram's source and its picture are XML written by another program, and
//! the vault keeps them as they are, so what matters is refusing a file that
//! would break the next program to open it, and one that could expand into
//! something huge: declarations (`<!DOCTYPE`, `<!ENTITY`) are refused
//! outright, and nesting is limited. It never recurses.

/// What a scan found out about a well-formed text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Scan {
    /// The name of the root element.
    pub root: String,
    /// How many elements have the name that was asked for.
    pub count: usize,
    /// There is a `script` element (any prefix or case).
    pub script: bool,
    /// The root element's attributes, values still escaped.
    pub root_attrs: Vec<(String, String)>,
}

const MAX_DEPTH: usize = 1000;

type Fail = (usize, String);

/// Reads `text` through, or says what is wrong and on which line.
pub(crate) fn scan(text: &str, count: &str) -> Result<Scan, String> {
    scan_at(text, count).map_err(|(at, why)| {
        let line = text.as_bytes()[..at.min(text.len())]
            .iter()
            .filter(|c| **c == b'\n')
            .count()
            + 1;
        format!("Line {line}: {why}")
    })
}

fn fail<T>(at: usize, why: impl Into<String>) -> Result<T, Fail> {
    Err((at, why.into()))
}

fn skip_space(b: &[u8], mut at: usize) -> usize {
    while matches!(b.get(at), Some(b' ' | b'\t' | b'\r' | b'\n')) {
        at += 1;
    }
    at
}

/// The name that starts at `at`, and where it ends.
fn read_name(text: &str, at: usize) -> Option<(&str, usize)> {
    let b = text.as_bytes();
    let start_ok = |c: u8| c.is_ascii_alphabetic() || matches!(c, b'_' | b':') || c >= 0x80;
    if !b.get(at).copied().is_some_and(start_ok) {
        return None;
    }
    let mut end = at + 1;
    while b
        .get(end)
        .is_some_and(|&c| start_ok(c) || c.is_ascii_digit() || matches!(c, b'-' | b'.'))
    {
        end += 1;
    }
    Some((&text[at..end], end))
}

/// Whether `&…;` names a character, as the `Char` rule has it.
fn char_ref(digits: &str) -> bool {
    let n = match digits.strip_prefix(['x', 'X']) {
        Some(hex) => u32::from_str_radix(hex, 16),
        None => digits.parse(),
    };
    n.ok().is_some_and(|n| {
        char::from_u32(n).is_some()
            && !matches!(n, 0xFFFE | 0xFFFF)
            && (n >= 0x20 || matches!(n, 9 | 10 | 13))
    })
}

/// Every `&` in `s` starts a reference to one of the five predefined
/// entities or to a character.
fn check_refs(s: &str, base: usize) -> Result<(), Fail> {
    let b = s.as_bytes();
    let mut i = 0;
    while let Some(n) = b[i..].iter().position(|&c| c == b'&') {
        let at = i + n;
        let Some(len) = b[at + 1..].iter().take(12).position(|&c| c == b';') else {
            return fail(base + at, "a & that starts no reference");
        };
        let name = &s[at + 1..at + 1 + len];
        let ok = match name.strip_prefix('#') {
            Some(digits) => char_ref(digits),
            None => matches!(name, "lt" | "gt" | "amp" | "quot" | "apos"),
        };
        if !ok {
            let kind = if name.starts_with('#') {
                "is not a valid character"
            } else {
                "is not defined"
            };
            return fail(base + at, format!("the reference &{name}; {kind}"));
        }
        i = at + len + 2;
    }
    Ok(())
}

fn scan_at(text: &str, count: &str) -> Result<Scan, Fail> {
    let b = text.as_bytes();
    if let Some(at) = b
        .iter()
        .position(|&c| c < 0x20 && !matches!(c, 9 | 10 | 13))
    {
        return fail(at, "a control character is not allowed in XML");
    }
    let mut out = Scan {
        root: String::new(),
        count: 0,
        script: false,
        root_attrs: Vec::new(),
    };
    let mut stack: Vec<&str> = Vec::new();
    let mut seen_root = false;
    let mut i = if text.starts_with('\u{feff}') { 3 } else { 0 };
    while i < b.len() {
        if b[i] != b'<' {
            let end = text[i..].find('<').map_or(b.len(), |n| i + n);
            if stack.is_empty() {
                if b[i..end]
                    .iter()
                    .any(|c| !matches!(c, b' ' | b'\t' | b'\r' | b'\n'))
                {
                    return fail(i, "text outside the root element");
                }
            } else {
                check_refs(&text[i..end], i)?;
            }
            i = end;
            continue;
        }
        let rest = &text[i..];
        if let Some(inner) = rest.strip_prefix("<!--") {
            let Some(n) = inner.find("-->") else {
                return fail(i, "a comment is never closed");
            };
            i += 4 + n + 3;
        } else if let Some(inner) = rest.strip_prefix("<![CDATA[") {
            if stack.is_empty() {
                return fail(i, "a CDATA section outside the root element");
            }
            let Some(n) = inner.find("]]>") else {
                return fail(i, "a CDATA section is never closed");
            };
            i += 9 + n + 3;
        } else if let Some(inner) = rest.strip_prefix("<?") {
            let Some(n) = inner.find("?>") else {
                return fail(i, "a processing instruction is never closed");
            };
            i += 2 + n + 2;
        } else if rest.starts_with("<!") {
            return fail(i, "a DOCTYPE or other declaration is not allowed");
        } else if rest.starts_with("</") {
            let Some((name, end)) = read_name(text, i + 2) else {
                return fail(i, "a tag needs a name after <");
            };
            let close = skip_space(b, end);
            if b.get(close) != Some(&b'>') {
                return fail(i, format!("the closing </{name}> is never finished"));
            }
            match stack.pop() {
                Some(open) if open == name => {}
                Some(open) => {
                    return fail(i, format!("the closing </{name}> does not match <{open}>"));
                }
                None => return fail(i, format!("the closing </{name}> has no opening tag")),
            }
            i = close + 1;
        } else {
            let Some((name, mut j)) = read_name(text, i + 1) else {
                return fail(i, "a tag needs a name after <");
            };
            if stack.is_empty() && seen_root {
                return fail(i, "more than one root element");
            }
            if stack.len() >= MAX_DEPTH {
                return fail(i, "elements are nested too deeply");
            }
            let mut attrs: Vec<(&str, &str)> = Vec::new();
            let self_closing = loop {
                j = skip_space(b, j);
                match b.get(j) {
                    None => return fail(i, format!("<{name}> is never finished")),
                    Some(b'>') => {
                        j += 1;
                        break false;
                    }
                    Some(b'/') if b.get(j + 1) == Some(&b'>') => {
                        j += 2;
                        break true;
                    }
                    Some(b'/') => return fail(j, "a / in a tag must be followed by >"),
                    Some(_) => {}
                }
                let Some((aname, end)) = read_name(text, j) else {
                    return fail(j, format!("<{name}> has an attribute with no name"));
                };
                let k = skip_space(b, end);
                if b.get(k) != Some(&b'=') {
                    return fail(k, format!("attribute {aname} needs ="));
                }
                let k = skip_space(b, k + 1);
                let quote = match b.get(k) {
                    Some(&q @ (b'"' | b'\'')) => q as char,
                    _ => return fail(k, format!("attribute {aname} needs a quoted value")),
                };
                let Some(len) = text[k + 1..].find(quote) else {
                    return fail(k, format!("attribute {aname} is never closed"));
                };
                let value = &text[k + 1..k + 1 + len];
                if value.contains('<') {
                    return fail(k, format!("attribute {aname} has a < in its value"));
                }
                check_refs(value, k + 1)?;
                if attrs.iter().any(|(n, _)| *n == aname) {
                    return fail(j, format!("attribute {aname} appears twice"));
                }
                attrs.push((aname, value));
                j = k + 1 + len + 1;
            };
            if stack.is_empty() {
                seen_root = true;
                out.root = name.to_owned();
                out.root_attrs = attrs
                    .iter()
                    .map(|(n, v)| ((*n).to_owned(), (*v).to_owned()))
                    .collect();
            }
            out.count += usize::from(name == count);
            out.script |= name
                .rsplit(':')
                .next()
                .is_some_and(|local| local.eq_ignore_ascii_case("script"));
            if !self_closing {
                stack.push(name);
            }
            i = j;
        }
    }
    if let Some(open) = stack.last() {
        return fail(b.len(), format!("<{open}> is never closed"));
    }
    if !seen_root {
        return fail(0, "the file has no root element");
    }
    Ok(out)
}

/// The text an attribute value stands for, or None when it holds a
/// reference that is not one of the five predefined entities or a character.
pub(crate) fn unescape(s: &str) -> Option<String> {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let len = rest[at + 1..].bytes().take(12).position(|c| c == b';')?;
        let name = &rest[at + 1..at + 1 + len];
        match name {
            "lt" => out.push('<'),
            "gt" => out.push('>'),
            "amp" => out.push('&'),
            "quot" => out.push('"'),
            "apos" => out.push('\''),
            _ => {
                let digits = name.strip_prefix('#')?;
                if !char_ref(digits) {
                    return None;
                }
                let n = match digits.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                    None => digits.parse().ok()?,
                };
                out.push(char::from_u32(n)?);
            }
        }
        rest = &rest[at + len + 2..];
    }
    out.push_str(rest);
    Some(out)
}

/// `s` as an attribute value, in the form a drawing tool writes: the
/// inverse of `unescape`, which the tests round-trip.
#[cfg(test)]
pub(crate) fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + s.len() / 8);
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            '\n' => out.push_str("&#xa;"),
            '\r' => out.push_str("&#xd;"),
            '\t' => out.push_str("&#x9;"),
            c => out.push(c),
        }
    }
    out
}
