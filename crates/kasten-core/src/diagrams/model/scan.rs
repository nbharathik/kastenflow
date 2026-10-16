//! A tree of the elements of a diagram's text with the byte span of every
//! tag and attribute, so a change can be made as a replacement of those bytes
//! and everything else stays as the editor wrote it. It reads on the rules of
//! `xml.rs` (the text is checked there first); comments, CDATA and processing
//! instructions are skipped, and a declaration is refused.

use std::ops::Range;

/// One attribute of a tag.
#[derive(Debug, Clone)]
pub(crate) struct Attr {
    pub name: String,
    /// The value, unescaped.
    pub value: String,
    /// The bytes of ` name="value"`, with the space before it.
    pub span: Range<usize>,
    /// The bytes between the quotes.
    pub inner: Range<usize>,
}

/// One element.
#[derive(Debug, Clone)]
pub(crate) struct Node {
    pub name: String,
    /// `<name …>` or `<name … />`.
    pub open: Range<usize>,
    /// Where a new attribute goes: after the last one, before the tag ends.
    pub attr_end: usize,
    /// `</name>`; none when the tag closes itself.
    pub close: Option<Range<usize>>,
    pub attrs: Vec<Attr>,
    pub parent: Option<usize>,
    pub children: Vec<usize>,
    /// Text other than white space sits directly inside it.
    pub has_text: bool,
}

impl Node {
    /// The whole element, tags included.
    pub fn span(&self) -> Range<usize> {
        self.open.start..self.close.as_ref().map_or(self.open.end, |c| c.end)
    }

    pub fn attr(&self, name: &str) -> Option<&Attr> {
        self.attrs.iter().find(|a| a.name == name)
    }

    pub fn value(&self, name: &str) -> Option<&str> {
        self.attr(name).map(|a| a.value.as_str())
    }
}

#[derive(Debug, Clone)]
pub(crate) struct Tree {
    pub nodes: Vec<Node>,
    pub root: usize,
}

impl Tree {
    /// The first child of `node` named `name`.
    pub fn child(&self, node: usize, name: &str) -> Option<usize> {
        self.nodes[node]
            .children
            .iter()
            .copied()
            .find(|&c| self.nodes[c].name == name)
    }
}

fn is_name_start(c: u8) -> bool {
    c.is_ascii_alphabetic() || matches!(c, b'_' | b':') || c >= 0x80
}

fn read_name(text: &str, at: usize) -> Option<(&str, usize)> {
    let b = text.as_bytes();
    if !b.get(at).copied().is_some_and(is_name_start) {
        return None;
    }
    let mut end = at + 1;
    while b
        .get(end)
        .is_some_and(|&c| is_name_start(c) || c.is_ascii_digit() || matches!(c, b'-' | b'.'))
    {
        end += 1;
    }
    Some((&text[at..end], end))
}

fn skip_space(b: &[u8], mut at: usize) -> usize {
    while matches!(b.get(at), Some(b' ' | b'\t' | b'\r' | b'\n')) {
        at += 1;
    }
    at
}

/// Reads `text` into a tree.
pub(crate) fn parse(text: &str) -> Result<Tree, String> {
    let b = text.as_bytes();
    let mut nodes: Vec<Node> = Vec::new();
    let mut stack: Vec<usize> = Vec::new();
    let mut root = None;
    let mut i = if text.starts_with('\u{feff}') { 3 } else { 0 };
    while i < b.len() {
        if b[i] != b'<' {
            let end = text[i..].find('<').map_or(b.len(), |n| i + n);
            if let Some(&top) = stack.last()
                && b[i..end]
                    .iter()
                    .any(|c| !matches!(c, b' ' | b'\t' | b'\r' | b'\n'))
            {
                nodes[top].has_text = true;
            }
            i = end;
            continue;
        }
        let rest = &text[i..];
        if let Some(inner) = rest.strip_prefix("<!--") {
            let n = inner.find("-->").ok_or("a comment is never closed")?;
            i += 4 + n + 3;
        } else if let Some(inner) = rest.strip_prefix("<![CDATA[") {
            let n = inner.find("]]>").ok_or("a CDATA section is never closed")?;
            if let Some(&top) = stack.last() {
                nodes[top].has_text = true;
            }
            i += 9 + n + 3;
        } else if let Some(inner) = rest.strip_prefix("<?") {
            let n = inner
                .find("?>")
                .ok_or("a processing instruction is never closed")?;
            i += 2 + n + 2;
        } else if rest.starts_with("<!") {
            return Err("a declaration is not allowed".into());
        } else if rest.starts_with("</") {
            let (closed, end) = read_name(text, i + 2).ok_or("a tag needs a name")?;
            let close = skip_space(b, end);
            if b.get(close) != Some(&b'>') {
                return Err("a closing tag is never finished".into());
            }
            let top = stack.pop().ok_or("a closing tag has no opening tag")?;
            if nodes[top].name != closed {
                return Err(format!("</{closed}> does not match <{}>", nodes[top].name));
            }
            nodes[top].close = Some(i..close + 1);
            i = close + 1;
        } else {
            let (name, mut j) = read_name(text, i + 1).ok_or("a tag needs a name")?;
            let mut attrs = Vec::new();
            let mut attr_end = j;
            let self_closing = loop {
                let before = j;
                j = skip_space(b, j);
                match b.get(j) {
                    None => return Err(format!("<{name}> is never finished")),
                    Some(b'>') => {
                        j += 1;
                        break false;
                    }
                    Some(b'/') if b.get(j + 1) == Some(&b'>') => {
                        j += 2;
                        break true;
                    }
                    Some(_) => {}
                }
                let (aname, end) =
                    read_name(text, j).ok_or_else(|| format!("<{name}> has a bad attribute"))?;
                let k = skip_space(b, end);
                if b.get(k) != Some(&b'=') {
                    return Err(format!("attribute {aname} needs ="));
                }
                let k = skip_space(b, k + 1);
                let quote = match b.get(k) {
                    Some(&q @ (b'"' | b'\'')) => q as char,
                    _ => return Err(format!("attribute {aname} needs a quoted value")),
                };
                let len = text[k + 1..]
                    .find(quote)
                    .ok_or_else(|| format!("attribute {aname} is never closed"))?;
                let raw = &text[k + 1..k + 1 + len];
                let value = super::super::xml::unescape(raw)
                    .ok_or_else(|| format!("attribute {aname} holds a bad reference"))?;
                j = k + 1 + len + 1;
                attr_end = j;
                attrs.push(Attr {
                    name: aname.to_owned(),
                    value,
                    span: before..j,
                    inner: k + 1..k + 1 + len,
                });
            };
            let at = nodes.len();
            let parent = stack.last().copied();
            if let Some(p) = parent {
                nodes[p].children.push(at);
            } else if root.is_none() {
                root = Some(at);
            } else {
                return Err("more than one root element".into());
            }
            nodes.push(Node {
                name: name.to_owned(),
                open: i..j,
                attr_end,
                close: None,
                attrs,
                parent,
                children: Vec::new(),
                has_text: false,
            });
            if !self_closing {
                stack.push(at);
            }
            i = j;
        }
    }
    if !stack.is_empty() {
        return Err("an element is never closed".into());
    }
    Ok(Tree {
        nodes,
        root: root.ok_or("the file has no root element")?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spans_point_at_the_bytes_of_tags_and_values() {
        let text = "<a x=\"1\" y='two &amp; three'>\n  <b/>\n</a>\n";
        let tree = parse(text).unwrap();
        let a = &tree.nodes[tree.root];
        assert_eq!(&text[a.open.clone()], "<a x=\"1\" y='two &amp; three'>");
        assert_eq!(a.value("y"), Some("two & three"));
        let y = a.attr("y").unwrap();
        assert_eq!(&text[y.inner.clone()], "two &amp; three");
        assert_eq!(&text[y.span.clone()], " y='two &amp; three'");
        assert_eq!(a.attr_end, y.span.end);
        let b = &tree.nodes[a.children[0]];
        assert_eq!(&text[b.span()], "<b/>");
        assert!(b.close.is_none());
        assert_eq!(&text[a.span()], text.trim_end());
    }

    #[test]
    fn text_in_an_element_is_noticed_and_white_space_is_not() {
        let tree = parse("<d>\n  <e/>\n</d>").unwrap();
        assert!(!tree.nodes[tree.root].has_text);
        let tree = parse("<d>7VhZb9</d>").unwrap();
        assert!(tree.nodes[tree.root].has_text);
    }

    #[test]
    fn declarations_and_broken_text_are_refused() {
        assert!(parse("<!DOCTYPE a><a/>").is_err());
        assert!(parse("<a><b></a>").is_err());
        assert!(parse("<a x=1/>").is_err());
        assert!(parse("<a/><b/>").is_err());
    }
}
